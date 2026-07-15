import type { ApiTrackListSpec } from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import type { Prisma } from "@prisma/client";
import { mediaAssetWhereFromLibraryFilters } from "./library-list-filters.js";
import { assertAssetsPlayableInVault } from "./library-vault.js";
import { getOrCreateSettings } from "../services/app-settings.js";

/** Tope solo de seguridad por petición; el pool se construye por páginas sin truncar el catálogo. */
const POOL_PAGE = 5000;
const MAX_PICKS = 100;

export type TrackListOrder = "random" | "sequential" | "series";

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function normalizeArtist(artist: string | null | undefined): string {
  return (artist ?? "").trim().toLowerCase() || "__unknown__";
}

function normalizeOrder(raw: unknown): TrackListOrder {
  if (raw === "series") return "series";
  if (raw === "sequential" || raw === "title" || raw === "in_order" || raw === "order") {
    return "sequential";
  }
  return "random";
}

export function parseTrackListSpec(raw: unknown): ApiTrackListSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const source = o.source;
  const value = o.value;
  if (
    source !== "folder" &&
    source !== "playlist" &&
    source !== "genre" &&
    source !== "artist" &&
    source !== "category"
  ) {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) return null;

  // RadioBOSS: un track list lanza 1 pista. maxTracks>1 = varios lanzamientos seguidos (reloj/bulk).
  const maxTracks =
    typeof o.maxTracks === "number" && Number.isFinite(o.maxTracks)
      ? Math.max(1, Math.min(MAX_PICKS, Math.floor(o.maxTracks)))
      : 1;

  const order = normalizeOrder(o.order);
  const label = typeof o.label === "string" ? o.label.trim() || undefined : undefined;
  const ignoreRepeatProtection = o.ignoreRepeatProtection === true;
  const recurseSubfolders = o.recurseSubfolders !== false;
  const cursor =
    typeof o.cursor === "number" && Number.isFinite(o.cursor) ? Math.max(0, Math.floor(o.cursor)) : 0;
  const stickyAssetId =
    typeof o.stickyAssetId === "string" && o.stickyAssetId.trim() ? o.stickyAssetId.trim() : null;
  const deck = Array.isArray(o.deck)
    ? o.deck.filter((x): x is string => typeof x === "string" && x.length > 0)
    : undefined;

  return {
    source,
    value: value.trim(),
    maxTracks,
    order,
    label,
    ignoreRepeatProtection,
    recurseSubfolders,
    cursor,
    stickyAssetId,
    ...(deck && deck.length > 0 ? { deck } : {}),
  };
}

type PoolRow = { id: string; artist: string | null; title: string; path: string };

async function findAllPoolRows(
  where: Prisma.MediaAssetWhereInput,
  orderBy: Prisma.MediaAssetOrderByWithRelationInput[],
): Promise<PoolRow[]> {
  const out: PoolRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.mediaAsset.findMany({
      where: {
        AND: [where, ...(cursor ? [{ id: { gt: cursor } }] : [])],
      },
      orderBy: [{ id: "asc" }],
      take: POOL_PAGE,
      select: { id: true, artist: true, title: true, path: true },
    });
    if (page.length === 0) break;
    out.push(...page);
    cursor = page[page.length - 1]!.id;
    if (page.length < POOL_PAGE) break;
  }
  // Orden estable según el criterio pedido (tras cargar todo).
  const keyTitle = (a: PoolRow) => a.title.toLowerCase();
  const keyPath = (a: PoolRow) => a.path.replace(/\\/g, "/").toLowerCase();
  const wantsPath = orderBy.some((o) => "path" in o);
  out.sort((a, b) => {
    if (wantsPath) {
      const c = keyPath(a).localeCompare(keyPath(b), "es");
      if (c !== 0) return c;
    }
    return keyTitle(a).localeCompare(keyTitle(b), "es") || a.path.localeCompare(b.path);
  });
  return out;
}

async function loadTrackListPool(spec: ApiTrackListSpec): Promise<PoolRow[]> {
  if (spec.source === "playlist") {
    const items = await prisma.playlistItem.findMany({
      where: {
        playlistId: spec.value,
        kind: { in: ["track", "voicetrack"] },
        assetId: { not: null },
      },
      orderBy: { position: "asc" },
      select: {
        asset: { select: { id: true, artist: true, title: true, path: true } },
      },
    });
    const seen = new Set<string>();
    const rows: PoolRow[] = [];
    for (const it of items) {
      const a = it.asset;
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      rows.push({ id: a.id, artist: a.artist, title: a.title, path: a.path });
    }
    return rows;
  }

  let pathPrefix =
    spec.source === "folder" ? spec.value.replace(/\\/g, "/") : undefined;
  if (pathPrefix && !spec.recurseSubfolders) {
    // Sin subcarpetas: coincidencia exacta de segmento (prefijo + sin más /).
    // Con recurse (default RB): startsWith incluye subcarpetas.
  }
  const filters =
    spec.source === "genre" || spec.source === "category"
      ? { genre: spec.value }
      : spec.source === "artist"
        ? { artist: spec.value }
        : { pathPrefix: pathPrefix! };

  const where = mediaAssetWhereFromLibraryFilters(filters);

  if (spec.source === "folder" && pathPrefix && !spec.recurseSubfolders) {
    const base = pathPrefix.endsWith("/") ? pathPrefix.slice(0, -1) : pathPrefix;
    const assets = await findAllPoolRows(
      {
        AND: [
          where,
          {
            path: {
              startsWith: base.endsWith("/") ? base : `${base}/`,
            },
          },
        ],
      },
      [{ path: "asc" }, { title: "asc" }],
    );
    const depth = base.split("/").filter(Boolean).length;
    return assets.filter((a) => {
      const segs = a.path.replace(/\\/g, "/").split("/").filter(Boolean);
      return segs.length === depth + 1;
    });
  }

  return findAllPoolRows(where, [{ title: "asc" }, { path: "asc" }]);
}

function filterByRepeat(
  pool: PoolRow[],
  opts: {
    ignore: boolean;
    recentAssetIds: string[];
    recentArtists: string[];
    noRepeatTrackN: number;
    noRepeatArtistN: number;
  },
): PoolRow[] {
  if (opts.ignore) return pool;
  const recentAssetSet =
    opts.noRepeatTrackN > 0 ? new Set(opts.recentAssetIds.slice(-opts.noRepeatTrackN)) : null;
  const recentArtistSet =
    opts.noRepeatArtistN > 0
      ? new Set(opts.recentArtists.slice(-opts.noRepeatArtistN).map(normalizeArtist))
      : null;
  if (!recentAssetSet && !recentArtistSet) return pool;

  const filtered = pool.filter((a) => {
    if (recentAssetSet?.has(a.id)) return false;
    if (recentArtistSet?.has(normalizeArtist(a.artist))) return false;
    return true;
  });
  // Si el filtro vacía el pool (catálogo chico), RadioBOSS permite repetir.
  return filtered.length > 0 ? filtered : pool;
}

export type PickOneResult = {
  assetId: string | null;
  nextSpec: ApiTrackListSpec;
};

/**
 * RadioBOSS Track List: elige **una** pista del origen.
 * - random: baraja (deck) y avanza; al agotar, rebaraja.
 * - sequential: orden alfabético por título; cursor++.
 * - series: misma pista sticky hasta advanceSeries=true.
 */
export async function pickOneFromTrackList(
  spec: ApiTrackListSpec,
  env: Env,
  opts?: {
    recentAssetIds?: string[];
    recentArtists?: string[];
    advanceSeries?: boolean;
  },
): Promise<PickOneResult> {
  const pool = await loadTrackListPool(spec);
  if (pool.length === 0) return { assetId: null, nextSpec: spec };

  const settings = await getOrCreateSettings();
  const noRepeatArtistN = Math.max(0, Math.min(50, settings.autoDjNoRepeatArtistLastN ?? 0));
  const noRepeatTrackN = Math.max(0, Math.min(200, settings.autoDjNoRepeatTrackLastN ?? 0));
  const recentAssetIds = opts?.recentAssetIds ?? [];
  const recentArtists = opts?.recentArtists ?? [];

  const order = normalizeOrder(spec.order);
  let nextSpec: ApiTrackListSpec = { ...spec, order, maxTracks: spec.maxTracks ?? 1 };

  if (order === "series") {
    if (!opts?.advanceSeries && nextSpec.stickyAssetId) {
      const still = pool.find((a) => a.id === nextSpec.stickyAssetId);
      if (still) {
        await assertAssetsPlayableInVault([still.id], env);
        return { assetId: still.id, nextSpec };
      }
    }
    const eligible = filterByRepeat(pool, {
      ignore: !!nextSpec.ignoreRepeatProtection,
      recentAssetIds,
      recentArtists,
      noRepeatTrackN,
      noRepeatArtistN,
    });
    const idx = (nextSpec.cursor ?? 0) % eligible.length;
    const pick = eligible[idx]!;
    nextSpec = {
      ...nextSpec,
      cursor: (idx + 1) % eligible.length,
      stickyAssetId: pick.id,
    };
    await assertAssetsPlayableInVault([pick.id], env);
    return { assetId: pick.id, nextSpec };
  }

  if (order === "sequential") {
    const eligible = filterByRepeat(pool, {
      ignore: !!nextSpec.ignoreRepeatProtection,
      recentAssetIds,
      recentArtists,
      noRepeatTrackN,
      noRepeatArtistN,
    });
    const idx = (nextSpec.cursor ?? 0) % eligible.length;
    const pick = eligible[idx]!;
    nextSpec = { ...nextSpec, cursor: (idx + 1) % eligible.length, stickyAssetId: null };
    await assertAssetsPlayableInVault([pick.id], env);
    return { assetId: pick.id, nextSpec };
  }

  // random — deck persistente estilo RadioBOSS (evitar repetir hasta agotar)
  let deck = (nextSpec.deck ?? []).filter((id) => pool.some((p) => p.id === id));
  if (deck.length === 0) {
    const eligible = filterByRepeat(pool, {
      ignore: !!nextSpec.ignoreRepeatProtection,
      recentAssetIds,
      recentArtists,
      noRepeatTrackN,
      noRepeatArtistN,
    });
    const ids = eligible.map((a) => a.id);
    shuffleInPlace(ids);
    deck = ids;
  }

  const pickId = deck[0]!;
  const rest = deck.slice(1);
  nextSpec = {
    ...nextSpec,
    deck: rest.length > 0 ? rest : undefined,
    cursor: 0,
    stickyAssetId: null,
  };
  await assertAssetsPlayableInVault([pickId], env);
  return { assetId: pickId, nextSpec };
}

async function persistTrackListSpec(playlistItemId: string, spec: ApiTrackListSpec): Promise<void> {
  await prisma.playlistItem.update({
    where: { id: playlistItemId },
    data: { trackListSpec: spec as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Resuelve una track list a N pistas (N = maxTracks, default 1 = RadioBOSS).
 * Si se pasa playlistItemId, persiste cursor/deck/sticky en el ítem.
 */
export async function resolveTrackListAssetIds(
  spec: ApiTrackListSpec,
  env: Env,
  opts?: {
    recentAssetIds?: string[];
    recentArtists?: string[];
    playlistItemId?: string;
  },
): Promise<string[]> {
  const max = Math.max(1, Math.min(MAX_PICKS, spec.maxTracks ?? 1));
  const recentAssetIds = [...(opts?.recentAssetIds ?? [])];
  const recentArtists = [...(opts?.recentArtists ?? [])];
  let current = { ...spec, maxTracks: max };
  const picked: string[] = [];

  for (let i = 0; i < max; i++) {
    const r = await pickOneFromTrackList(current, env, { recentAssetIds, recentArtists });
    current = { ...r.nextSpec, maxTracks: max };
    if (!r.assetId) break;
    picked.push(r.assetId);
    recentAssetIds.push(r.assetId);
    const row = await prisma.mediaAsset.findUnique({
      where: { id: r.assetId },
      select: { artist: true },
    });
    if (row?.artist) recentArtists.push(row.artist);
  }

  if (opts?.playlistItemId) {
    await persistTrackListSpec(opts.playlistItemId, current);
  }

  return picked;
}

/** Avanza el cursor de un track list en modo series (evento programado RadioBOSS). */
export async function advanceTrackListSeries(
  playlistItemId: string,
  env: Env,
): Promise<ApiTrackListSpec | null> {
  const item = await prisma.playlistItem.findUnique({ where: { id: playlistItemId } });
  if (!item || item.kind !== "track_list") return null;
  const spec = parseTrackListSpec(item.trackListSpec);
  if (!spec) return null;
  const r = await pickOneFromTrackList(spec, env, { advanceSeries: true });
  await persistTrackListSpec(playlistItemId, r.nextSpec);
  return r.nextSpec;
}

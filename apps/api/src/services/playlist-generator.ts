import type { Prisma } from "@prisma/client";
import { equalsCi } from "../lib/prisma-string-filter.js";
import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { assertAssetPlayableInVault } from "../lib/library-vault.js";
import type { ParsedPlaylistGenerateBody } from "../lib/playlist-generator-body.js";
import type { ApiPlaylistCategoryFilters, ApiPlaylistCategoryRule } from "@radioflow/shared";

export type PlaylistCategoryRule = ApiPlaylistCategoryRule & {
  id: string;
  weight: number;
  picksPerCycle: number;
};

export type PlaylistGeneratorInput = {
  name?: string;
  targetDurationSec: number;
  genres?: string[];
  pathPrefixes?: string[];
  categoryRules?: PlaylistCategoryRule[];
  /** Patrón estructural RadioBOSS (ids de categoría). */
  rotation?: string[];
  order: "random" | "title";
  minArtistGap: number;
  maxTracks?: number;
};

export type PlaylistGeneratorResult = {
  playlistId: string;
  name: string;
  trackCount: number;
  totalDurationSec: number;
  shortfallSec: number;
};

type TrackRow = {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  releaseYear: number | null;
  playCount: number;
};

function ensureRuleId(rule: ApiPlaylistCategoryRule, index: number): string {
  return rule.id?.trim() || `cat-${index}-${rule.kind}-${rule.value}`.slice(0, 64);
}

function normalizeRule(rule: ApiPlaylistCategoryRule, index: number): PlaylistCategoryRule {
  return {
    ...rule,
    id: ensureRuleId(rule, index),
    name: rule.name?.trim() || rule.value,
    weight: Math.max(1, Math.min(100, rule.weight ?? 25)),
    picksPerCycle: Math.max(1, Math.min(20, rule.picksPerCycle ?? 1)),
    ignoreRepeatProtection: rule.ignoreRepeatProtection === true,
    preferFewerPlays: rule.preferFewerPlays === true,
  };
}

export function parsedBodyToGeneratorInput(body: ParsedPlaylistGenerateBody): PlaylistGeneratorInput {
  const categoryRules = body.categoryRules?.map((r, i) => normalizeRule(r, i));
  return {
    name: body.name,
    targetDurationSec: body.targetDurationSec ?? 3600,
    genres: body.genres,
    pathPrefixes: body.pathPrefixes,
    categoryRules,
    rotation: body.rotation,
    order: body.order ?? "random",
    minArtistGap: body.minArtistGap ?? 3,
    maxTracks: body.maxTracks,
  };
}

function normalizeArtist(artist: string | null | undefined): string {
  return (artist ?? "").trim().toLowerCase() || "__unknown__";
}

function trackDurationSec(track: TrackRow): number {
  return track.durationSec != null && track.durationSec > 0 ? track.durationSec : 180;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function ruleKey(rule: Pick<PlaylistCategoryRule, "kind" | "value">): string {
  return `${rule.kind}:${rule.value}`;
}

function normalizeWeights(rules: PlaylistCategoryRule[]): PlaylistCategoryRule[] {
  const sum = rules.reduce((s, r) => s + r.weight, 0);
  if (sum <= 0) {
    const even = Math.floor(100 / rules.length);
    return rules.map((r, i) => ({ ...r, weight: i === 0 ? 100 - even * (rules.length - 1) : even }));
  }
  return rules.map((r) => ({ ...r, weight: (r.weight / sum) * 100 }));
}

function violatesGap(recentArtists: string[], artist: string, minArtistGap: number): boolean {
  if (minArtistGap <= 0) return false;
  return recentArtists.slice(-minArtistGap).includes(artist);
}

function matchesFilters(track: TrackRow, filters?: ApiPlaylistCategoryFilters): boolean {
  if (!filters) return true;
  if (filters.yearMin != null && (track.releaseYear == null || track.releaseYear < filters.yearMin)) {
    return false;
  }
  if (filters.yearMax != null && (track.releaseYear == null || track.releaseYear > filters.yearMax)) {
    return false;
  }
  const dur = trackDurationSec(track);
  if (filters.durationMinSec != null && dur < filters.durationMinSec) return false;
  if (filters.durationMaxSec != null && dur > filters.durationMaxSec) return false;
  return true;
}

function pickNextFromPool(
  pool: TrackRow[],
  recentArtists: string[],
  minArtistGap: number,
  pickedIds: Set<string>,
  opts?: { ignoreGap?: boolean; preferFewerPlays?: boolean; filters?: ApiPlaylistCategoryFilters },
): TrackRow | null {
  const ignoreGap = opts?.ignoreGap === true;
  const preferFewer = opts?.preferFewerPlays === true;

  const candidates: { track: TrackRow; index: number }[] = [];
  for (let i = 0; i < pool.length; i++) {
    const track = pool[i]!;
    if (pickedIds.has(track.id)) continue;
    if (!matchesFilters(track, opts?.filters)) continue;
    const artist = normalizeArtist(track.artist);
    if (!ignoreGap && violatesGap(recentArtists, artist, minArtistGap)) continue;
    candidates.push({ track, index: i });
  }

  if (candidates.length === 0) {
    for (let i = 0; i < pool.length; i++) {
      const track = pool[i]!;
      if (pickedIds.has(track.id)) continue;
      if (!matchesFilters(track, opts?.filters)) continue;
      candidates.push({ track, index: i });
    }
  }

  if (candidates.length === 0) return null;

  if (preferFewer) {
    candidates.sort((a, b) => a.track.playCount - b.track.playCount || a.index - b.index);
  }

  const chosen = candidates[0]!;
  const poolIdx = pool.findIndex((t) => t.id === chosen.track.id);
  if (poolIdx >= 0) pool.splice(poolIdx, 1);
  return chosen.track;
}

function buildWhere(input: PlaylistGeneratorInput): Prisma.MediaAssetWhereInput {
  const genres = (input.genres ?? []).map((g) => g.trim()).filter(Boolean);
  const prefixes = (input.pathPrefixes ?? []).map((p) => p.trim().replace(/\\/g, "/")).filter(Boolean);

  if (genres.length === 0 && prefixes.length === 0) return {};

  const clauses: Prisma.MediaAssetWhereInput[] = [];
  if (genres.length > 0) {
    clauses.push({
      OR: genres.map((genre) => ({ genre: equalsCi(genre) })),
    });
  }
  if (prefixes.length > 0) {
    clauses.push({
      OR: prefixes.map((pathPrefix) => ({ path: { startsWith: pathPrefix } })),
    });
  }
  if (clauses.length === 1) return clauses[0]!;
  return { OR: clauses };
}

function whereForCategoryRule(rule: PlaylistCategoryRule): Prisma.MediaAssetWhereInput {
  if (rule.kind === "genre") {
    return { genre: equalsCi(rule.value.trim()) };
  }
  if (rule.kind === "artist") {
    if (rule.value === "__none__") {
      return { OR: [{ artist: null }, { artist: "" }] };
    }
    return { artist: equalsCi(rule.value.trim()) };
  }
  const prefix = rule.value.trim().replace(/\\/g, "/");
  return { path: { startsWith: prefix.endsWith("/") ? prefix : `${prefix}/` } };
}

async function loadPlayCounts(assetIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (assetIds.length === 0) return map;
  const rows = await prisma.playLog.groupBy({
    by: ["assetId"],
    where: {
      assetId: { in: assetIds },
      action: { in: ["SKIP", "TRACK_PLAYED"] },
    },
    _count: { _all: true },
  });
  for (const r of rows) {
    if (r.assetId) map.set(r.assetId, r._count._all);
  }
  return map;
}

async function loadPlayablePool(
  where: Prisma.MediaAssetWhereInput,
  env: Env,
  order: "random" | "title",
): Promise<TrackRow[]> {
  const PAGE = 5000;
  type PoolAsset = {
    id: string;
    title: string;
    artist: string | null;
    path: string;
    durationSec: number | null;
    releaseYear: number | null;
  };
  const assets: PoolAsset[] = [];
  let skip = 0;
  for (;;) {
    const page = await prisma.mediaAsset.findMany({
      where,
      select: {
        id: true,
        title: true,
        artist: true,
        path: true,
        durationSec: true,
        releaseYear: true,
      },
      skip,
      take: PAGE,
      orderBy: { id: "asc" },
    });
    if (page.length === 0) break;
    assets.push(...page);
    skip += page.length;
    if (page.length < PAGE) break;
  }

  let playable = assets.filter((a) => {
    try {
      assertAssetPlayableInVault(a, env);
      return true;
    } catch {
      return false;
    }
  });

  const playCounts = await loadPlayCounts(playable.map((a) => a.id));

  const rows: TrackRow[] = playable.map((a) => ({
    id: a.id,
    title: a.title,
    artist: a.artist,
    durationSec: a.durationSec,
    releaseYear: a.releaseYear,
    playCount: playCounts.get(a.id) ?? 0,
  }));

  if (order === "title") {
    rows.sort((a, b) => a.title.localeCompare(b.title, "es"));
  } else {
    shuffleInPlace(rows);
  }

  return rows;
}

function pickTracks(
  pool: TrackRow[],
  targetDurationSec: number,
  minArtistGap: number,
  maxTracks: number,
): TrackRow[] {
  const picked: TrackRow[] = [];
  let totalSec = 0;
  const recentArtists: string[] = [];
  const remaining = [...pool];
  const pickedIds = new Set<string>();

  while (remaining.length > 0 && picked.length < maxTracks && totalSec < targetDurationSec) {
    const track = pickNextFromPool(remaining, recentArtists, minArtistGap, pickedIds);
    if (!track) break;
    picked.push(track);
    pickedIds.add(track.id);
    totalSec += trackDurationSec(track);
    recentArtists.push(normalizeArtist(track.artist));
  }

  return picked;
}

function pickTracksWeightedRotation(
  pools: Map<string, TrackRow[]>,
  rules: PlaylistCategoryRule[],
  targetDurationSec: number,
  minArtistGap: number,
  maxTracks: number,
): TrackRow[] {
  const normalized = normalizeWeights(rules);
  const remaining = new Map<string, TrackRow[]>();
  for (const rule of normalized) {
    remaining.set(ruleKey(rule), [...(pools.get(ruleKey(rule)) ?? [])]);
  }

  const picked: TrackRow[] = [];
  const pickedIds = new Set<string>();
  const categoryCounts = new Map<string, number>();
  for (const rule of normalized) categoryCounts.set(ruleKey(rule), 0);

  let totalSec = 0;
  const recentArtists: string[] = [];

  while (picked.length < maxTracks && totalSec < targetDurationSec) {
    let bestRule: PlaylistCategoryRule | null = null;
    let bestScore = Infinity;

    for (const rule of normalized) {
      const key = ruleKey(rule);
      const pool = remaining.get(key) ?? [];
      if (pool.length === 0) continue;
      const count = categoryCounts.get(key) ?? 0;
      const expected = (rule.weight / 100) * Math.max(1, picked.length + 1);
      const score = count / expected;
      if (score < bestScore) {
        bestScore = score;
        bestRule = rule;
      }
    }

    if (!bestRule) break;

    const key = ruleKey(bestRule);
    const pool = remaining.get(key)!;
    const track = pickNextFromPool(pool, recentArtists, minArtistGap, pickedIds, {
      ignoreGap: bestRule.ignoreRepeatProtection,
      preferFewerPlays: bestRule.preferFewerPlays,
      filters: bestRule.filters,
    });
    if (!track) {
      remaining.set(key, []);
      continue;
    }

    picked.push(track);
    pickedIds.add(track.id);
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
    totalSec += trackDurationSec(track);
    recentArtists.push(normalizeArtist(track.artist));
  }

  return picked;
}

/** Rotación estructural RadioBOSS: cicla el patrón hasta duración/máx pistas. */
function pickTracksStructuredRotation(
  poolsByRuleId: Map<string, TrackRow[]>,
  rulesById: Map<string, PlaylistCategoryRule>,
  rotation: string[],
  targetDurationSec: number,
  minArtistGap: number,
  maxTracks: number,
): TrackRow[] {
  const remaining = new Map<string, TrackRow[]>();
  for (const [id, pool] of poolsByRuleId) {
    remaining.set(id, [...pool]);
  }

  const picked: TrackRow[] = [];
  const pickedIds = new Set<string>();
  let totalSec = 0;
  const recentArtists: string[] = [];
  let safety = 0;
  const maxCycles = Math.max(20, Math.ceil(maxTracks / Math.max(1, rotation.length)) + 5);

  while (picked.length < maxTracks && totalSec < targetDurationSec && safety < maxCycles) {
    safety += 1;
    let progressed = false;

    for (const catId of rotation) {
      const rule = rulesById.get(catId);
      if (!rule) continue;
      const pool = remaining.get(catId) ?? [];
      const picks = rule.picksPerCycle;

      for (let i = 0; i < picks; i++) {
        if (picked.length >= maxTracks || totalSec >= targetDurationSec) break;
        const track = pickNextFromPool(pool, recentArtists, minArtistGap, pickedIds, {
          ignoreGap: rule.ignoreRepeatProtection,
          preferFewerPlays: rule.preferFewerPlays,
          filters: rule.filters,
        });
        if (!track) break;
        picked.push(track);
        pickedIds.add(track.id);
        totalSec += trackDurationSec(track);
        recentArtists.push(normalizeArtist(track.artist));
        progressed = true;
      }
      remaining.set(catId, pool);
    }

    if (!progressed) break;
  }

  return picked;
}

function sumDuration(tracks: TrackRow[]): number {
  return tracks.reduce((sum, t) => sum + trackDurationSec(t), 0);
}

async function createPlaylistFromTracks(
  name: string,
  picked: TrackRow[],
  targetDurationSec: number,
): Promise<PlaylistGeneratorResult> {
  const pl = await prisma.$transaction(async (tx) => {
    const playlist = await tx.playlist.create({ data: { name } });
    await tx.playlistItem.createMany({
      data: picked.map((a, idx) => ({ playlistId: playlist.id, assetId: a.id, position: idx })),
    });
    return playlist;
  });

  const totalDurationSec = sumDuration(picked);
  return {
    playlistId: pl.id,
    name: pl.name,
    trackCount: picked.length,
    totalDurationSec,
    shortfallSec: Math.max(0, targetDurationSec - totalDurationSec),
  };
}

function defaultNameFromInput(input: PlaylistGeneratorInput): string {
  if (input.name?.trim()) return input.name.trim();

  if (input.rotation && input.rotation.length > 0 && input.categoryRules) {
    const byId = new Map(input.categoryRules.map((r) => [r.id, r]));
    const parts = input.rotation
      .slice(0, 6)
      .map((id) => byId.get(id)?.name || byId.get(id)?.value || id);
    return `Generada: ${parts.join(" → ")}`;
  }

  if (input.categoryRules && input.categoryRules.length > 0) {
    const parts = input.categoryRules.map((r) => {
      const label = r.name || (r.kind === "folder" ? r.value.split("/").filter(Boolean).pop() ?? r.value : r.value);
      return `${Math.round(r.weight)}% ${label}`;
    });
    return `Generada: ${parts.slice(0, 3).join(" · ")}`;
  }

  const genreLabel = (input.genres ?? []).join(", ");
  const folderLabel = (input.pathPrefixes ?? []).join(", ");
  if (genreLabel) return `Generada: ${genreLabel}`;
  if (folderLabel) return `Generada: ${folderLabel}`;
  return "Playlist generada";
}

async function generateWithCategoryRules(
  env: Env,
  input: PlaylistGeneratorInput,
): Promise<PlaylistGeneratorResult> {
  const rules = input.categoryRules ?? [];
  if (rules.length === 0) throw new Error("Sin reglas de categoría");

  const targetDurationSec = Math.max(60, Math.min(86_400, input.targetDurationSec));
  const maxTracks = Math.max(1, Math.min(500, input.maxTracks ?? 500));
  const minArtistGap = Math.max(0, Math.min(20, input.minArtistGap));

  const poolsBySource = new Map<string, TrackRow[]>();
  for (const rule of rules) {
    const key = ruleKey(rule);
    if (poolsBySource.has(key)) continue;
    const pool = await loadPlayablePool(whereForCategoryRule(rule), env, input.order);
    poolsBySource.set(key, pool);
  }

  const empty = rules.filter((r) => (poolsBySource.get(ruleKey(r))?.length ?? 0) === 0);
  if (empty.length === rules.length) {
    throw new Error("No hay pistas reproducibles en ninguna categoría de la rotación");
  }

  const useStructure = (input.rotation?.length ?? 0) > 0;
  let picked: TrackRow[];

  if (useStructure) {
    const rulesById = new Map(rules.map((r) => [r.id, r]));
    const poolsByRuleId = new Map<string, TrackRow[]>();
    for (const rule of rules) {
      poolsByRuleId.set(rule.id, [...(poolsBySource.get(ruleKey(rule)) ?? [])]);
    }
    const rotation = (input.rotation ?? []).filter((id) => rulesById.has(id));
    if (rotation.length === 0) {
      throw new Error("La rotación no referencia ninguna categoría válida");
    }
    picked = pickTracksStructuredRotation(
      poolsByRuleId,
      rulesById,
      rotation,
      targetDurationSec,
      minArtistGap,
      maxTracks,
    );
  } else {
    picked = pickTracksWeightedRotation(poolsBySource, rules, targetDurationSec, minArtistGap, maxTracks);
  }

  if (picked.length === 0) {
    throw new Error("No se pudo armar la lista con las reglas de rotación");
  }

  return createPlaylistFromTracks(defaultNameFromInput(input), picked, targetDurationSec);
}

export async function generatePlaylistPro(
  env: Env,
  input: PlaylistGeneratorInput,
): Promise<PlaylistGeneratorResult> {
  if (input.categoryRules && input.categoryRules.length > 0) {
    return generateWithCategoryRules(env, input);
  }

  const targetDurationSec = Math.max(60, Math.min(86_400, input.targetDurationSec));
  const maxTracks = Math.max(1, Math.min(500, input.maxTracks ?? 500));
  const minArtistGap = Math.max(0, Math.min(20, input.minArtistGap));

  const genres = (input.genres ?? []).map((g) => g.trim()).filter(Boolean);
  const prefixes = (input.pathPrefixes ?? []).map((p) => p.trim().replace(/\\/g, "/")).filter(Boolean);
  if (genres.length === 0 && prefixes.length === 0) {
    throw new Error("Indique al menos un género, carpeta o regla de categoría");
  }

  const assets = await loadPlayablePool(buildWhere(input), env, input.order);
  if (assets.length === 0) {
    throw new Error("No hay pistas reproducibles que coincidan con los criterios");
  }

  const picked = pickTracks(assets, targetDurationSec, minArtistGap, maxTracks);
  return createPlaylistFromTracks(defaultNameFromInput(input), picked, targetDurationSec);
}

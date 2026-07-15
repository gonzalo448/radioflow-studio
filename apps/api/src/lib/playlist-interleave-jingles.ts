import { prisma } from "../db.js";
import { mapPlaylistDetail } from "./queue-entry-map.js";

const JINGLE_HINT =
  /\b(jingle|station[\s_-]?id|sweep|bumper|promo|ident|sting|liner|id\s*bed)\b/i;

export function assetLooksLikeJingle(asset: {
  title?: string | null;
  artist?: string | null;
  genre?: string | null;
  album?: string | null;
  path?: string | null;
} | null): boolean {
  if (!asset) return false;
  const hay = [asset.genre, asset.path, asset.title, asset.album, asset.artist]
    .filter(Boolean)
    .join(" ");
  return JINGLE_HINT.test(hay);
}

/**
 * Reordena pistas: N canciones → 1 jingle → N canciones → …
 * Los no-track (comandos, VT, track_list, etc.) van al final.
 */
export function buildInterleavedOrder(
  items: { id: string; kind: string; isJingle: boolean }[],
  everyN: number,
): string[] {
  const n = Math.max(1, Math.min(50, Math.floor(everyN) || 3));
  const music: string[] = [];
  const jingles: string[] = [];
  const other: string[] = [];

  for (const it of items) {
    if (it.kind !== "track") {
      other.push(it.id);
      continue;
    }
    if (it.isJingle) jingles.push(it.id);
    else music.push(it.id);
  }

  const out: string[] = [];
  let ji = 0;
  for (let i = 0; i < music.length; i++) {
    out.push(music[i]!);
    if ((i + 1) % n === 0 && ji < jingles.length) {
      out.push(jingles[ji]!);
      ji += 1;
    }
  }
  while (ji < jingles.length) {
    out.push(jingles[ji]!);
    ji += 1;
  }
  out.push(...other);
  return out;
}

export async function interleavePlaylistJingles(opts: {
  playlistId: string;
  everyN: number;
  /** selected = ítems indicados son jingles; auto = heurística género/ruta/título */
  mode: "auto" | "selected";
  jingleItemIds?: string[];
}) {
  const pl = await prisma.playlist.findUnique({
    where: { id: opts.playlistId },
    include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
  });
  if (!pl) return null;

  const selected = new Set(opts.jingleItemIds ?? []);
  if (opts.mode === "selected" && selected.size === 0) {
    throw new Error("Seleccioná al menos un jingle en la lista");
  }

  const classified = pl.items.map((it) => {
    let isJingle = false;
    if (it.kind === "track") {
      if (opts.mode === "selected") isJingle = selected.has(it.id);
      else isJingle = assetLooksLikeJingle(it.asset);
    }
    return { id: it.id, kind: it.kind, isJingle };
  });

  const musicCount = classified.filter((c) => c.kind === "track" && !c.isJingle).length;
  const jingleCount = classified.filter((c) => c.isJingle).length;
  if (musicCount === 0) throw new Error("No hay canciones (pistas) para intercalar");
  if (jingleCount === 0) {
    throw new Error(
      opts.mode === "selected"
        ? "No hay jingles en la selección"
        : "No se detectaron jingles (género/ruta/título con jingle, promo, ID…)",
    );
  }

  const orderedIds = buildInterleavedOrder(classified, opts.everyN);
  if (orderedIds.length !== pl.items.length) {
    throw new Error("Error al calcular el nuevo orden");
  }

  await prisma.$transaction(
    orderedIds.map((itemId, index) =>
      prisma.playlistItem.update({
        where: { id: itemId },
        data: { position: index },
      }),
    ),
  );

  const full = await prisma.playlist.findUnique({
    where: { id: opts.playlistId },
    include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
  });
  return full ? mapPlaylistDetail(full) : null;
}

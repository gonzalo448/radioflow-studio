import { existsSync } from "node:fs";
import path from "node:path";
import type { MediaAsset, Prisma, PrismaClient } from "@prisma/client";
import { parseFile } from "music-metadata";
import type { Env } from "../config.js";
import { introMatchKeyFromMetadata } from "./intro-match-key.js";
import { saveEmbeddedPicture } from "./extract-cover.js";
import { readAudioDurationSeconds } from "./library-check-tracks.js";
import { resolveAssetFilePath } from "./media-path.js";
import { detectAndPersistTrackCues } from "./detect-track-cues.js";

/** Sufijo típico tras subida: `-<uuid>` al final del basename (sin extensión). */
const UPLOAD_UUID_TAIL = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function stripUploadUuidSuffix(baseNoExt: string): string {
  let s = baseNoExt.trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(UPLOAD_UUID_TAIL, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Interpreta `Artista - Título` en el nombre de archivo (tras quitar sufijo UUID de subida).
 * Separador: guión medio / Unicode rodeado opcionalmente de espacios.
 */
export function splitArtistTitleFromBasename(baseNoExt: string): { artist: string | null; title: string } {
  const raw = stripUploadUuidSuffix(baseNoExt).replace(/_/g, " ").trim();
  if (!raw) return { artist: null, title: "Sin título" };

  const collapsed = raw.replace(/\s+/g, " ");
  const dashRe = /^(.+?)[\s\u00a0]+[-–—][\s\u00a0]+(.+)$/;
  const dash = collapsed.match(dashRe);
  if (dash && dash[1].trim() && dash[2].trim()) {
    return { artist: dash[1].trim(), title: dash[2].trim() };
  }

  /** Nombres tipo `Angel Canales   Título` (doble espacio, sin guión). */
  const multiSpace = raw.match(/^(.+?)\s{2,}(.+)$/);
  if (multiSpace && multiSpace[1].trim() && multiSpace[2].trim()) {
    return {
      artist: multiSpace[1].replace(/\s+/g, " ").trim(),
      title: multiSpace[2].replace(/\s+/g, " ").trim(),
    };
  }

  return { artist: null, title: collapsed };
}

function pickArtistFromTags(mm: { common: import("music-metadata").ICommonTagsResult }): string | null {
  const artists = mm.common.artists?.filter(Boolean);
  if (artists && artists.length > 0) return artists[0]!.trim();
  const a = mm.common.artist;
  if (!a) return null;
  if (Array.isArray(a)) return a[0]?.trim() || null;
  return String(a).trim() || null;
}

function pickGenre(mm: { common: import("music-metadata").ICommonTagsResult }): string | null {
  const g = mm.common.genre;
  if (g == null) return null;
  if (Array.isArray(g)) return g[0]?.trim() || null;
  return String(g).trim() || null;
}

function pickComment(mm: { common: import("music-metadata").ICommonTagsResult }): string | null {
  const c = mm.common.comment;
  if (c == null) return null;
  const part = (x: unknown): string => {
    if (typeof x === "string") return x;
    if (x && typeof x === "object" && "text" in x) return String((x as { text: unknown }).text ?? "");
    try {
      return JSON.stringify(x);
    } catch {
      return "";
    }
  };
  if (Array.isArray(c)) {
    const t = c.map(part).join("\n").trim();
    return t.length ? t : null;
  }
  const t = part(c).trim();
  return t.length ? t : null;
}

function pickYear(mm: { common: import("music-metadata").ICommonTagsResult }): number | null {
  const y = mm.common.year;
  if (typeof y === "number" && y >= 1900 && y <= 2100) return y;
  return null;
}

function techFromFormat(format: import("music-metadata").IFormat): {
  audioBitrateKbps: number | null;
  audioSampleRateHz: number | null;
  audioChannels: number | null;
} {
  const br = format.bitrate;
  const audioBitrateKbps =
    br != null && Number.isFinite(br) && br > 0 ? Math.max(1, Math.round(br / 1000)) : null;
  const sr = format.sampleRate;
  const audioSampleRateHz =
    sr != null && Number.isFinite(sr) && sr > 0 ? Math.round(sr) : null;
  const ch = format.numberOfChannels;
  const audioChannels = ch != null && Number.isFinite(ch) && ch > 0 ? Math.round(ch) : null;
  return { audioBitrateKbps, audioSampleRateHz, audioChannels };
}

type MediaAssetUpdate = Prisma.MediaAssetUpdateInput;

/**
 * Rellena título, artista, álbum, año, comentario ID3, datos técnicos y duración desde el archivo;
 * extrae carátula embebida si existe. Prioriza etiquetas embebidas; si faltan, usa nombre `Artista - Título`.
 * Tras el enriquecimiento, detecta Cue Start/End (silencios) si aún no hay cues — para crossfade uniforme al importar.
 */
export async function enrichMediaAssetFromAudioFile(
  prisma: PrismaClient,
  env: Env,
  asset: MediaAsset,
): Promise<MediaAsset> {
  const abs = resolveAssetFilePath(asset.path, env);
  if (!abs || !existsSync(abs)) {
    return asset;
  }

  const baseName = path.basename(abs, path.extname(abs));
  let mm: Awaited<ReturnType<typeof parseFile>>;
  try {
    mm = await parseFile(abs, { skipCovers: false, duration: true });
  } catch {
    return asset;
  }

  const fromTagsTitle = mm.common.title?.trim() || null;
  const fromTagsArtist = pickArtistFromTags(mm);
  const split = splitArtistTitleFromBasename(baseName);

  let title: string;
  let artist: string | null;

  if (fromTagsArtist) {
    artist = fromTagsArtist;
    title = fromTagsTitle ?? split.title ?? stripUploadUuidSuffix(baseName);
  } else if (split.artist) {
    artist = split.artist;
    title = split.title;
  } else {
    artist = null;
    title = fromTagsTitle ?? split.title;
  }

  const album = mm.common.album?.trim() || null;
  const genre = pickGenre(mm);
  const releaseYear = pickYear(mm);
  const id3Comment = pickComment(mm);
  const introMatchKey = introMatchKeyFromMetadata(mm);
  const tech = techFromFormat(mm.format);

  const durationSec = await readAudioDurationSeconds(abs, env);

  const embeddedPic = mm.common.picture?.[0];
  const coverPath = embeddedPic
    ? await saveEmbeddedPicture(embeddedPic, asset.id, env)
    : asset.coverPath ?? null;

  const data: MediaAssetUpdate = {
    title,
    artist,
    album,
    genre,
    releaseYear,
    id3Comment,
    ...(introMatchKey ? { introMatchKey } : {}),
    audioBitrateKbps: tech.audioBitrateKbps,
    audioSampleRateHz: tech.audioSampleRateHz,
    audioChannels: tech.audioChannels,
    ...(durationSec != null && durationSec > 0 ? { durationSec } : {}),
    ...(coverPath ? { coverPath } : {}),
  };

  let updated = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data,
  });

  // Auto cues al importar / enriquecer (solo si faltan; no bloquea si ffmpeg falla)
  try {
    await detectAndPersistTrackCues(prisma, env, updated);
    const fresh = await prisma.mediaAsset.findUnique({ where: { id: updated.id } });
    if (fresh) updated = fresh;
  } catch {
    /* cues opcionales */
  }

  return updated;
}

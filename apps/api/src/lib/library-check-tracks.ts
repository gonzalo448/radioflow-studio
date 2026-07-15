import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { parseFile } from "music-metadata";
import type { Env } from "../config.js";
import { readDurationSecondsWithFfprobe } from "./ffprobe-duration.js";
import { resolveAssetFilePath } from "./media-path.js";

export type LibraryCheckTrackIssueCode =
  | "missing_file"
  | "unreadable"
  | "empty_file"
  | "parse_error"
  | "duration_unknown"
  | "duration_mismatch"
  | "tag_missing_title"
  | "tag_title_mismatch"
  | "tag_artist_mismatch"
  | "tag_album_mismatch";

export type LibraryCheckFileMeta = {
  durationSec?: number | null;
  tagTitle?: string | null;
  tagArtist?: string | null;
  tagAlbum?: string | null;
};

export type LibraryCheckTrackRow = {
  id: string;
  path: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number | null;
};

export type LibraryCheckTrackResult = {
  assetId: string;
  path: string;
  title: string;
  issues: LibraryCheckTrackIssueCode[];
  fileMeta?: LibraryCheckFileMeta;
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function pickTagTitle(mm: Awaited<ReturnType<typeof parseFile>>): string | null {
  const t = mm.common.title?.trim();
  return t && t.length > 0 ? t : null;
}

/** Duración en segundos: primero music-metadata, opcionalmente ffprobe si está habilitado en env. */
async function durationFromParsedFile(
  absPath: string,
  mm: Awaited<ReturnType<typeof parseFile>>,
  env: Env,
): Promise<number | null> {
  const d = mm.format.duration;
  if (d != null && Number.isFinite(d) && d > 0) return Math.round(d);
  if (env.AUDIO_FFPROBE_ENABLED) {
    return readDurationSecondsWithFfprobe(absPath, env.FFPROBE_PATH);
  }
  return null;
}

/**
 * Lee la duración en segundos desde el archivo (music-metadata; si falla o no hay duración y
 * `AUDIO_FFPROBE_ENABLED`, intenta ffprobe).
 */
export async function readAudioDurationSeconds(absPath: string, env: Env): Promise<number | null> {
  try {
    const mm = await parseFile(absPath, { skipCovers: true, duration: true });
    return durationFromParsedFile(absPath, mm, env);
  } catch {
    if (env.AUDIO_FFPROBE_ENABLED) {
      return readDurationSecondsWithFfprobe(absPath, env.FFPROBE_PATH);
    }
    return null;
  }
}

/**
 * Comprueba una pista (archivo + metadatos leídos del audio). No modifica la base.
 * Estilo “Check music tracks” del manual de RadioBOSS.
 */
export async function checkLibraryTrack(
  row: LibraryCheckTrackRow,
  env: Env,
  opts?: { compareTitles?: boolean; compareArtists?: boolean; compareAlbums?: boolean },
): Promise<LibraryCheckTrackResult | null> {
  const compareTitles = opts?.compareTitles !== false;
  const compareArtists = opts?.compareArtists === true;
  const compareAlbums = opts?.compareAlbums === true;
  const abs = resolveAssetFilePath(row.path, env);
  if (!abs || !existsSync(abs)) {
    return { assetId: row.id, path: row.path, title: row.title, issues: ["missing_file"] };
  }

  try {
    const st = await stat(abs);
    if (st.size === 0) {
      return { assetId: row.id, path: row.path, title: row.title, issues: ["empty_file"] };
    }
  } catch {
    return { assetId: row.id, path: row.path, title: row.title, issues: ["unreadable"] };
  }

  try {
    const mm = await parseFile(abs, { skipCovers: true, duration: true });
    const issues: LibraryCheckTrackIssueCode[] = [];
    const fileDur = await durationFromParsedFile(abs, mm, env);

    const tagTitle = pickTagTitle(mm);
    const tagArtist = mm.common.artist?.trim() || null;
    const tagAlbum = mm.common.album?.trim() || null;

    if (fileDur == null || fileDur <= 0) issues.push("duration_unknown");

    if (row.durationSec != null && row.durationSec > 0 && fileDur != null && fileDur > 0) {
      if (Math.abs(row.durationSec - fileDur) > 2) issues.push("duration_mismatch");
    }

    if (!tagTitle) issues.push("tag_missing_title");

    if (
      compareTitles &&
      tagTitle &&
      row.title &&
      row.title.trim().length > 1 &&
      norm(tagTitle) !== norm(row.title)
    ) {
      issues.push("tag_title_mismatch");
    }

    if (
      compareArtists &&
      tagArtist &&
      row.artist &&
      row.artist.trim().length > 0 &&
      norm(tagArtist) !== norm(row.artist)
    ) {
      issues.push("tag_artist_mismatch");
    }

    if (
      compareAlbums &&
      tagAlbum &&
      row.album &&
      row.album.trim().length > 0 &&
      norm(tagAlbum) !== norm(row.album)
    ) {
      issues.push("tag_album_mismatch");
    }

    if (issues.length === 0) return null;

    return {
      assetId: row.id,
      path: row.path,
      title: row.title,
      issues,
      fileMeta: { durationSec: fileDur, tagTitle, tagArtist, tagAlbum },
    };
  } catch {
    const fileDur = await readAudioDurationSeconds(abs, env);
    const issues: LibraryCheckTrackIssueCode[] = [];
    if (fileDur == null || fileDur <= 0) {
      issues.push("parse_error");
    } else {
      if (row.durationSec != null && row.durationSec > 0 && Math.abs(row.durationSec - fileDur) > 2) {
        issues.push("duration_mismatch");
      }
      issues.push("tag_missing_title");
    }
    if (issues.length === 0) return null;
    return {
      assetId: row.id,
      path: row.path,
      title: row.title,
      issues,
      fileMeta: { durationSec: fileDur, tagTitle: null, tagArtist: null, tagAlbum: null },
    };
  }
}

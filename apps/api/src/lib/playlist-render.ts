import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { ensureMediaSubdir } from "./library-folder-path.js";
import { mediaRootAbs, resolveAssetFilePath } from "./media-path.js";
import { playlistItemsForExport } from "./playlist-export.js";

const execFileAsync = promisify(execFile);

export type PlaylistRenderFormat = "wav" | "mp3";

function escapeConcatPath(abs: string): string {
  return abs.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

export async function renderPlaylistToFile(opts: {
  playlistId: string;
  format: PlaylistRenderFormat;
  env: Env;
}): Promise<{ relPath: string; trackCount: number; durationSec: number | null }> {
  if (!opts.env.AUDIO_FFMPEG_ENABLED) {
    throw new Error("AUDIO_FFMPEG_ENABLED=0 — active ffmpeg para renderizar playlists");
  }

  const pl = await prisma.playlist.findUnique({
    where: { id: opts.playlistId },
    include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
  });
  if (!pl) throw new Error("Playlist no encontrada");

  const tracks = playlistItemsForExport(pl.items);
  if (tracks.length === 0) throw new Error("La lista no tiene pistas exportables");
  if (tracks.length > 120) throw new Error("Máximo 120 pistas por render offline");

  const absPaths: string[] = [];
  for (const it of tracks) {
    const abs = resolveAssetFilePath(it.asset!.path, opts.env);
    if (!abs) throw new Error(`Archivo no accesible: ${it.asset!.path}`);
    absPaths.push(abs);
  }

  const folder = "uploads/renders";
  await ensureMediaSubdir(opts.env, folder);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = opts.format === "wav" ? "wav" : "mp3";
  const safeName = pl.name.replace(/[^\w\-]+/g, "_").slice(0, 60) || "playlist";
  const relPath = `${folder}/${safeName}-${stamp}.${ext}`;
  const outAbs = path.join(mediaRootAbs(opts.env), ...relPath.split("/"));

  const tmpDir = await mkdtemp(path.join(tmpdir(), "rf-render-"));
  const listFile = path.join(tmpDir, "concat.txt");
  const listBody = absPaths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n");
  await writeFile(listFile, listBody, "utf8");

  const ffmpegArgs = [
    "-hide_banner",
    "-nostats",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
  ];
  if (opts.format === "wav") {
    ffmpegArgs.push("-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2");
  } else {
    ffmpegArgs.push("-c:a", "libmp3lame", "-b:a", "192k");
  }
  ffmpegArgs.push(outAbs);

  try {
    await execFileAsync(opts.env.FFMPEG_PATH, ffmpegArgs, {
      timeout: 3_600_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  const durationSec = tracks.reduce((sum, it) => sum + (it.asset?.durationSec ?? 0), 0) || null;

  await prisma.mediaAsset.create({
    data: {
      title: `Render · ${pl.name}`.slice(0, 200),
      artist: "Playlist",
      path: relPath,
      mimeType: opts.format === "wav" ? "audio/wav" : "audio/mpeg",
      durationSec: durationSec && durationSec > 0 ? durationSec : null,
    },
  });

  return { relPath, trackCount: tracks.length, durationSec };
}

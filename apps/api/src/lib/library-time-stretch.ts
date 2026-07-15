import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PrismaClient } from "@prisma/client";
import type {
  ApiLibraryProcessTimeStretchResult,
  ApiLibraryProcessTimeStretchRow,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { readAudioDurationSeconds } from "./library-check-tracks.js";
import { isPathInsideRoot, mediaRootAbs, resolveAssetFilePath } from "./media-path.js";

const execFileAsync = promisify(execFile);

export type TimeStretchBatchRow = ApiLibraryProcessTimeStretchRow;
export type TimeStretchBatchResult = ApiLibraryProcessTimeStretchResult;

/** Cadena filtros ffmpeg `atempo` (cada uno 0.5–2.0). */
export function buildAtempoFilterChain(tempoRatio: number): string {
  let r = Math.min(4, Math.max(0.25, tempoRatio));
  const parts: string[] = [];
  while (r > 2.0 + 1e-6) {
    parts.push("atempo=2.0");
    r /= 2.0;
  }
  while (r < 0.5 - 1e-6) {
    parts.push("atempo=0.5");
    r /= 0.5;
  }
  parts.push(`atempo=${r.toFixed(4)}`);
  return parts.join(",");
}

function extLower(p: string): string {
  return path.extname(p).toLowerCase();
}

function audioEncodeArgsForPath(absPath: string): string[] {
  const ext = extLower(absPath);
  if (ext === ".mp3") return ["-c:a", "libmp3lame", "-q:a", "2"];
  if (ext === ".wav") return ["-c:a", "pcm_s16le"];
  if (ext === ".flac") return ["-c:a", "flac"];
  if (ext === ".ogg" || ext === ".oga") return ["-c:a", "libvorbis", "-q:a", "5"];
  if (ext === ".m4a" || ext === ".aac" || ext === ".mp4") return ["-c:a", "aac", "-b:a", "192k"];
  return ["-c:a", "libmp3lame", "-q:a", "3"];
}

async function replaceFileAtomically(absFinal: string, absTmp: string): Promise<void> {
  if (absFinal === absTmp) return;
  try {
    await unlink(absFinal);
  } catch {
    // ok
  }
  await rename(absTmp, absFinal);
}

export async function runTimeStretchBatchForAssets(
  prisma: PrismaClient,
  env: Env,
  params: {
    assetIds: string[];
    apply: boolean;
    tempoRatio: number;
    timeoutMsPerAsset: number;
    ffmpegPath: string;
    onProgress?: (p: { done: number; total: number; rows: TimeStretchBatchRow[] }) => Promise<void>;
  },
): Promise<TimeStretchBatchResult> {
  const { assetIds, apply, tempoRatio, ffmpegPath, timeoutMsPerAsset, onProgress } = params;
  const rows: TimeStretchBatchRow[] = [];
  const total = assetIds.length;
  const filter = buildAtempoFilterChain(tempoRatio);
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, path: true, title: true, durationSec: true },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));
  let done = 0;

  for (const id of assetIds) {
    const asset = byId.get(id);
    if (!asset) {
      rows.push({ assetId: id, title: "", path: "", apply, tempoRatio, error: "No encontrado" });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rows] });
      continue;
    }
    const absIn = resolveAssetFilePath(asset.path, env);
    if (!absIn || !existsSync(absIn)) {
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply,
        tempoRatio,
        error: "Archivo no accesible",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rows] });
      continue;
    }

    const estDuration =
      asset.durationSec != null && asset.durationSec > 0
        ? Math.max(1, Math.round(asset.durationSec / tempoRatio))
        : undefined;

    try {
      if (!apply) {
        rows.push({
          assetId: id,
          title: asset.title,
          path: asset.path,
          apply: false,
          tempoRatio,
          estimatedDurationSec: estDuration,
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }

      const dir = path.dirname(absIn);
      const ext = path.extname(absIn) || ".mp3";
      const tmpName = `.rf-stretch-${randomBytes(8).toString("hex")}${ext}`;
      const absTmp = path.join(dir, tmpName);
      const root = mediaRootAbs(env);
      if (!isPathInsideRoot(absTmp, root)) {
        rows.push({
          assetId: id,
          title: asset.title,
          path: asset.path,
          apply: true,
          tempoRatio,
          error: "Ruta temporal inválida",
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }

      await execFileAsync(
        ffmpegPath,
        [
          "-hide_banner",
          "-nostats",
          "-y",
          "-i",
          absIn,
          "-vn",
          "-filter:a",
          filter,
          ...audioEncodeArgsForPath(absIn),
          absTmp,
        ],
        {
          timeout: timeoutMsPerAsset,
          maxBuffer: 24 * 1024 * 1024,
          windowsHide: true,
        },
      );

      if (!existsSync(absTmp)) {
        rows.push({
          assetId: id,
          title: asset.title,
          path: asset.path,
          apply: true,
          tempoRatio,
          error: "ffmpeg no generó salida",
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }

      await replaceFileAtomically(absIn, absTmp);
      const dur = await readAudioDurationSeconds(absIn, env);
      await prisma.mediaAsset.update({
        where: { id },
        data: { durationSec: dur ?? estDuration ?? asset.durationSec },
      });

      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply: true,
        tempoRatio,
        estimatedDurationSec: dur ?? estDuration,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply,
        tempoRatio,
        error: msg.slice(0, 500),
      });
    }
    done += 1;
    if (onProgress) await onProgress({ done, total, rows: [...rows] });
  }

  return { kind: "time_stretch", apply, tempoRatio, rows };
}

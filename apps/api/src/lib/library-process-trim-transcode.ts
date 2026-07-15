import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PrismaClient } from "@prisma/client";
import type {
  ApiLibraryProcessTranscodeMp3Result,
  ApiLibraryProcessTranscodeMp3Row,
  ApiLibraryProcessTrimSilenceResult,
  ApiLibraryProcessTrimSilenceRow,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { readAudioDurationSeconds } from "./library-check-tracks.js";
import { isPathInsideRoot, mediaRootAbs, resolveAssetFilePath } from "./media-path.js";
import { detectAndPersistTrackCues } from "./detect-track-cues.js";

const execFileAsync = promisify(execFile);

export type TrimSilenceBatchRow = ApiLibraryProcessTrimSilenceRow;
export type TrimSilenceBatchResult = ApiLibraryProcessTrimSilenceResult;

export type TranscodeMp3BatchRow = ApiLibraryProcessTranscodeMp3Row;
export type TranscodeMp3BatchResult = ApiLibraryProcessTranscodeMp3Result;

function extLower(p: string): string {
  return path.extname(p).toLowerCase();
}

function buildSilenceDetectFilter(noiseDb: number, minSilenceSec: number): string {
  return `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`;
}

function buildSilenceRemoveFilter(noiseDb: number, minSilenceSec: number): string {
  return [
    "silenceremove=start_periods=1",
    `start_duration=${minSilenceSec}`,
    `start_threshold=${noiseDb}dB`,
    "detection=peak",
    "stop_periods=-1",
    `stop_duration=${minSilenceSec}`,
    `stop_threshold=${noiseDb}dB`,
  ].join(":");
}

function parseSilencedetect(stderr: string): { startSec: number; endSec: number }[] {
  const out: { startSec: number; endSec: number }[] = [];
  const starts = [...stderr.matchAll(/silence_start:\s*([0-9.+-eE]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([0-9.+-eE]+)/g)].map((m) => Number(m[1]));
  const n = Math.min(starts.length, ends.length);
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(starts[i]) && Number.isFinite(ends[i])) {
      out.push({ startSec: starts[i], endSec: ends[i] });
    }
  }
  return out;
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

function relativePathAsMp3(storedPath: string): string {
  const dir = path.posix.dirname(storedPath.replace(/\\/g, "/"));
  const base = path.posix.basename(storedPath.replace(/\\/g, "/"));
  const noExt = base.replace(/\.[^.]+$/, "");
  return dir === "." ? `${noExt}.mp3` : `${dir}/${noExt}.mp3`;
}

async function replaceFileAtomically(absFinal: string, absTmp: string): Promise<void> {
  if (absFinal === absTmp) return;
  try {
    await unlink(absFinal);
  } catch {
    // puede no existir en casos raros
  }
  await rename(absTmp, absFinal);
}

export async function runTrimSilenceBatchForAssets(
  prisma: PrismaClient,
  env: Env,
  params: {
    assetIds: string[];
    apply: boolean;
    noiseDb: number;
    minSilenceSec: number;
    timeoutMsPerAsset: number;
    ffmpegPath: string;
    onProgress?: (p: { done: number; total: number; rows: TrimSilenceBatchRow[] }) => Promise<void>;
  },
): Promise<TrimSilenceBatchResult> {
  const { assetIds, apply, noiseDb, minSilenceSec, ffmpegPath, timeoutMsPerAsset, onProgress } = params;
  const rows: TrimSilenceBatchRow[] = [];
  const total = assetIds.length;
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, path: true, title: true, durationSec: true, cueStartSec: true, cueEndSec: true },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));
  let done = 0;

  for (const id of assetIds) {
    const asset = byId.get(id);
    if (!asset) {
      rows.push({ assetId: id, title: "", path: "", apply, error: "No encontrado" });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rows] });
      continue;
    }
    const abs = resolveAssetFilePath(asset.path, env);
    if (!abs || !existsSync(abs)) {
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply,
        error: "Archivo no accesible",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rows] });
      continue;
    }

    const trimExtOk = new Set([".mp3", ".wav", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".mp4"]);
    if (!trimExtOk.has(extLower(abs))) {
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply,
        error: `trim_silence: extensión no soportada (${extLower(abs)})`,
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rows] });
      continue;
    }

    try {
      if (!apply) {
        // Modo no destructivo (RadioBOSS “Remove gap”): solo guarda Start/End
        const cues = await detectAndPersistTrackCues(prisma, env, asset, {
          force: true,
          noiseDb,
          minSilenceSec,
          timeoutMs: timeoutMsPerAsset,
        });
        rows.push({
          assetId: id,
          title: asset.title,
          path: asset.path,
          apply: false,
          cueStartSec: cues?.cueStartSec,
          cueEndSec: cues?.cueEndSec,
          cuesUpdated: Boolean(cues),
          ...(cues ? {} : { error: "No se pudieron detectar cues (¿ffmpeg?)" }),
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }

      const afDetect = buildSilenceDetectFilter(noiseDb, minSilenceSec);
      const { stderr } = await execFileAsync(
        ffmpegPath,
        ["-hide_banner", "-nostats", "-i", abs, "-af", afDetect, "-f", "null", "-"],
        {
          timeout: timeoutMsPerAsset,
          maxBuffer: 24 * 1024 * 1024,
          windowsHide: true,
        },
      );
      const silences = parseSilencedetect(stderr.toString());

      const dir = path.dirname(abs);
      const ext = path.extname(abs);
      const tmpName = `.rf-trim-${randomBytes(8).toString("hex")}${ext}`;
      const absTmp = path.join(dir, tmpName);
      const afRemove = buildSilenceRemoveFilter(noiseDb, minSilenceSec);
      const enc = audioEncodeArgsForPath(abs);
      await execFileAsync(
        ffmpegPath,
        ["-hide_banner", "-nostats", "-y", "-i", abs, "-af", afRemove, ...enc, absTmp],
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
          silences,
          error: "ffmpeg no generó salida",
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }
      await replaceFileAtomically(abs, absTmp);
      const dur = await readAudioDurationSeconds(abs, env);
      // Tras recortar el archivo, Start=0 y End=duración (ya sin gaps)
      await prisma.mediaAsset.update({
        where: { id },
        data: {
          durationSec: dur != null ? Math.round(dur) : undefined,
          cueStartSec: 0,
          cueEndSec: dur != null ? Math.round(dur * 1000) / 1000 : null,
        },
      });
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply: true,
        silences,
        trimmed: true,
        cueStartSec: 0,
        cueEndSec: dur != null ? Math.round(dur * 1000) / 1000 : undefined,
        cuesUpdated: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply,
        error: msg.slice(0, 800),
      });
    }
    done += 1;
    if (onProgress) await onProgress({ done, total, rows: [...rows] });
  }

  return { kind: "trim_silence", apply, policy: { noiseDb, minSilenceSec }, rows };
}

export async function runTranscodeMp3BatchForAssets(
  prisma: PrismaClient,
  env: Env,
  params: {
    assetIds: string[];
    apply: boolean;
    bitrateKbps: number;
    preserveMetadata: boolean;
    timeoutMsPerAsset: number;
    ffmpegPath: string;
    onProgress?: (p: { done: number; total: number; rows: TranscodeMp3BatchRow[] }) => Promise<void>;
  },
): Promise<TranscodeMp3BatchResult> {
  const { assetIds, apply, bitrateKbps, preserveMetadata, ffmpegPath, timeoutMsPerAsset, onProgress } = params;
  const rows: TranscodeMp3BatchRow[] = [];
  const total = assetIds.length;
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, path: true, title: true },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));
  let done = 0;
  const root = mediaRootAbs(env);

  for (const id of assetIds) {
    const asset = byId.get(id);
    if (!asset) {
      rows.push({ assetId: id, title: "", path: "", apply, error: "No encontrado" });
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
        error: "Archivo no accesible",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rows] });
      continue;
    }

    const newRel = relativePathAsMp3(asset.path);
    const newAbsCandidate = path.resolve(root, ...newRel.split("/"));
    if (!isPathInsideRoot(newAbsCandidate, root)) {
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply,
        error: "Ruta MP3 inválida",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rows] });
      continue;
    }

    try {
      if (!apply) {
        rows.push({
          assetId: id,
          title: asset.title,
          path: asset.path,
          apply: false,
          newPath: newRel,
          bitrateKbps,
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }

      if (extLower(absIn) === ".mp3" && path.resolve(absIn) === path.resolve(newAbsCandidate)) {
        const dir = path.dirname(absIn);
        const tmpName = `.rf-mp3-${randomBytes(8).toString("hex")}.tmp.mp3`;
        const absTmp = path.join(dir, tmpName);
        const metaArgs = preserveMetadata ? ["-map_metadata", "0"] : [];
        await execFileAsync(
          ffmpegPath,
          [
            "-hide_banner",
            "-nostats",
            "-y",
            "-i",
            absIn,
            "-vn",
            ...metaArgs,
            "-c:a",
            "libmp3lame",
            "-b:a",
            `${bitrateKbps}k`,
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
          data: {
            durationSec: dur != null ? Math.round(dur) : undefined,
            mimeType: "audio/mpeg",
          },
        });
        rows.push({
          assetId: id,
          title: asset.title,
          path: asset.path,
          apply: true,
          newPath: asset.path,
          bitrateKbps,
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }

      if (existsSync(newAbsCandidate) && path.resolve(newAbsCandidate) !== path.resolve(absIn)) {
        rows.push({
          assetId: id,
          title: asset.title,
          path: asset.path,
          apply: true,
          error: `Ya existe el destino: ${newRel}`,
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }

      const dir = path.dirname(newAbsCandidate);
      const tmpName = `.rf-mp3-${randomBytes(8).toString("hex")}.tmp.mp3`;
      const absTmp = path.join(dir, tmpName);
      const metaArgs = preserveMetadata ? ["-map_metadata", "0"] : [];
      await execFileAsync(
        ffmpegPath,
        [
          "-hide_banner",
          "-nostats",
          "-y",
          "-i",
          absIn,
          "-vn",
          ...metaArgs,
          "-c:a",
          "libmp3lame",
          "-b:a",
          `${bitrateKbps}k`,
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
          error: "ffmpeg no generó salida",
        });
        done += 1;
        if (onProgress) await onProgress({ done, total, rows: [...rows] });
        continue;
      }
      await mkdir(path.dirname(newAbsCandidate), { recursive: true });
      await rename(absTmp, newAbsCandidate);
      if (path.resolve(absIn) !== path.resolve(newAbsCandidate)) {
        try {
          await unlink(absIn);
        } catch {
          // seguir: la BD ya apuntará al nuevo archivo
        }
      }
      const dur = await readAudioDurationSeconds(newAbsCandidate, env);
      await prisma.mediaAsset.update({
        where: { id },
        data: {
          path: newRel,
          durationSec: dur != null ? Math.round(dur) : undefined,
          mimeType: "audio/mpeg",
        },
      });
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply: true,
        newPath: newRel,
        bitrateKbps,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        apply,
        error: msg.slice(0, 800),
      });
    }
    done += 1;
    if (onProgress) await onProgress({ done, total, rows: [...rows] });
  }

  return { kind: "transcode_mp3", apply, policy: { bitrateKbps, preserveMetadata }, rows };
}

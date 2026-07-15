import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { MediaAsset, PrismaClient } from "@prisma/client";
import type { Env } from "../config.js";
import { getFfmpegReachability } from "./ffmpeg-health.js";
import { readAudioDurationSeconds } from "./library-check-tracks.js";
import { resolveAssetFilePath } from "./media-path.js";
import { cuePointsFromSilences, type TrackCuePoints } from "./track-cues.js";

const execFileAsync = promisify(execFile);

const SUPPORTED = new Set([".mp3", ".wav", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".mp4"]);

function buildSilenceDetectFilter(noiseDb: number, minSilenceSec: number): string {
  return `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`;
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

export type DetectTrackCuesOptions = {
  /** Si ya hay cues y no se fuerza, no reanaliza. Default: solo si faltan. */
  force?: boolean;
  noiseDb?: number;
  minSilenceSec?: number;
  timeoutMs?: number;
  /**
   * Si la detección falla (sin ffmpeg, archivo ilegible, etc.), guarda Start=0 y End=duración
   * para no reintentar eternamente en el backfill masivo.
   */
  fallbackOnFailure?: boolean;
};

/**
 * Detecta Cue Start/End con ffmpeg silencedetect y los guarda (no reescribe el archivo).
 * Pensado para importación automática (RadioBOSS “Remove gap” / Start–End).
 */
export async function detectAndPersistTrackCues(
  prisma: PrismaClient,
  env: Env,
  asset: Pick<MediaAsset, "id" | "path" | "durationSec" | "cueStartSec" | "cueEndSec">,
  opts?: DetectTrackCuesOptions,
): Promise<TrackCuePoints | null> {
  const persistFallback = async (): Promise<TrackCuePoints | null> => {
    if (!opts?.fallbackOnFailure) return null;
    const end =
      asset.durationSec != null && Number.isFinite(asset.durationSec) && asset.durationSec > 0.5
        ? asset.durationSec
        : 1;
    const cues: TrackCuePoints = { cueStartSec: 0, cueEndSec: Math.round(end * 1000) / 1000 };
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { cueStartSec: cues.cueStartSec, cueEndSec: cues.cueEndSec },
    });
    return cues;
  };

  if (!env.AUDIO_FFMPEG_ENABLED) return persistFallback();
  if (!opts?.force && asset.cueStartSec != null && asset.cueEndSec != null) {
    return { cueStartSec: asset.cueStartSec, cueEndSec: asset.cueEndSec };
  }

  const abs = resolveAssetFilePath(asset.path, env);
  if (!abs || !existsSync(abs)) return persistFallback();

  const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
  if (!SUPPORTED.has(ext)) return persistFallback();

  const ff = await getFfmpegReachability(env);
  if (ff.reachable !== true) return persistFallback();

  const noiseDb = opts?.noiseDb ?? -50;
  const minSilenceSec = opts?.minSilenceSec ?? 0.5;
  const timeoutMs = opts?.timeoutMs ?? env.LIBRARY_PROCESS_FFMPEG_TIMEOUT_MS ?? 120_000;

  try {
    const afDetect = buildSilenceDetectFilter(noiseDb, minSilenceSec);
    const { stderr } = await execFileAsync(
      env.FFMPEG_PATH,
      ["-hide_banner", "-nostats", "-i", abs, "-af", afDetect, "-f", "null", "-"],
      {
        timeout: timeoutMs,
        maxBuffer: 24 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const silences = parseSilencedetect(stderr.toString());
    const measuredDur = await readAudioDurationSeconds(abs, env);
    const durationSec =
      measuredDur != null && Number.isFinite(measuredDur)
        ? measuredDur
        : asset.durationSec != null
          ? asset.durationSec
          : null;
    if (durationSec == null) return persistFallback();

    const cues = cuePointsFromSilences(durationSec, silences);
    if (!cues) return persistFallback();

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        cueStartSec: cues.cueStartSec,
        cueEndSec: cues.cueEndSec,
        ...(measuredDur != null ? { durationSec: Math.round(measuredDur) } : {}),
      },
    });
    return cues;
  } catch (err) {
    console.warn("[library] detect cues failed", asset.id, err instanceof Error ? err.message : err);
    return persistFallback();
  }
}

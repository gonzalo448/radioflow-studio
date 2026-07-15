import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Env } from "../config.js";

const execFileAsync = promisify(execFile);

const SAMPLE_RATE = 22_050;
const MAX_ANALYZE_SEC = 120;
const MIN_BPM = 60;
const MAX_BPM = 200;

function downsampleEnvelope(samples: Float32Array, sampleRate: number, targetHz = 200): Float32Array {
  const factor = Math.max(1, Math.floor(sampleRate / targetHz));
  const len = Math.floor(samples.length / factor);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j += 1) sum += Math.abs(samples[base + j] ?? 0);
    out[i] = sum / factor;
  }
  return out;
}

/** Autocorrelación sobre envolvente de energía (rango dance/pop habitual). */
export function estimateBpmFromSamples(samples: Float32Array, sampleRate: number): number | null {
  if (samples.length < sampleRate * 4) return null;
  const env = downsampleEnvelope(samples, sampleRate);
  const envRate = 200;
  const minLag = Math.floor((60 / MAX_BPM) * envRate);
  const maxLag = Math.floor((60 / MIN_BPM) * envRate);
  if (maxLag >= env.length - 2) return null;

  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    const n = env.length - lag;
    for (let i = 0; i < n; i += 1) corr += env[i] * env[i + lag];
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;

  let bpm = (60 * envRate) / bestLag;
  while (bpm < MIN_BPM) bpm *= 2;
  while (bpm > MAX_BPM) bpm /= 2;
  if (bpm < MIN_BPM || bpm > MAX_BPM) return null;
  return Math.round(bpm);
}

async function decodeMonoF32(
  absPath: string,
  ffmpegPath: string,
  timeoutMs: number,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-nostats",
      "-t",
      String(MAX_ANALYZE_SEC),
      "-i",
      absPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "f32le",
      "pipe:1",
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Timeout decodificando audio para BPM"));
    }, timeoutMs);
    proc.stdout?.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString("utf8")).slice(-500);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(stderr.trim() || `ffmpeg exit ${code}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)));
    });
  });
}

export async function detectBpmFromAudioFile(
  absPath: string,
  env: Env,
  timeoutMs = 90_000,
): Promise<number | null> {
  if (!env.AUDIO_FFMPEG_ENABLED) return null;
  const samples = await decodeMonoF32(absPath, env.FFMPEG_PATH, timeoutMs);
  return estimateBpmFromSamples(samples, SAMPLE_RATE);
}

export async function assertFfmpegForBpm(env: Env): Promise<void> {
  if (!env.AUDIO_FFMPEG_ENABLED) {
    throw new Error("AUDIO_FFMPEG_ENABLED=0 — active ffmpeg para análisis BPM por audio");
  }
  await execFileAsync(env.FFMPEG_PATH, ["-version"], { timeout: 8000, windowsHide: true });
}

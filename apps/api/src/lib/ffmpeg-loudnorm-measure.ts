import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseLoudnormInputI(stderr: string): number | null {
  const s = stderr.toString();
  const quoted = /"input_i"\s*:\s*"([^"]+)"/.exec(s);
  if (quoted?.[1]) {
    const raw = quoted[1].replace(/\s*LUFS\s*$/i, "").replace(",", ".").trim();
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return n;
  }
  const num = /"input_i"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(s);
  if (num?.[1]) {
    const n = Number.parseFloat(num[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Medición de loudness integrada vía `ffmpeg` + filtro `loudnorm` (una pasada, `print_format=json`).
 * No modifica el archivo; solo lectura.
 */
export async function measureIntegratedLufsWithLoudnorm(
  absPath: string,
  ffmpegBin: string,
  targetLufs: number,
  timeoutMs = 120_000,
): Promise<number | null> {
  const tp = -1.5;
  const lra = 11;
  const af = `loudnorm=I=${targetLufs}:TP=${tp}:LRA=${lra}:print_format=json`;
  try {
    const { stderr } = await execFileAsync(
      ffmpegBin,
      [
        "-hide_banner",
        "-nostats",
        "-i",
        absPath,
        "-af",
        af,
        "-f",
        "null",
        "-",
      ],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 12 * 1024 * 1024 },
    );
    return parseLoudnormInputI(stderr);
  } catch {
    return null;
  }
}

export function suggestedGainDbForTarget(measuredLufs: number, targetLufs: number): number {
  return Math.round((targetLufs - measuredLufs) * 10) / 10;
}

export function clampPlaybackGainDb(db: number): number {
  return Math.max(-48, Math.min(24, Math.round(db * 10) / 10));
}

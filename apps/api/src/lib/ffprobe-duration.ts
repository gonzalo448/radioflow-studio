import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Lee la duración en segundos con ffprobe (redondeada).
 * Requiere ffprobe en PATH o ruta absoluta al binario.
 */
export async function readDurationSecondsWithFfprobe(
  absPath: string,
  ffprobeBin: string,
  timeoutMs = 20000,
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      ffprobeBin,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        absPath,
      ],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 512 * 1024 },
    );
    const t = Number.parseFloat(String(stdout).trim());
    if (!Number.isFinite(t) || t <= 0) return null;
    return Math.round(t);
  } catch {
    return null;
  }
}

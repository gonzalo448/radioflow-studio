import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import path from "node:path";

let cachedFfmpegPath: string | null = null;

/** Ruta absoluta a ffmpeg.exe (evita .cmd en Windows y ventanas de consola). */
export function resolveFfmpegPath(): string {
  if (cachedFfmpegPath) return cachedFfmpegPath;

  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) {
    cachedFfmpegPath = fromEnv;
    return fromEnv;
  }

  if (process.platform === "win32") {
    try {
      const out = execFileSync("where.exe", ["ffmpeg"], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const exe = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /\.exe$/i.test(line));
      if (exe) {
        cachedFfmpegPath = path.normalize(exe);
        return cachedFfmpegPath;
      }
    } catch {
      /* where.exe falló */
    }
    cachedFfmpegPath = "ffmpeg.exe";
    return cachedFfmpegPath;
  }

  cachedFfmpegPath = "ffmpeg";
  return cachedFfmpegPath;
}

/** Lanza FFmpeg sin ventana de consola en Windows. */
export function spawnFfmpegHidden(args: string[], onStderrLine?: (line: string) => void): ChildProcess {
  const exe = resolveFfmpegPath();
  const opts: SpawnOptions = {
    stdio: onStderrLine ? ["ignore", "ignore", "pipe"] : "ignore",
    windowsHide: true,
    shell: false,
    detached: false,
  };

  const child = spawn(exe, args, opts);

  if (onStderrLine && child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) onStderrLine(trimmed);
      }
    });
  }

  return child;
}

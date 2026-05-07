/**
 * Servicio ligero para Fase 4: lee el estado de la estación y propone/ffmpeg Icecast.
 * No ejecuta FFmpeg salvo que ENABLE_FFMPEG=1 (solo un intento por pista; en producción usar cola dedicada).
 */

const API = process.env.RADIOFLOW_API_URL ?? "http://127.0.0.1:4000";
const TOKEN = process.env.RADIOFLOW_TOKEN ?? "";
const ICECAST_URL = process.env.RADIOFLOW_ICECAST_URL ?? "";
const INTERVAL_MS = Number(process.env.RADIOFLOW_POLL_MS ?? "2500");
const ENABLE_FFMPEG = process.env.ENABLE_FFMPEG === "1";

type StationRes = {
  nowPlaying: { path: string; title: string; artist?: string | null } | null;
};

async function fetchStation(): Promise<StationRes> {
  const headers: Record<string, string> = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(`${API}/api/station`, { headers });
  if (!r.ok) throw new Error(`GET /api/station → ${r.status}`);
  return r.json() as Promise<StationRes>;
}

function ffmpegArgs(inputPath: string, icecastUrl: string): string[] {
  return [
    "-re",
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-content_type",
    "audio/mpeg",
    "-f",
    "mp3",
    icecastUrl,
  ];
}

function ffmpegCommandLine(inputPath: string, icecastUrl: string): string {
  return ["ffmpeg", ...ffmpegArgs(inputPath, icecastUrl).map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
}

let lastPath: string | null = null;
let ffmpegChild: import("node:child_process").ChildProcess | null = null;

function log(msg: string, extra?: unknown) {
  const t = new Date().toISOString();
  if (extra !== undefined) console.log(`[${t}] [encoder]`, msg, extra);
  else console.log(`[${t}] [encoder]`, msg);
}

async function tick() {
  const s = await fetchStation();
  const path = s.nowPlaying?.path ?? null;
  if (path === lastPath) return;

  lastPath = path;

  if (!path) {
    log("Sin pista activa.");
    if (ffmpegChild) {
      ffmpegChild.kill("SIGTERM");
      ffmpegChild = null;
    }
    return;
  }

  log(`Pista activa: ${s.nowPlaying?.title ?? "?"}`, path);

  if (!ICECAST_URL) {
    log("Define RADIOFLOW_ICECAST_URL (p. ej. icecast://source:clave@host:8000/stream) para ver el comando FFmpeg.");
    return;
  }

  const cmdline = ffmpegCommandLine(path, ICECAST_URL);
  log("Comando sugerido:", cmdline);

  if (!ENABLE_FFMPEG) {
    log("Pon ENABLE_FFMPEG=1 para lanzar FFmpeg automáticamente (experimental).");
    return;
  }

  const { spawn } = await import("node:child_process");
  if (ffmpegChild) {
    ffmpegChild.kill("SIGTERM");
    ffmpegChild = null;
  }
  ffmpegChild = spawn("ffmpeg", ffmpegArgs(path, ICECAST_URL), { stdio: "inherit" });
  ffmpegChild.on("exit", (code) => log(`FFmpeg terminó (${code})`));
}

log(`API=${API} · ICECAST configurado=${Boolean(ICECAST_URL)}`);
const loop = () => {
  void tick().catch((e) => console.error("[encoder]", e));
};
loop();
setInterval(loop, INTERVAL_MS);

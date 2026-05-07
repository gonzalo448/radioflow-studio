/**
 * Servicio de salida: estado de la estación por WebSocket (prioritario) o polling,
 * y FFmpeg opcional hacia Icecast. Resuelve rutas relativas con RADIOFLOW_MEDIA_ROOT
 * (misma raíz que MEDIA_ROOT de la API cuando corre en el mismo equipo).
 */

import path from "node:path";
import WebSocket from "ws";

const API = process.env.RADIOFLOW_API_URL ?? "http://127.0.0.1:4000";
const TOKEN = process.env.RADIOFLOW_TOKEN ?? "";
const ICECAST_URL = process.env.RADIOFLOW_ICECAST_URL ?? "";
const POLL_MS = Number(process.env.RADIOFLOW_POLL_MS ?? "15000");
const ENABLE_FFMPEG = process.env.ENABLE_FFMPEG === "1";
const USE_WS = process.env.RADIOFLOW_USE_WS !== "0";
const MEDIA_ROOT = process.env.RADIOFLOW_MEDIA_ROOT ?? "";

type NowPlaying = { path: string; title: string; artist?: string | null } | null;
type StationMsg = { type?: string; payload?: { nowPlaying: NowPlaying } };

let lastAbs: string | null = null;
let ffmpegChild: import("node:child_process").ChildProcess | null = null;
let wsConnected = false;
let wsReconnectAttempt = 0;

function log(msg: string, extra?: unknown) {
  const t = new Date().toISOString();
  if (extra !== undefined) console.log(`[${t}] [encoder]`, msg, extra);
  else console.log(`[${t}] [encoder]`, msg);
}

function wsUrlFromApi(): string {
  const u = new URL(API);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/ws/station";
  u.search = "";
  u.hash = "";
  return u.toString();
}

function resolveFsPath(dbPath: string): string | null {
  if (path.isAbsolute(dbPath)) return path.normalize(dbPath);
  if (!MEDIA_ROOT) {
    log("RADIOFLOW_MEDIA_ROOT no definido; no se resuelve ruta relativa", dbPath);
    return null;
  }
  return path.resolve(MEDIA_ROOT, dbPath);
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

async function handleTrackFromDbPath(dbPath: string | null | undefined, title?: string) {
  if (!dbPath) {
    if (lastAbs !== null) {
      lastAbs = null;
      log("Sin pista activa.");
      if (ffmpegChild) {
        ffmpegChild.kill("SIGTERM");
        ffmpegChild = null;
      }
    }
    return;
  }

  const abs = resolveFsPath(dbPath);
  if (!abs) return;
  if (abs === lastAbs) return;

  lastAbs = abs;
  log(`Pista: ${title ?? "?"}`, abs);

  if (!ICECAST_URL) {
    log("Define RADIOFLOW_ICECAST_URL para comando FFmpeg.");
    log(ffmpegCommandLine(abs, "icecast://source:PASS@host:8000/stream"));
    return;
  }

  const cmdline = ffmpegCommandLine(abs, ICECAST_URL);
  log("Comando sugerido:", cmdline);

  if (!ENABLE_FFMPEG) {
    log("ENABLE_FFMPEG=1 para lanzar FFmpeg automáticamente (experimental).");
    return;
  }

  const { spawn } = await import("node:child_process");
  if (ffmpegChild) {
    ffmpegChild.kill("SIGTERM");
    ffmpegChild = null;
  }
  ffmpegChild = spawn("ffmpeg", ffmpegArgs(abs, ICECAST_URL), { stdio: "inherit" });
  ffmpegChild.on("exit", (code) => log(`FFmpeg terminó (${code})`));
}

async function pollStationOnce() {
  const headers: Record<string, string> = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(`${API}/api/station`, { headers });
  if (!r.ok) throw new Error(`GET /api/station → ${r.status}`);
  const body = (await r.json()) as { nowPlaying: { path: string; title: string } | null };
  await handleTrackFromDbPath(body.nowPlaying?.path ?? null, body.nowPlaying?.title);
}

function connectWs() {
  const url = wsUrlFromApi();
  const headers: Record<string, string> = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const baseMs = 3000;
  const maxMs = 60_000;

  const scheduleReconnect = () => {
    const delay = Math.min(baseMs * 2 ** Math.min(wsReconnectAttempt, 10), maxMs);
    wsReconnectAttempt += 1;
    log(`WebSocket cerrado; reintento ${wsReconnectAttempt} en ${delay}ms…`);
    setTimeout(connectWs, delay);
  };

  const ws = new WebSocket(url, { headers });

  ws.on("open", () => {
    wsConnected = true;
    wsReconnectAttempt = 0;
    log("WebSocket conectado", url);
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data)) as StationMsg;
      if (msg.type === "station" && msg.payload) {
        const np = msg.payload.nowPlaying;
        void handleTrackFromDbPath(np?.path ?? null, np?.title);
      }
    } catch {
      /* ignore */
    }
  });

  ws.on("close", () => {
    wsConnected = false;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    log("WebSocket error", err.message);
  });
}

log(
  `API=${API} · WS=${USE_WS} · poll=${POLL_MS}ms · ICECAST=${Boolean(ICECAST_URL)} · MEDIA_ROOT=${MEDIA_ROOT || "(vacío)"}`,
);

if (USE_WS) {
  connectWs();
} else {
  log("RADIOFLOW_USE_WS=0 — solo polling");
}

void pollStationOnce().catch((e) => console.error("[encoder]", e));
setInterval(() => {
  if (USE_WS && wsConnected) return;
  void pollStationOnce().catch((e) => console.error("[encoder]", e));
}, POLL_MS);

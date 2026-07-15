/**
 * Servicio de salida: estado de la estación por WebSocket (prioritario) o polling,
 * y FFmpeg opcional hacia Icecast. Resuelve rutas relativas con RADIOFLOW_MEDIA_ROOT
 * (misma raíz que MEDIA_ROOT de la API cuando corre en el mismo equipo).
 *
 * URL de salida: `RADIOFLOW_ICECAST_URL` tiene prioridad; si está vacía y hay `RADIOFLOW_TOKEN`
 * (rol dj+), se usa `GET /api/streaming/encoder-url` (destino activo en Marca).
 *
 * Estabilidad: si FFmpeg cae por error (Icecast/red), se reintenta con backoff
 * mientras la pista actual no cambie (ver `RADIOFLOW_FFMPEG_RESTART_*`).
 * Si el archivo termina con éxito (exit 0), NO se vuelve a emitir la misma pista:
 * se pide skip a la API y se espera la siguiente.
 */

import { config as loadEnv } from "dotenv";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { playSegmentCrossfadeOverlapSec, type ApiVoiceTrackOverlaySpec } from "@radioflow/shared";
import { pushIcecastAdminMetadata } from "./icecast-metadata.js";
import { resolveFfmpegPath, spawnFfmpegHidden } from "./ffmpeg-exec.js";
import { decideSkipAfterNaturalEnd, isNaturalFfmpegEnd } from "./eof-skip-policy.js";
import { buildVoiceTrackOverlayFilterComplex } from "./vt-overlay-ffmpeg.js";

const encoderRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(encoderRoot, ".env") });

const API = process.env.RADIOFLOW_API_URL ?? "http://127.0.0.1:4000";
const TOKEN = process.env.RADIOFLOW_TOKEN ?? "";
const ICECAST_ENV = process.env.RADIOFLOW_ICECAST_URL?.trim() ?? "";
const ICECAST_REFRESH_MS = Number(process.env.RADIOFLOW_ICECAST_REFRESH_MS ?? "120000");
const POLL_MS = Number(process.env.RADIOFLOW_POLL_MS ?? "15000");
const ENABLE_FFMPEG = process.env.ENABLE_FFMPEG === "1";
const USE_WS = process.env.RADIOFLOW_USE_WS !== "0";
const MEDIA_ROOT = process.env.RADIOFLOW_MEDIA_ROOT ?? "";

const FFMPEG_KILL_AFTER_MS = Math.max(500, Number(process.env.RADIOFLOW_FFMPEG_KILL_AFTER_MS ?? "8000"));
const FFMPEG_RESTART_BASE_MS = Math.max(500, Number(process.env.RADIOFLOW_FFMPEG_RESTART_BASE_MS ?? "2500"));
const FFMPEG_RESTART_MAX_MS = Math.max(
  FFMPEG_RESTART_BASE_MS,
  Number(process.env.RADIOFLOW_FFMPEG_RESTART_MAX_MS ?? "120000"),
);
/** 0 = sin tope de reintentos por la misma pista (solo errores; nunca buclea un exit 0). */
const FFMPEG_RESTART_MAX_ATTEMPTS = Number(process.env.RADIOFLOW_FFMPEG_RESTART_MAX_ATTEMPTS ?? "40");
/**
 * @deprecated Ya no se reemite la misma pista tras exit 0.
 * Conservado por compat de env; se ignora.
 */
const FFMPEG_LOOP_DELAY_MS = Math.max(0, Number(process.env.RADIOFLOW_FFMPEG_LOOP_DELAY_MS ?? "800"));
void FFMPEG_LOOP_DELAY_MS;
const ICECAST_METADATA = process.env.RADIOFLOW_ICECAST_METADATA !== "0";
const ICECAST_ADMIN_USER = process.env.RADIOFLOW_ICECAST_ADMIN_USER ?? "admin";
const ICECAST_ADMIN_PASSWORD = process.env.RADIOFLOW_ICECAST_ADMIN_PASSWORD ?? "";
const ICECAST_METADATA_URL = process.env.RADIOFLOW_ICECAST_METADATA_URL === "1";

type NowPlayingRow = {
  path: string;
  title: string;
  artist?: string | null;
  id?: string;
  cueStartSec?: number | null;
  cueEndSec?: number | null;
  durationSec?: number | null;
  playbackGainDb?: number;
};

type PlaySegment = {
  assetId: string | null;
  cueStartSec: number;
  cueEndSec: number | null;
  durationSec: number | null;
  playbackGainDb: number;
  cabCrossfadeSec: number;
  cabReferenceGainDb: number;
};

type NowPlayingInfo = {
  assetId: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  stationLogoUrl: string | null;
  stationName: string;
  startedAt: string | null;
  playSegment?: PlaySegment | null;
};

type StationMsg = {
  type?: string;
  payload?: {
    nowPlaying: NowPlayingRow | null;
    nowPlayingInfo?: NowPlayingInfo | null;
    playSegment?: PlaySegment | null;
    voiceTrackOverlay?: ApiVoiceTrackOverlaySpec | null;
    station?: {
      cabCrossfadeSec?: number;
      cabReferenceGainDb?: number;
    };
  };
};

let lastAbs: string | null = null;
let currentMeta: {
  title: string;
  artist: string | null;
  album: string | null;
  assetId: string | null;
  coverUrl: string | null;
  stationLogoUrl: string | null;
  playSegment: PlaySegment | null;
  voiceTrackOverlay: ApiVoiceTrackOverlaySpec | null;
} | null = null;
let lastFfmpegExitCode: number | null = null;
/** C2: session mix A+VT — al exit 0 pedir skipCountOnEnd y no spawnear el VT solo. */
let activeOverlaySession: {
  musicAbs: string;
  nextMusicAssetId: string;
  skipCountOnEnd: number;
} | null = null;
/** Tras EOF con overlay, ignorar pistas hasta llegar a nextMusicAssetId. */
let suppressUntilAssetId: string | null = null;
const HEARTBEAT_MS = Math.max(5000, Number(process.env.RADIOFLOW_ENCODER_HEARTBEAT_MS ?? "10000"));
let ffmpegChild: ChildProcess | null = null;
/** Incrementa en cada spawn; los handlers de `exit` obsoletos no programan reinicio. */
let ffmpegSpawnGeneration = 0;
let ffmpegRestartTimer: ReturnType<typeof setTimeout> | null = null;
let ffmpegRestartAttempts = 0;
let wsConnected = false;
let wsReconnectAttempt = 0;
/** URLs efectivas: env fijo o resolución desde la API (primario + secundarios RB-135). */
let effectiveIcecastUrls: string[] = [];

/** Con sesión (app de escritorio), la config de Emitir/Marca manda salvo override explícito. */
function useFixedIcecastEnv(): boolean {
  if (!ICECAST_ENV) return false;
  if (TOKEN && process.env.RADIOFLOW_ICECAST_URL_FORCE !== "1") return false;
  return true;
}

function log(msg: string, extra?: unknown) {
  const t = new Date().toISOString();
  if (extra !== undefined) console.log(`[${t}] [encoder]`, msg, extra);
  else console.log(`[${t}] [encoder]`, msg);
}

async function refreshEncoderOutputUrl() {
  if (useFixedIcecastEnv()) {
    effectiveIcecastUrls = [ICECAST_ENV];
    return;
  }
  if (!TOKEN) {
    effectiveIcecastUrls = [];
    return;
  }
  try {
    const r = await fetch(`${API}/api/streaming/encoder-urls`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const text = await r.text();
    if (!r.ok) {
      let detail = text.slice(0, 240).replace(/\s+/g, " ");
      try {
        const errBody = JSON.parse(text) as { error?: string };
        if (errBody.error) detail = errBody.error;
      } catch {
        /* noop */
      }
      log(`GET /api/streaming/encoder-urls → HTTP ${r.status}: ${detail}`);
      return;
    }
    const j = JSON.parse(text) as {
      primary?: { url?: string; name?: string };
      extras?: Array<{ url?: string; name?: string }>;
    };
    const urls: string[] = [];
    if (j.primary?.url) urls.push(j.primary.url);
    for (const ex of j.extras ?? []) {
      if (ex.url) urls.push(ex.url);
    }
    effectiveIcecastUrls = urls;
    if (urls.length > 0) {
      log(
        `Salida Icecast desde API (${urls.length} destino${urls.length > 1 ? "s" : ""})`,
        urls.map((u) => u.replace(/:[^:@]+@/, ":****@")).join(" · "),
      );
    }
  } catch (e) {
    log("GET /api/streaming/encoder-urls falló", e instanceof Error ? e.message : String(e));
  }
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
  if (/^https?:\/\//i.test(dbPath.trim())) return dbPath.trim();
  if (path.isAbsolute(dbPath)) return path.normalize(dbPath);
  if (!MEDIA_ROOT) {
    log("RADIOFLOW_MEDIA_ROOT no definido; no se resuelve ruta relativa", dbPath);
    return null;
  }
  return path.resolve(MEDIA_ROOT, dbPath);
}

/** Filtro FFmpeg: atrim (cues) + afade in/out + volume (estación + pista). */
function buildSegmentAudioFilter(seg: PlaySegment | null | undefined): string | null {
  if (!seg) return null;
  const start = Math.max(0, seg.cueStartSec ?? 0);
  const end =
    seg.cueEndSec != null && Number.isFinite(seg.cueEndSec) && seg.cueEndSec > start + 0.2
      ? seg.cueEndSec
      : seg.durationSec != null && seg.durationSec > start + 0.2
        ? seg.durationSec
        : null;
  const fade = playSegmentCrossfadeOverlapSec(
    start,
    end,
    seg.durationSec,
    seg.cabCrossfadeSec ?? 4,
  );
  const gainDb = (seg.cabReferenceGainDb ?? 0) + (seg.playbackGainDb ?? 0);
  const parts: string[] = [];

  if (end != null) {
    parts.push(`atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)}`, "asetpts=PTS-STARTPTS");
  } else if (start > 0.05) {
    parts.push(`atrim=start=${start.toFixed(3)}`, "asetpts=PTS-STARTPTS");
  }

  const dur = end != null ? end - start : null;
  parts.push(`afade=t=in:st=0:d=${fade.toFixed(3)}`);
  if (dur != null && dur > fade * 2 + 0.1) {
    const outSt = dur - fade;
    parts.push(`afade=t=out:st=${outSt.toFixed(3)}:d=${fade.toFixed(3)}`);
  }
  if (Math.abs(gainDb) > 0.05) {
    parts.push(`volume=${gainDb.toFixed(2)}dB`);
  }
  return parts.length > 0 ? parts.join(",") : null;
}

function resolvePlaySegment(
  nowPlaying: NowPlayingRow | null | undefined,
  info: NowPlayingInfo | null | undefined,
  station?: { cabCrossfadeSec?: number; cabReferenceGainDb?: number } | null,
): PlaySegment | null {
  if (info?.playSegment) return info.playSegment;
  if (!nowPlaying?.path && !info?.assetId) return null;
  const cueStart =
    nowPlaying?.cueStartSec != null && Number.isFinite(nowPlaying.cueStartSec)
      ? Math.max(0, nowPlaying.cueStartSec)
      : 0;
  let cueEnd: number | null =
    nowPlaying?.cueEndSec != null &&
    Number.isFinite(nowPlaying.cueEndSec) &&
    nowPlaying.cueEndSec > cueStart + 0.2
      ? nowPlaying.cueEndSec
      : null;
  if (
    cueEnd == null &&
    nowPlaying?.durationSec != null &&
    nowPlaying.durationSec > cueStart + 0.2
  ) {
    cueEnd = nowPlaying.durationSec;
  }
  return {
    assetId: info?.assetId ?? nowPlaying?.id ?? null,
    cueStartSec: cueStart,
    cueEndSec: cueEnd,
    durationSec: nowPlaying?.durationSec ?? null,
    playbackGainDb: nowPlaying?.playbackGainDb ?? 0,
    cabCrossfadeSec: station?.cabCrossfadeSec ?? 4,
    cabReferenceGainDb: station?.cabReferenceGainDb ?? 0,
  };
}

function ffmpegArgs(
  inputPath: string,
  icecastUrls: string[],
  meta?: {
    title: string;
    artist: string | null;
    playSegment?: PlaySegment | null;
    voiceTrackOverlay?: ApiVoiceTrackOverlaySpec | null;
  } | null,
  vtAbs?: string | null,
): string[] {
  const urls = icecastUrls.filter(Boolean);
  if (urls.length === 0) return [];

  const overlay = meta?.voiceTrackOverlay ?? null;
  const seg = meta?.playSegment ?? null;
  if (overlay && vtAbs && seg) {
    let fc = buildVoiceTrackOverlayFilterComplex(seg, overlay);
    if (urls.length > 1) {
      const outs = urls.map((_, i) => `[o${i}]`).join("");
      fc = `${fc};[mix]asplit=${urls.length}${outs}`;
    }
    const args = [
      "-re",
      "-i",
      inputPath,
      "-i",
      vtAbs,
      "-filter_complex",
      fc,
      "-vn",
      "-ar",
      "44100",
      "-ac",
      "2",
    ];
    for (let i = 0; i < urls.length; i++) {
      const icecastUrl = urls[i]!;
      if (meta?.title?.trim()) args.push("-metadata", `title=${meta.title.trim()}`);
      if (meta?.artist?.trim()) args.push("-metadata", `artist=${meta.artist.trim()}`);
      args.push("-map", urls.length === 1 ? "[mix]" : `[o${i}]`);
      args.push(
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        "-content_type",
        "audio/mpeg",
        "-f",
        "mp3",
        icecastUrl,
      );
    }
    return args;
  }

  // -ar/-ac fijos: evita zumbidos por renegociación de formato hacia Icecast.
  const args = ["-re", "-i", inputPath, "-vn", "-ar", "44100", "-ac", "2"];
  const af = buildSegmentAudioFilter(seg);
  if (af) {
    args.push("-af", af);
  }
  for (const icecastUrl of urls) {
    if (meta?.title?.trim()) args.push("-metadata", `title=${meta.title.trim()}`);
    if (meta?.artist?.trim()) args.push("-metadata", `artist=${meta.artist.trim()}`);
    // Con -af no mapear el stream crudo (saltaría atrim/afade/volume).
    if (!af) {
      args.push("-map", "0:a:0");
    }
    args.push(
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-content_type",
      "audio/mpeg",
      "-f",
      "mp3",
      icecastUrl,
    );
  }
  return args;
}

function ffmpegCommandLine(
  inputPath: string,
  icecastUrls: string[],
  meta?: {
    title: string;
    artist: string | null;
    playSegment?: PlaySegment | null;
    voiceTrackOverlay?: ApiVoiceTrackOverlaySpec | null;
  } | null,
  vtAbs?: string | null,
): string {
  return [
    "ffmpeg",
    ...ffmpegArgs(inputPath, icecastUrls, meta, vtAbs).map((a) => (/\s/.test(a) ? `"${a}"` : a)),
  ].join(" ");
}

async function postEncoderHeartbeat(): Promise<void> {
  if (!TOKEN) return;
  try {
    await fetch(`${API}/api/streaming/encoder-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ffmpegActive: Boolean(ffmpegChild),
        wsConnected,
        title: currentMeta?.title ?? null,
        artist: currentMeta?.artist ?? null,
        album: currentMeta?.album ?? null,
        assetId: currentMeta?.assetId ?? null,
        coverUrl: currentMeta?.coverUrl ?? null,
        stationLogoUrl: currentMeta?.stationLogoUrl ?? null,
        lastFfmpegExitCode,
      }),
    });
  } catch {
    /* no crítico */
  }
}

function clearFfmpegRestartTimer(): void {
  if (ffmpegRestartTimer) {
    clearTimeout(ffmpegRestartTimer);
    ffmpegRestartTimer = null;
  }
}

function resetFfmpegBackoff(): void {
  clearFfmpegRestartTimer();
  ffmpegRestartAttempts = 0;
}

async function killFfmpegProcess(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
      finish();
    }, FFMPEG_KILL_AFTER_MS);
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}

/** Detiene FFmpeg y cancela reinicios pendientes (p. ej. cambio de pista). */
async function stopFfmpeg(reason: string): Promise<void> {
  clearFfmpegRestartTimer();
  const ch = ffmpegChild;
  ffmpegChild = null;
  if (!ch) return;
  log(`FFmpeg deteniendo (${reason})`);
  await killFfmpegProcess(ch);
}

function scheduleFfmpegRestart(cause: string, absForThisSession: string): void {
  clearFfmpegRestartTimer();
  if (!ENABLE_FFMPEG) return;

  const isNaturalEnd = isNaturalFfmpegEnd(cause);

  // Fin natural del archivo: no reemitir (evita jingles/canciones en bucle hasta durationSec).
  // Pedir avance de cola; la siguiente pista llega por WS/poll.
  if (isNaturalEnd) {
    ffmpegRestartAttempts = 0;
    log("Fin natural del archivo — no se reemite la misma pista", absForThisSession);
    void requestStationSkipAfterNaturalEnd(absForThisSession);
    return;
  }

  if (FFMPEG_RESTART_MAX_ATTEMPTS > 0 && ffmpegRestartAttempts >= FFMPEG_RESTART_MAX_ATTEMPTS) {
    log(
      `FFmpeg: máximo de reintentos alcanzado (${FFMPEG_RESTART_MAX_ATTEMPTS}); revise Icecast/red. Último motivo: ${cause}`,
    );
    return;
  }
  ffmpegRestartAttempts += 1;
  let delay = Math.min(
    FFMPEG_RESTART_BASE_MS * 2 ** Math.min(ffmpegRestartAttempts - 1, 14),
    FFMPEG_RESTART_MAX_MS,
  );
  // Icecast mantiene el mount ~source-timeout (10s) tras un intento fallido; reintentos rápidos → 403 mount in use.
  if (/^exit:(?!0$)/.test(cause)) {
    delay = Math.max(delay, 12_000);
  }
  const spawnReason = `backoff:${cause}`;
  log(`FFmpeg: reinicio en ${delay}ms (intento ${ffmpegRestartAttempts}, ${cause})`);

  ffmpegRestartTimer = setTimeout(() => {
    ffmpegRestartTimer = null;
    if (!ENABLE_FFMPEG || !lastAbs || effectiveIcecastUrls.length === 0) return;
    if (lastAbs !== absForThisSession) return;
    void spawnFfmpeg(absForThisSession, spawnReason);
  }, delay);
}

async function postStationSkipOnce(): Promise<boolean> {
  if (!TOKEN) return false;
  try {
    const res = await fetch(`${API}/api/station/skip`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log(`Skip tras fin de archivo: HTTP ${res.status}`, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    log("Skip tras fin de archivo falló", e instanceof Error ? e.message : String(e));
    return false;
  }
}

async function requestStationSkipAfterNaturalEnd(absForThisSession: string): Promise<void> {
  if (!TOKEN) {
    log("Sin RADIOFLOW_TOKEN: espere a que la API/Cabina avance la cola tras fin de archivo.");
    return;
  }
  // Breve espera: evita carrera si el cliente Web Audio ya pidió skip.
  await new Promise((r) => setTimeout(r, 350));
  if (lastAbs !== absForThisSession) return;

  const overlaySkips = activeOverlaySession?.skipCountOnEnd ?? 1;
  const nextMusicId = activeOverlaySession?.nextMusicAssetId ?? null;
  if (activeOverlaySession && activeOverlaySession.musicAbs === absForThisSession) {
    suppressUntilAssetId = nextMusicId;
    activeOverlaySession = null;
  }

  try {
    const stRes = await fetch(`${API}/api/station`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (stRes.ok) {
      const st = (await stRes.json()) as {
        nowPlaying?: { path?: string; id?: string } | null;
      };
      const npPath = st.nowPlaying?.path ?? null;
      const npAbs = npPath ? resolveFsPath(npPath) : null;
      const decision = decideSkipAfterNaturalEnd({
        finishedAbsNormalized: path.normalize(absForThisSession),
        nowPlayingAbsNormalized: npAbs ? path.normalize(npAbs) : null,
        hasNowPlaying: Boolean(st.nowPlaying),
      });
      if (decision === "already_advanced") {
        log("Cola ya avanzada tras fin de archivo — skip omitido");
        if (nextMusicId && st.nowPlaying?.id === nextMusicId) {
          suppressUntilAssetId = null;
        }
        return;
      }
      if (decision === "idle") {
        return;
      }
    }
  } catch {
    /* seguir con skip por si el GET falló */
  }

  if (lastAbs !== absForThisSession) return;
  let ok = 0;
  for (let i = 0; i < overlaySkips; i++) {
    if (await postStationSkipOnce()) ok += 1;
    else break;
    if (i + 1 < overlaySkips) await new Promise((r) => setTimeout(r, 80));
  }
  if (ok > 0) {
    log(
      overlaySkips > 1
        ? `Skip×${ok} tras fin natural (C2 overlay VT→siguiente música)`
        : "Skip solicitado tras fin natural de archivo",
    );
  }
}

async function spawnFfmpeg(abs: string, reason: string, vtAbs?: string | null): Promise<void> {
  if (!ENABLE_FFMPEG || effectiveIcecastUrls.length === 0) return;

  if (ffmpegChild) {
    await stopFfmpeg("respawn");
  }

  ffmpegSpawnGeneration += 1;
  const gen = ffmpegSpawnGeneration;

  log(`FFmpeg lanzando (${reason})`, vtAbs ? `${abs} + VT ${vtAbs}` : abs);
  const cmdline = ffmpegCommandLine(abs, effectiveIcecastUrls, currentMeta, vtAbs);
  log("Comando:", cmdline);
  log("Ejecutable:", resolveFfmpegPath());
  if (currentMeta) log("Metadatos Icecast", `${currentMeta.artist ?? ""} — ${currentMeta.title}`);

  const child = spawnFfmpegHidden(
    ffmpegArgs(abs, effectiveIcecastUrls, currentMeta, vtAbs),
    (line) => {
      log("FFmpeg:", line);
    },
  );
  ffmpegChild = child;

  child.on("exit", (code, signal) => {
    if (gen !== ffmpegSpawnGeneration) return;
    ffmpegChild = null;
    const c = code ?? -1;
    lastFfmpegExitCode = c;
    void postEncoderHeartbeat();
    log(`FFmpeg terminó code=${c} signal=${signal ?? "(ninguna)"}`);
    if (c !== 0) {
      log(
        "Si ves 403 Forbidden: el mount /stream suele estar ocupado (otro FFmpeg o `docker compose` encoder/icecast-hold). Solo una fuente a la vez.",
      );
    }
    if (!ENABLE_FFMPEG || !lastAbs || effectiveIcecastUrls.length === 0) return;
    if (lastAbs !== abs) return;
    scheduleFfmpegRestart(`exit:${c}`, abs);
  });

  child.on("error", (err) => {
    log("FFmpeg error", err.message);
    if (gen !== ffmpegSpawnGeneration) return;
    ffmpegChild = null;
    if (!lastAbs || effectiveIcecastUrls.length === 0 || !ENABLE_FFMPEG) return;
    if (lastAbs !== abs) return;
    scheduleFfmpegRestart("spawn/child error", abs);
  });
}

async function handleTrackFromDbPath(
  dbPath: string | null | undefined,
  title?: string,
  artist?: string | null,
  info?: NowPlayingInfo | null,
  nowPlaying?: NowPlayingRow | null,
  station?: { cabCrossfadeSec?: number; cabReferenceGainDb?: number } | null,
  voiceTrackOverlay?: ApiVoiceTrackOverlaySpec | null,
) {
  if (!dbPath) {
    if (lastAbs !== null) {
      lastAbs = null;
      currentMeta = null;
      activeOverlaySession = null;
      suppressUntilAssetId = null;
      resetFfmpegBackoff();
      log("Sin pista activa.");
      await stopFfmpeg("sin-pista");
      void postEncoderHeartbeat();
    }
    return;
  }

  const assetId = info?.assetId ?? nowPlaying?.id ?? null;
  if (suppressUntilAssetId) {
    if (assetId === suppressUntilAssetId) {
      suppressUntilAssetId = null;
    } else {
      log("C2: omitiendo pista intermedia tras overlay VT (esperando siguiente música)", assetId);
      return;
    }
  }

  const abs = resolveFsPath(dbPath);
  if (!abs) return;
  const playSegment = resolvePlaySegment(nowPlaying ?? null, info ?? null, station ?? null);
  const overlayCandidate =
    voiceTrackOverlay &&
    playSegment &&
    voiceTrackOverlay.voiceTrackPath &&
    voiceTrackOverlay.nextMusicAssetId
      ? voiceTrackOverlay
      : null;
  const vtAbs = overlayCandidate ? resolveFsPath(overlayCandidate.voiceTrackPath) : null;
  if (overlayCandidate && !vtAbs) {
    log("C2: no se resolvió path del voicetrack; emisión sin overlay", overlayCandidate.voiceTrackPath);
  }
  const effectiveOverlay = overlayCandidate && vtAbs ? overlayCandidate : null;

  const meta = {
    title: info?.title ?? title ?? "RadioFlow",
    artist: info?.artist ?? artist ?? null,
    album: info?.album ?? null,
    assetId,
    coverUrl: info?.coverUrl ?? null,
    stationLogoUrl: info?.stationLogoUrl ?? null,
    playSegment,
    voiceTrackOverlay: effectiveOverlay,
  };
  const segKey = playSegment
    ? `${playSegment.cueStartSec}|${playSegment.cueEndSec}|${playSegment.cabCrossfadeSec}|${playSegment.playbackGainDb}|${playSegment.cabReferenceGainDb}|${effectiveOverlay?.voiceTrackAssetId ?? ""}|${effectiveOverlay?.overlayAtSec ?? ""}`
    : "";
  const prevSegKey = currentMeta?.playSegment
    ? `${currentMeta.playSegment.cueStartSec}|${currentMeta.playSegment.cueEndSec}|${currentMeta.playSegment.cabCrossfadeSec}|${currentMeta.playSegment.playbackGainDb}|${currentMeta.playSegment.cabReferenceGainDb}|${currentMeta.voiceTrackOverlay?.voiceTrackAssetId ?? ""}|${currentMeta.voiceTrackOverlay?.overlayAtSec ?? ""}`
    : "";
  if (
    abs === lastAbs &&
    currentMeta?.title === meta.title &&
    currentMeta?.artist === meta.artist &&
    currentMeta?.coverUrl === meta.coverUrl &&
    segKey === prevSegKey
  ) {
    return;
  }

  lastAbs = abs;
  currentMeta = meta;
  activeOverlaySession = effectiveOverlay
    ? {
        musicAbs: abs,
        nextMusicAssetId: effectiveOverlay.nextMusicAssetId,
        skipCountOnEnd: effectiveOverlay.skipCountOnEnd,
      }
    : null;
  resetFfmpegBackoff();
  log(`Pista: ${meta.artist ? `${meta.artist} — ` : ""}${meta.title}`, abs);
  if (playSegment) {
    log(
      "Segmento A1",
      `cues ${playSegment.cueStartSec}→${playSegment.cueEndSec ?? "eof"} · xf ${playSegment.cabCrossfadeSec}s · gain ${(playSegment.cabReferenceGainDb + playSegment.playbackGainDb).toFixed(1)} dB`,
    );
  }
  if (effectiveOverlay) {
    log(
      "C2 overlay VT",
      `vt=${effectiveOverlay.voiceTrackAssetId} @${effectiveOverlay.overlayAtSec}s duck=${effectiveOverlay.duckDb}dB → next=${effectiveOverlay.nextMusicAssetId}`,
    );
  }
  if (meta.coverUrl) log("Carátula Now Playing", meta.coverUrl);
  void postEncoderHeartbeat();

  if (!useFixedIcecastEnv()) {
    await refreshEncoderOutputUrl();
  }

  void maybePushIcecastMetadata();

  if (effectiveIcecastUrls.length === 0) {
    log("Define RADIOFLOW_ICECAST_URL o configura destino activo en Marca + RADIOFLOW_TOKEN (dj+).");
    log(ffmpegCommandLine(abs, ["icecast://source:PASS@host:8000/stream"], currentMeta, vtAbs));
    return;
  }

  if (!ENABLE_FFMPEG) {
    log("ENABLE_FFMPEG=1 para lanzar FFmpeg automáticamente.");
    log(ffmpegCommandLine(abs, effectiveIcecastUrls, currentMeta, vtAbs));
    return;
  }

  await stopFfmpeg("cambio-de-pista");
  await spawnFfmpeg(abs, effectiveOverlay ? "nueva-pista+vt-overlay" : "nueva-pista", vtAbs);
  // AzuraCast / Icecast leen StreamTitle vía admin; reintentar tras conectar la fuente.
  void maybePushIcecastMetadata();
  setTimeout(() => {
    void maybePushIcecastMetadata();
  }, 2500);
}

async function maybePushIcecastMetadata(): Promise<void> {
  if (!ICECAST_METADATA || !currentMeta || effectiveIcecastUrls.length === 0) return;
  await pushIcecastAdminMetadata(
    effectiveIcecastUrls[0]!,
    {
      title: currentMeta.title,
      artist: currentMeta.artist,
      coverUrl: currentMeta.coverUrl,
    },
    {
      adminUser: ICECAST_ADMIN_USER,
      adminPassword: ICECAST_ADMIN_PASSWORD,
      includeCoverUrl: ICECAST_METADATA_URL,
      log,
    },
  );
}

async function pollStationOnce() {
  const headers: Record<string, string> = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(`${API}/api/station`, { headers });
  if (!r.ok) throw new Error(`GET /api/station → ${r.status}`);
  const body = (await r.json()) as {
    nowPlaying: NowPlayingRow | null;
    nowPlayingInfo?: NowPlayingInfo | null;
    playSegment?: PlaySegment | null;
    voiceTrackOverlay?: ApiVoiceTrackOverlaySpec | null;
    station?: { cabCrossfadeSec?: number; cabReferenceGainDb?: number };
  };
  const info = body.nowPlayingInfo
    ? { ...body.nowPlayingInfo, playSegment: body.nowPlayingInfo.playSegment ?? body.playSegment ?? null }
    : body.playSegment
      ? {
          assetId: body.nowPlaying?.id ?? null,
          title: body.nowPlaying?.title ?? "RadioFlow",
          artist: body.nowPlaying?.artist ?? null,
          album: null,
          coverUrl: null,
          stationLogoUrl: null,
          stationName: "RadioFlow",
          startedAt: null,
          playSegment: body.playSegment,
        }
      : null;
  await handleTrackFromDbPath(
    body.nowPlaying?.path ?? null,
    body.nowPlaying?.title,
    body.nowPlaying?.artist ?? null,
    info,
    body.nowPlaying,
    body.station ?? null,
    body.voiceTrackOverlay ?? null,
  );
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
        const infoRaw = msg.payload.nowPlayingInfo ?? null;
        const info = infoRaw
          ? {
              ...infoRaw,
              playSegment: infoRaw.playSegment ?? msg.payload.playSegment ?? null,
            }
          : msg.payload.playSegment
            ? {
                assetId: np?.id ?? null,
                title: np?.title ?? "RadioFlow",
                artist: np?.artist ?? null,
                album: null,
                coverUrl: null,
                stationLogoUrl: null,
                stationName: "RadioFlow",
                startedAt: null,
                playSegment: msg.payload.playSegment,
              }
            : null;
        void handleTrackFromDbPath(
          np?.path ?? null,
          np?.title,
          np?.artist ?? null,
          info,
          np ?? null,
          msg.payload.station ?? null,
          msg.payload.voiceTrackOverlay ?? null,
        );
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
  `API=${API} · WS=${USE_WS} · poll=${POLL_MS}ms · ICECAST=${useFixedIcecastEnv() ? "env" : TOKEN ? "api" : "none"} · MEDIA_ROOT=${MEDIA_ROOT || "(vacío)"} · FFMPEG_RESTART maxAttempts=${FFMPEG_RESTART_MAX_ATTEMPTS === 0 ? "∞" : String(FFMPEG_RESTART_MAX_ATTEMPTS)}`,
);

void refreshEncoderOutputUrl().catch(() => {});

if (ICECAST_REFRESH_MS >= 5000 && !useFixedIcecastEnv() && TOKEN) {
  setInterval(() => {
    void refreshEncoderOutputUrl();
  }, ICECAST_REFRESH_MS);
}

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

setInterval(() => {
  void postEncoderHeartbeat();
}, HEARTBEAT_MS);

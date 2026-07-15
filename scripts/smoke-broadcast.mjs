/**
 * A5 — Smoke broadcast: FFmpeg → Icecast (o mock local) debe fallar si el aire se rompe.
 *
 * Modos:
 *   SMOKE_BROADCAST_MODE=icecast (default) — publica un tono a Icecast y exige bytes en el mount
 *   SMOKE_BROADCAST_MODE=mock — sin Icecast: encode lavfi→MP3 con filtros tipo PlaySegment (atrim/afade/volume)
 *
 * Variables (icecast):
 *   SMOKE_ICECAST_HOST=127.0.0.1
 *   SMOKE_ICECAST_PORT=8000
 *   SMOKE_ICECAST_USER=source
 *   SMOKE_ICECAST_PASSWORD=radioflow_dev   (o RADIOFLOW_ICECAST_SOURCE_PASSWORD)
 *   SMOKE_ICECAST_MOUNT=/stream
 *   SMOKE_BROADCAST_MIN_BYTES=8000
 *   SMOKE_BROADCAST_TIMEOUT_MS=45000
 *
 * Uso:
 *   npm run smoke:broadcast
 *   SMOKE_BROADCAST_MODE=mock npm run smoke:broadcast
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = (process.env.SMOKE_BROADCAST_MODE ?? "icecast").toLowerCase();
const ffmpegBin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

function log(msg) {
  console.log(`[smoke-broadcast] ${msg}`);
}

function fail(msg) {
  console.error(`[smoke-broadcast] FAIL: ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function whichFfmpeg() {
  return new Promise((resolve) => {
    const child = spawn(ffmpegBin, ["-version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d) => {
      out += d.toString();
    });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => resolve(code === 0 ? out.split("\n")[0] ?? "ffmpeg" : null));
  });
}

/**
 * Filtro alineado al encoder (PlaySegmentSpec / A1): atrim + afade + volume.
 * Si FFmpeg rechaza estos filtros, el aire real también fallaría.
 */
function playSegmentAf() {
  // Ventana corta con fundidos: suficiente para validar la cadena.
  return "atrim=start=0:end=3,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.08,afade=t=out:st=2.7:d=0.08,volume=0dB";
}

function spawnFfmpeg(args, { label }) {
  log(`${label}: ${ffmpegBin} ${args.join(" ")}`);
  const child = spawn(ffmpegBin, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", (d) => {
    const s = d.toString();
    stderr += s;
    if (process.env.SMOKE_BROADCAST_VERBOSE === "1") process.stderr.write(s);
  });
  return {
    child,
    getStderr: () => stderr,
    kill() {
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
    },
  };
}

async function runMock() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-smoke-broadcast-"));
  const outMp3 = path.join(tmpDir, "segment.mp3");
  const af = playSegmentAf();
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-vn",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-af",
    af,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-f",
    "mp3",
    outMp3,
  ];

  const { child, getStderr } = spawnFfmpeg(args, { label: "mock-encode" });
  const code = await new Promise((resolve) => {
    child.on("error", (e) => {
      fail(`no se pudo ejecutar FFmpeg: ${e.message}`);
    });
    child.on("exit", (c) => resolve(c ?? 1));
  });

  if (code !== 0) {
    fail(`FFmpeg mock exit ${code}. stderr:\n${getStderr().slice(-800)}`);
  }
  if (!fs.existsSync(outMp3)) fail(`no se generó ${outMp3}`);
  const size = fs.statSync(outMp3).size;
  const minBytes = Number(process.env.SMOKE_BROADCAST_MIN_BYTES ?? "4000");
  if (size < minBytes) fail(`MP3 mock demasiado pequeño (${size} < ${minBytes} bytes)`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  log(`OK mock: PlaySegment filters + libmp3lame → ${size} bytes`);
}

async function waitHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.status > 0) return true;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  return false;
}

async function readMinBytes(streamUrl, minBytes, perAttemptMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), perAttemptMs);
  try {
    const r = await fetch(streamUrl, {
      signal: ac.signal,
      headers: { Accept: "*/*", "Icy-MetaData": "0" },
    });
    if (!r.ok || !r.body) return { ok: false, status: r.status, bytes: 0, contentType: r.headers.get("content-type") };
    const reader = r.body.getReader();
    let bytes = 0;
    while (bytes < minBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    return {
      ok: bytes >= minBytes,
      status: r.status,
      bytes,
      contentType: r.headers.get("content-type"),
    };
  } catch (e) {
    return { ok: false, status: 0, bytes: 0, contentType: null, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForStreamBytes(streamUrl, minBytes, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { ok: false, status: 0, bytes: 0 };
  while (Date.now() < deadline) {
    last = await readMinBytes(streamUrl, minBytes, 8000);
    if (last.ok) return last;
    await sleep(1000);
  }
  return last;
}

async function runIcecast() {
  const host = process.env.SMOKE_ICECAST_HOST ?? "127.0.0.1";
  const port = process.env.SMOKE_ICECAST_PORT ?? process.env.RADIOFLOW_ICECAST_PUBLISH_PORT ?? "8000";
  const user = process.env.SMOKE_ICECAST_USER ?? "source";
  const password =
    process.env.SMOKE_ICECAST_PASSWORD ?? process.env.RADIOFLOW_ICECAST_SOURCE_PASSWORD ?? "radioflow_dev";
  const mount = (process.env.SMOKE_ICECAST_MOUNT ?? "/stream").startsWith("/")
    ? process.env.SMOKE_ICECAST_MOUNT ?? "/stream"
    : `/${process.env.SMOKE_ICECAST_MOUNT}`;
  const minBytes = Number(process.env.SMOKE_BROADCAST_MIN_BYTES ?? "8000");
  const timeoutMs = Number(process.env.SMOKE_BROADCAST_TIMEOUT_MS ?? "45000");

  const baseHttp = `http://${host}:${port}`;
  const streamUrl = `${baseHttp}${mount}`;
  const icecastUrl = `icecast://${user}:${encodeURIComponent(password)}@${host}:${port}${mount}`;

  log(`Esperando Icecast ${baseHttp}…`);
  if (!(await waitHttpOk(baseHttp, Math.min(timeoutMs, 30_000)))) {
    fail(`Icecast no responde en ${baseHttp} (¿docker compose --profile broadcast up -d icecast?)`);
  }

  // Antes de publicar: el mount suele ser 404. Si ya hay fuente (icecast-hold), igual validamos bytes.
  const af = playSegmentAf();
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=30",
    "-vn",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-af",
    af,
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

  const proc = spawnFfmpeg(args, { label: "publish" });
  let publishExit = null;
  proc.child.on("exit", (c) => {
    publishExit = c;
  });
  proc.child.on("error", (e) => {
    proc.kill();
    fail(`no se pudo ejecutar FFmpeg: ${e.message}`);
  });

  try {
    // Dar tiempo a conectar como source
    await sleep(2500);
    if (publishExit != null && publishExit !== 0) {
      fail(`FFmpeg publicó y salió con código ${publishExit}. stderr:\n${proc.getStderr().slice(-1200)}`);
    }

    log(`Leyendo mount ${streamUrl} (mín. ${minBytes} bytes)…`);
    const got = await waitForStreamBytes(streamUrl, minBytes, timeoutMs);
    if (!got.ok) {
      fail(
        `no hay audio suficiente en ${streamUrl} (status=${got.status}, bytes=${got.bytes}, ct=${got.contentType}, err=${got.error ?? "n/a"}). stderr FFmpeg:\n${proc.getStderr().slice(-1200)}`,
      );
    }
    log(`OK icecast: ${got.bytes} bytes desde ${streamUrl} (content-type=${got.contentType ?? "?"})`);
  } finally {
    proc.kill();
    await sleep(400);
  }
}

async function main() {
  const ver = await whichFfmpeg();
  if (!ver) fail(`FFmpeg no disponible (${ffmpegBin}). Instalá FFmpeg o definí FFMPEG_PATH.`);
  log(ver);
  log(`mode=${mode}`);

  if (mode === "mock") {
    await runMock();
    return;
  }
  if (mode === "icecast") {
    await runIcecast();
    return;
  }
  fail(`SMOKE_BROADCAST_MODE desconocido: ${mode} (usá icecast|mock)`);
}

main().catch((e) => fail(e?.stack || e?.message || String(e)));

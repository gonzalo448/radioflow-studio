"use strict";

/**
 * Escritorio RadioFlow — hacia modo standalone (un solo PC, sin Postgres obligatorio):
 * 1) API Node embebida + SQLite bajo `app.getPath("userData")`.
 * 2) Motor de playout local (cola + reloj + crossfade) alineado a flujo tipo RadioBOSS.
 * 3) Empaquetado multiplataforma (ya: NSIS/portable/AppImage/dmg).
 *
 * La UI sigue siendo la web empaquetada; el bridge IPC se amplía según haga falta el motor.
 * Cabina: `radioflow:cab-meter-sample` (VU bus Web Audio) → main guarda última muestra y hace broadcast al HUD nativo (`radioflow:cab-meter-update`). Log opcional `RADIOFLOW_CAB_METER_LOG=1`. Desactivar HUD: `RADIOFLOW_CAB_METER_HUD=0`.
 */
const { app, BrowserWindow, ipcMain, dialog, screen, Menu, globalShortcut, shell } = require("electron");
const { wireAutoUpdater, checkForUpdates } = require("./auto-updater.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const nodePath = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync, execFileSync } = require("node:child_process");

function sqliteFileUrl(absPath) {
  return `file:${nodePath.normalize(absPath).replace(/\\/g, "/")}`;
}

const isDev = process.env.RADIOFLOW_DEV === "1";

/** Evita dos ventanas Electron si se lanza `npm run dev` dos veces. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

/** Misma carpeta que el instalador: %APPDATA%\\radioflow-studio (evita `@radioflow` en la ruta). */
const overrideUserData = (process.env.RADIOFLOW_USER_DATA || "").trim();
app.setPath(
  "userData",
  overrideUserData
    ? nodePath.resolve(overrideUserData)
    : nodePath.join(app.getPath("appData"), "radioflow-studio"),
);

/** API embebida: instalación empaquetada u opt-in en desarrollo. */
function embeddedApiEnabled() {
  return app.isPackaged || process.env.RADIOFLOW_EMBEDDED_API === "1";
}

let apiChild = null;
let encoderChild = null;
/** Último payload de arranque (para reinicio automático). */
let lastEncoderPayload = null;
/** El usuario quiere el encoder al aire (no lo apagó a propósito). */
let encoderWantRunning = false;
let encoderRestartAttempts = 0;
let encoderRestartTimer = null;
const {
  shouldScheduleEncoderRestart,
  encoderRestartDelayMs,
  onEncoderStartSuccess,
  onEncoderStoppedByUser,
  onEncoderExited,
} = require("./encoder-watchdog.cjs");

function clearEncoderRestartTimer() {
  if (encoderRestartTimer) {
    clearTimeout(encoderRestartTimer);
    encoderRestartTimer = null;
  }
}

function scheduleEncoderRestart(reason) {
  const state = {
    wantRunning: encoderWantRunning,
    running: Boolean(encoderChild && !encoderChild.killed),
    restartAttempts: encoderRestartAttempts,
    lastExitAtMs: Date.now(),
  };
  if (!shouldScheduleEncoderRestart(state) || !lastEncoderPayload) return;
  clearEncoderRestartTimer();
  const delay = encoderRestartDelayMs(encoderRestartAttempts);
  console.log(
    `[radioflow] encoder: reinicio automático en ${delay}ms (${reason}, intento ${encoderRestartAttempts + 1})`,
  );
  encoderRestartTimer = setTimeout(() => {
    encoderRestartTimer = null;
    if (!encoderWantRunning || !lastEncoderPayload) return;
    if (encoderChild && !encoderChild.killed) return;
    void startEmbeddedEncoder(lastEncoderPayload, { fromWatchdog: true });
  }, delay);
}
let embeddedApiOrigin = null;

function embeddedApiPort() {
  return String(process.env.RADIOFLOW_API_PORT || "4000");
}

function getEmbeddedApiOrigin() {
  return embeddedApiOrigin ?? `http://127.0.0.1:${embeddedApiPort()}`;
}

function syncRendererApiOrigin(win) {
  if (!embeddedApiEnabled() || !win?.webContents || win.webContents.isDestroyed()) return;
  const origin = getEmbeddedApiOrigin();
  const js = `(function(){try{localStorage.setItem("radioflow_api_origin",${JSON.stringify(origin)});window.dispatchEvent(new CustomEvent("radioflow:api-origin-changed"));}catch(e){}})()`;
  void win.webContents.executeJavaScript(js).catch(() => {});
}

const CART_HOTKEY_ACCELERATORS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
let lastCartKeyAt = 0;

function unregisterCartHotkeys() {
  for (const acc of CART_HOTKEY_ACCELERATORS) {
    try {
      globalShortcut.unregister(acc);
    } catch {
      /* */
    }
  }
}

function registerCartHotkeys() {
  unregisterCartHotkeys();
  for (const acc of CART_HOTKEY_ACCELERATORS) {
    try {
      globalShortcut.register(acc, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const now = Date.now();
          if (now - lastCartKeyAt < 280) return;
          lastCartKeyAt = now;
          mainWindow.webContents.send("radioflow:cart-key", acc);
        }
      });
    } catch (err) {
      console.warn("[radioflow] cart hotkey register failed", acc, err);
    }
  }
}

/** Ventana principal (SPA); distinto del HUD VU. */
let mainWindow = null;

function resolveApiHome() {
  if (app.isPackaged) {
    return nodePath.join(process.resourcesPath, "api");
  }
  return nodePath.join(__dirname, "..", "api");
}

async function readOrCreateJwtSecret(userData) {
  const p = nodePath.join(userData, "jwt-secret.txt");
  try {
    const s = (await fs.readFile(p, "utf8")).trim();
    if (s.length >= 32) return s;
  } catch {
    /* crear */
  }
  const secret = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(p, `${secret}\n`, "utf8");
  return secret;
}

async function waitApiReady(timeoutMs) {
  const port = process.env.RADIOFLOW_API_PORT || "4000";
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health/ready`);
      if (r.ok) return true;
    } catch {
      /* aún no */
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

function ensureEmbeddedApiNodeModules(apiHome) {
  const vendor = nodePath.join(apiHome, "vendor");
  const nm = nodePath.join(apiHome, "node_modules");
  if (!fssync.existsSync(vendor)) return;
  try {
    if (fssync.existsSync(nm)) {
      const st = fssync.lstatSync(nm);
      if (st.isSymbolicLink() || st.isDirectory()) return;
    }
    fssync.symlinkSync(vendor, nm, process.platform === "win32" ? "junction" : "dir");
    console.log("[radioflow] API embebida: junction node_modules → vendor");
  } catch (err) {
    console.error("[radioflow] No se pudo enlazar vendor como node_modules:", err);
  }
}

async function startEmbeddedApi() {
  const apiHome = resolveApiHome();
  const entry = nodePath.join(apiHome, "dist", "index.js");
  if (!fssync.existsSync(entry)) {
    console.error("[radioflow] API embebida: no existe", entry);
    return false;
  }
  ensureEmbeddedApiNodeModules(apiHome);

  const userData = app.getPath("userData");
  await fs.mkdir(userData, { recursive: true });
  const mediaRoot = nodePath.join(userData, "media");
  await fs.mkdir(mediaRoot, { recursive: true });

  const dbPath = nodePath.join(userData, "radioflow.db");
  const databaseUrl = sqliteFileUrl(dbPath);
  const jwtSecret = await readOrCreateJwtSecret(userData);

  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: app.isPackaged ? "production" : process.env.NODE_ENV || "development",
    DATABASE_URL: databaseUrl,
    MEDIA_ROOT: mediaRoot,
    JWT_SECRET: jwtSecret,
    PORT: process.env.RADIOFLOW_API_PORT || "4000",
    EMBEDDED_STANDALONE: "1",
    /**
     * Desktop siempre tiene cabina/UI: el headless no debe avanzar la cola
     * (evita skips en cadena cuando el audio pausa o cambia de módulo).
     */
    HEADLESS_PLAYOUT_POLL_MS: process.env.HEADLESS_PLAYOUT_POLL_MS ?? "0",
    LIBRARY_INGEST_MODE: "copy",
    CORS_ORIGIN: "http://127.0.0.1:5173,http://127.0.0.1:5174,null",
    REDIS_URL: "",
    /** B2: todo-en-uno — cola process-jobs + cues + parrilla en el mismo proceso. */
    API_BACKGROUND_MODE: process.env.RADIOFLOW_API_BACKGROUND_MODE?.trim() || "full",
    INTERNAL_SCHEDULE_POLL_MS: process.env.INTERNAL_SCHEDULE_POLL_MS || "60000",
    SCHEDULER_EVENTS_POLL_MS: process.env.SCHEDULER_EVENTS_POLL_MS || "2000",
    LIBRARY_PROCESS_WORKER_POLL_MS: process.env.LIBRARY_PROCESS_WORKER_POLL_MS || "2500",
    CUE_DETECT_BACKFILL_ENABLED: process.env.CUE_DETECT_BACKFILL_ENABLED || "1",
    CUE_DETECT_BACKFILL_POLL_MS: process.env.CUE_DETECT_BACKFILL_POLL_MS || "6000",
    /** Jobs de biblioteca (loudness, cues, trim, BPM audio) requieren FFmpeg/ffprobe. */
    AUDIO_FFMPEG_ENABLED: process.env.AUDIO_FFMPEG_ENABLED || "1",
    AUDIO_FFPROBE_ENABLED: process.env.AUDIO_FFPROBE_ENABLED || "1",
    FFMPEG_PATH: resolveFfmpegPathForChild(),
    FFPROBE_PATH: resolveFfprobePathForChild(),
  };

  apiChild = spawn(process.execPath, [entry], {
    cwd: apiHome,
    env: childEnv,
    stdio: "inherit",
  });
  apiChild.on("error", (err) => {
    console.error("[radioflow] API embebida spawn error:", err);
  });

  const ok = await waitApiReady(90_000);
  if (!ok) {
    console.error("[radioflow] API embebida no respondió a /api/health/ready a tiempo");
    try {
      apiChild.kill("SIGTERM");
    } catch {
      /* */
    }
    apiChild = null;
    return false;
  }
  console.log(`[radioflow] API embebida lista en http://127.0.0.1:${childEnv.PORT}`);
  embeddedApiOrigin = `http://127.0.0.1:${childEnv.PORT}`;
  if (mainWindow && !mainWindow.isDestroyed()) syncRendererApiOrigin(mainWindow);
  return true;
}

function resolveEncoderLaunch() {
  if (app.isPackaged) {
    const encoderRoot = nodePath.join(process.resourcesPath, "encoder");
    const entryCjs = nodePath.join(encoderRoot, "index.cjs");
    const entryMjs = nodePath.join(encoderRoot, "index.mjs");
    const entry = fssync.existsSync(entryCjs) ? entryCjs : entryMjs;
    return fssync.existsSync(entry) ? { encoderRoot, args: [entry] } : null;
  }
  const encoderRoot = nodePath.join(__dirname, "..", "encoder");
  const entryTs = nodePath.join(encoderRoot, "src", "index.ts");
  if (!fssync.existsSync(entryTs)) {
    return null;
  }
  const monorepoRoot = nodePath.join(__dirname, "..", "..");
  const tsxCli = nodePath.join(monorepoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fssync.existsSync(tsxCli)) {
    return null;
  }
  return { encoderRoot, args: [tsxCli, entryTs] };
}

function resolveToolPathForChild(tool, envName) {
  if (process.env[envName]?.trim()) return process.env[envName].trim();
  if (app.isPackaged) {
    const exe = process.platform === "win32" ? `${tool}.exe` : tool;
    const bundled = nodePath.join(process.resourcesPath, "tools", exe);
    if (fssync.existsSync(bundled)) return bundled;
  }
  if (process.platform === "win32") {
    try {
      const out = execFileSync("where.exe", [tool], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const exe = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /\.exe$/i.test(line));
      if (exe) return nodePath.normalize(exe);
    } catch {
      /* */
    }
    return `${tool}.exe`;
  }
  return tool;
}

function resolveFfmpegPathForChild() {
  return resolveToolPathForChild("ffmpeg", "FFMPEG_PATH");
}

function resolveFfprobePathForChild() {
  return resolveToolPathForChild("ffprobe", "FFPROBE_PATH");
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    /* */
  }
}

function stopEmbeddedEncoder() {
  clearEncoderRestartTimer();
  const next = onEncoderStoppedByUser({
    wantRunning: encoderWantRunning,
    running: Boolean(encoderChild && !encoderChild.killed),
    restartAttempts: encoderRestartAttempts,
    lastExitAtMs: null,
  });
  encoderWantRunning = next.wantRunning;
  encoderRestartAttempts = next.restartAttempts;
  lastEncoderPayload = null;
  if (!encoderChild || encoderChild.killed) {
    encoderChild = null;
    return { running: false, pid: null };
  }
  const pid = encoderChild.pid;
  try {
    encoderChild.kill("SIGTERM");
  } catch {
    /* */
  }
  killProcessTree(pid);
  encoderChild = null;
  return { running: false, pid: null };
}

/**
 * @param {object} payload
 * @param {{ fromWatchdog?: boolean }} [opts]
 */
async function startEmbeddedEncoder(payload, opts = {}) {
  if (encoderChild && !encoderChild.killed) {
    // Reinicio limpio sin cancelar wantRunning
    const pid = encoderChild.pid;
    try {
      encoderChild.kill("SIGTERM");
    } catch {
      /* */
    }
    killProcessTree(pid);
    encoderChild = null;
  }
  const launch = resolveEncoderLaunch();
  if (!launch) {
    return { running: false, pid: null, error: "Encoder no encontrado en los recursos de la aplicación." };
  }
  const token = typeof payload?.token === "string" ? payload.token : "";
  if (!token) {
    return { running: false, pid: null, error: "Inicia sesión para arrancar el encoder." };
  }
  const apiOrigin =
    typeof payload?.apiOrigin === "string" && payload.apiOrigin.trim()
      ? payload.apiOrigin.trim().replace(/\/$/, "")
      : getEmbeddedApiOrigin();
  const userData = app.getPath("userData");
  const mediaRoot = nodePath.join(userData, "media");

  lastEncoderPayload = {
    token,
    apiOrigin,
    icecastAdminUser: payload?.icecastAdminUser,
    icecastAdminPassword: payload?.icecastAdminPassword,
  };
  encoderWantRunning = true;
  if (!opts.fromWatchdog) {
    encoderRestartAttempts = 0;
    clearEncoderRestartTimer();
  }

  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    RADIOFLOW_API_URL: apiOrigin,
    RADIOFLOW_TOKEN: token,
    RADIOFLOW_MEDIA_ROOT: mediaRoot,
    ENABLE_FFMPEG: "1",
    RADIOFLOW_USE_WS: "1",
    RADIOFLOW_ICECAST_METADATA: process.env.RADIOFLOW_ICECAST_METADATA ?? "1",
    RADIOFLOW_ICECAST_METADATA_URL: process.env.RADIOFLOW_ICECAST_METADATA_URL ?? "1",
    RADIOFLOW_ICECAST_ADMIN_USER:
      (typeof payload?.icecastAdminUser === "string" && payload.icecastAdminUser.trim()) ||
      process.env.RADIOFLOW_ICECAST_ADMIN_USER ||
      "admin",
    RADIOFLOW_ICECAST_ADMIN_PASSWORD:
      (typeof payload?.icecastAdminPassword === "string" && payload.icecastAdminPassword.trim()) ||
      process.env.RADIOFLOW_ICECAST_ADMIN_PASSWORD ||
      "",
    /** Vacío: el encoder usa destino activo de Emitir (no apps/encoder/.env). */
    RADIOFLOW_ICECAST_URL: "",
    FFMPEG_PATH: resolveFfmpegPathForChild(),
  };

  encoderChild = spawn(process.execPath, launch.args, {
    cwd: launch.encoderRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  encoderChild.stdout?.on("data", (d) => {
    const s = d.toString().trim();
    if (s) console.log("[radioflow:encoder]", s);
  });
  encoderChild.stderr?.on("data", (d) => {
    const s = d.toString().trim();
    if (s) console.error("[radioflow:encoder]", s);
  });
  encoderChild.on("error", (err) => {
    console.error("[radioflow] encoder spawn error:", err);
  });
  encoderChild.on("exit", (code, signal) => {
    encoderChild = null;
    const next = onEncoderExited({
      wantRunning: encoderWantRunning,
      running: true,
      restartAttempts: encoderRestartAttempts,
      lastExitAtMs: null,
    });
    encoderRestartAttempts = next.restartAttempts;
    console.log(
      `[radioflow] encoder salió code=${code ?? "null"} signal=${signal ?? "null"} want=${encoderWantRunning}`,
    );
    if (encoderWantRunning) {
      scheduleEncoderRestart(`exit ${code ?? signal ?? "?"}`);
    }
  });

  const started = onEncoderStartSuccess({
    wantRunning: encoderWantRunning,
    running: false,
    restartAttempts: encoderRestartAttempts,
    lastExitAtMs: null,
  });
  encoderRestartAttempts = started.restartAttempts;

  return { running: true, pid: encoderChild.pid ?? null };
}

function embeddedEncoderStatus() {
  return {
    running: Boolean(encoderChild && !encoderChild.killed),
    pid: encoderChild && !encoderChild.killed ? encoderChild.pid ?? null : null,
    wantRunning: encoderWantRunning,
    restartAttempts: encoderRestartAttempts,
  };
}

function listRoots() {
  if (process.platform === "win32") {
    const out = [];
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      const root = `${letter}:\\`;
      try {
        fssync.accessSync(root);
        out.push({ path: root, name: `${letter}:` });
      } catch {
        /* unidad no disponible */
      }
    }
    return out;
  }
  return [{ path: "/", name: "/" }];
}

async function readDirectory(dirPath) {
  const norm = nodePath.normalize(dirPath);
  const items = await fs.readdir(norm, { withFileTypes: true });
  const mapped = items.map((d) => {
    const full = nodePath.join(norm, d.name);
    return {
      name: d.name,
      path: full,
      isDirectory: d.isDirectory(),
      isFile: d.isFile(),
    };
  });
  mapped.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return mapped;
}

async function parentPath(p) {
  const norm = nodePath.normalize(p);
  const parent = nodePath.dirname(norm);
  if (parent === norm) return null;
  return parent;
}

/** Ventana flotante VU (broadcast desde main; no polling). */
let cabHudWindow = null;

function broadcastCabMeterToHud(payload) {
  if (!cabHudWindow || cabHudWindow.isDestroyed()) return;
  try {
    cabHudWindow.webContents.send("radioflow:cab-meter-update", payload);
  } catch {
    /* ventana cerrando */
  }
}

function createCabMeterHud() {
  if (process.env.RADIOFLOW_CAB_METER_HUD === "0") return;
  if (cabHudWindow && !cabHudWindow.isDestroyed()) return;
  const { width: sw, height: sh, x: wx, y: wy } = screen.getPrimaryDisplay().workArea;
  const w = 248;
  const h = 92;
  const win = new BrowserWindow({
    width: w,
    height: h,
    x: wx + sw - w - 12,
    y: wy + sh - h - 12,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: true,
    focusable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "cab-meter-hud-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    win.setMenuBarVisibility(false);
  } catch {
    /* */
  }
  const hudPath = path.join(__dirname, "cab-meter-hud.html");
  void win.loadFile(hudPath);
  cabHudWindow = win;
  win.on("closed", () => {
    cabHudWindow = null;
  });
}

function isCabMeterHudVisible() {
  return Boolean(cabHudWindow && !cabHudWindow.isDestroyed());
}

function hideCabMeterHud() {
  if (cabHudWindow && !cabHudWindow.isDestroyed()) {
    cabHudWindow.close();
  }
  cabHudWindow = null;
}

function toggleCabMeterHud() {
  if (isCabMeterHudVisible()) {
    hideCabMeterHud();
    return false;
  }
  createCabMeterHud();
  return true;
}

ipcMain.handle("radioflow:paths:user-data", () => app.getPath("userData"));

ipcMain.handle("radioflow:api-origin", () => getEmbeddedApiOrigin());

ipcMain.handle("radioflow:paths:open-user-data", async () => {
  const dir = app.getPath("userData");
  const err = await shell.openPath(dir);
  return { path: dir, error: err || null };
});

ipcMain.handle("radioflow:shell:open-external", async (_e, url) => {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!/^https?:\/\//i.test(raw)) {
    return { ok: false, error: "URL no permitida" };
  }
  await shell.openExternal(raw);
  return { ok: true, error: null };
});

ipcMain.handle("radioflow:cart-hotkeys:enable", () => {
  registerCartHotkeys();
  return true;
});

ipcMain.handle("radioflow:cart-hotkeys:disable", () => {
  unregisterCartHotkeys();
  return true;
});

const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|flac|ogg|opus|wma|aif|aiff)$/i;

async function collectAudioPathsInDir(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = nodePath.join(dir, ent.name);
    if (ent.isDirectory()) {
      await collectAudioPathsInDir(full, out);
    } else if (ent.isFile() && AUDIO_EXT_RE.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

async function uploadPathsToLibraryApi(payload) {
  const paths = Array.isArray(payload?.paths) ? payload.paths : [];
  const folder = typeof payload?.folder === "string" ? payload.folder : undefined;
  const token = typeof payload?.token === "string" ? payload.token : "";
  const port = process.env.RADIOFLOW_API_PORT || "4000";
  const base = `http://127.0.0.1:${port}`;
  const ids = [];
  const errors = [];

  const chunkSize = 500;
  for (let offset = 0; offset < paths.length; offset += chunkSize) {
    const chunk = paths.slice(offset, offset + chunkSize).filter((p) => typeof p === "string" && p.trim());
    if (!chunk.length) continue;
    try {
      const r = await fetch(`${base}/api/library/import-local-files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ paths: chunk, folder: folder?.trim() || undefined }),
      });
      const text = await r.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        /* */
      }
      if (!r.ok) {
        errors.push(body.error || `Lote ${offset / chunkSize + 1}: ${r.statusText || r.status}`);
        continue;
      }
      if (Array.isArray(body.ids)) ids.push(...body.ids);
      if (Array.isArray(body.errors)) errors.push(...body.errors);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { ids, errors: errors.slice(0, 20) };
}

ipcMain.handle("radioflow:native-fs:list-roots", () => listRoots());
ipcMain.handle("radioflow:native-fs:read-directory", (_, dirPath) => readDirectory(dirPath));
ipcMain.handle("radioflow:native-fs:parent-path", (_, dirPath) => parentPath(dirPath));
ipcMain.handle("radioflow:native-fs:files-from-paths", async (_, paths) => {
  if (!Array.isArray(paths)) return [];
  const out = [];
  for (const p of paths) {
    if (typeof p !== "string") continue;
    try {
      const st = await fs.stat(p);
      if (!st.isFile()) continue;
      const buf = await fs.readFile(p);
      const name = nodePath.basename(p);
      out.push({
        name,
        data: Uint8Array.from(buf),
      });
    } catch {
      /* omitir */
    }
  }
  return out;
});

ipcMain.handle("radioflow:native-fs:open-audio-dialog", async () => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const res = await dialog.showOpenDialog(win, {
    title: "Elegir música",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma", "aif", "aiff"] },
      { name: "Todos los archivos", extensions: ["*"] },
    ],
  });
  if (res.canceled) return [];
  return res.filePaths ?? [];
});

ipcMain.handle("radioflow:native-fs:open-directory-dialog", async (_e, payload) => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const title =
    payload && typeof payload === "object" && typeof payload.title === "string"
      ? payload.title
      : "Elegir carpeta";
  const res = await dialog.showOpenDialog(win, {
    title,
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths?.[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle("radioflow:native-fs:open-audio-folder-dialog", async () => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const res = await dialog.showOpenDialog(win, {
    title: "Elegir carpeta con música",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths?.[0]) return [];
  return collectAudioPathsInDir(res.filePaths[0]);
});

ipcMain.handle("radioflow:native-fs:upload-paths-to-library", (_, payload) =>
  uploadPathsToLibraryApi(payload),
);

ipcMain.handle("radioflow:native-fs:open-image-dialog", async () => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const res = await dialog.showOpenDialog(win, {
    title: "Logo de la emisora",
    properties: ["openFile"],
    filters: [
      { name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] },
      { name: "Todos los archivos", extensions: ["*"] },
    ],
  });
  if (res.canceled) return null;
  return res.filePaths?.[0] ?? null;
});

/** Última muestra VU desde el renderer (cabina Web Audio); `ipcMain.handle('radioflow:cab-meter:get-last')`. */
let lastCabMeterSample = null;

ipcMain.on("radioflow:cab-meter-sample", (_, raw) => {
  if (!raw || typeof raw !== "object") return;
  const peak01 =
    typeof raw.peak01 === "number" && Number.isFinite(raw.peak01) ? Math.min(1, Math.max(0, raw.peak01)) : 0;
  let dbFs = null;
  if (typeof raw.dbFs === "number" && Number.isFinite(raw.dbFs)) {
    dbFs = Math.min(24, Math.max(-120, raw.dbFs));
  }
  const tMs =
    typeof raw.tMs === "number" && Number.isFinite(raw.tMs) ? raw.tMs : Date.now();
  lastCabMeterSample = { peak01, dbFs, tMs };
  broadcastCabMeterToHud(lastCabMeterSample);
  if (process.env.RADIOFLOW_CAB_METER_LOG === "1") {
    console.log("[radioflow:cab-meter]", peak01.toFixed(3), dbFs);
  }
});

ipcMain.handle("radioflow:cab-meter:get-last", () => lastCabMeterSample);

ipcMain.handle("radioflow:cab-meter:hud-toggle", () => toggleCabMeterHud());
ipcMain.handle("radioflow:cab-meter:hud-visible", () => isCabMeterHudVisible());

ipcMain.handle("radioflow:updates:check", () => checkForUpdates({ silent: false }));

ipcMain.handle("radioflow:encoder:start", (_, payload) => startEmbeddedEncoder(payload));
ipcMain.handle("radioflow:encoder:stop", () => stopEmbeddedEncoder());
ipcMain.handle("radioflow:encoder:status", () => embeddedEncoderStatus());

function sendNavigate(route) {
  const w = mainWindow;
  if (!w || w.isDestroyed()) return;
  w.webContents.send("radioflow:navigate", route);
}

function installDesktopAppMenu() {
  if (!app.isPackaged) return;

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
          },
        ]
      : []),
    {
      label: "Archivo",
      submenu: [process.platform === "win32" ? { role: "close" } : { role: "quit", label: "Salir" }],
    },
    {
      label: "Vista",
      submenu: [
        { label: "Cabina", click: () => sendNavigate("/station") },
        { label: "Explorador de archivos", click: () => sendNavigate("/explorador") },
        { label: "Librería", click: () => sendNavigate("/library") },
        { label: "Listas", click: () => sendNavigate("/playlists") },
        { label: "Parrilla", click: () => sendNavigate("/schedule") },
        { type: "separator" },
        { label: "Iniciar sesión", click: () => sendNavigate("/login") },
      ],
    },
    {
      label: "Ayuda",
      submenu: [
        {
          label: "Buscar actualizaciones…",
          click: () => {
            void checkForUpdates({ silent: false });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveIndexHtml() {
  if (isDev) return null;
  // Instalación / portable: la UI vive siempre en resources/web/ (extraResources).
  // No usar rutas relativas a __dirname: con app.asar pueden resolverse mal y cargar un index viejo o vacío.
  if (app.isPackaged) {
    const packaged = nodePath.join(process.resourcesPath, "web", "index.html");
    if (fssync.existsSync(packaged)) {
      console.log("[radioflow] UI empaquetada:", packaged);
      return packaged;
    }
    console.error("[radioflow] Falta UI en:", packaged);
    return null;
  }
  const staged = nodePath.join(__dirname, "..", "web", "dist", "index.html");
  if (fssync.existsSync(staged)) {
    console.log("[radioflow] UI desde repo:", staged);
    return staged;
  }
  return null;
}

function resolveWindowIcon() {
  const png = path.join(__dirname, "build", "icon.png");
  return fssync.existsSync(png) ? png : undefined;
}

function toggleDevTools(win) {
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools();
  } else {
    win.webContents.openDevTools({ mode: "right" });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#020617",
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => {
    if (!win.isMaximized()) win.maximize();
    win.show();
    win.focus();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev) {
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        toggleDevTools(win);
      }
    });
  }

  if (isDev) {
    const viteUrl = process.env.RADIOFLOW_VITE_URL || "http://127.0.0.1:5173";
    win.webContents.on("did-finish-load", () => syncRendererApiOrigin(win));
    void win.loadURL(viteUrl);
    if (process.env.RADIOFLOW_DEVTOOLS === "1") {
      win.webContents.once("did-finish-load", () => {
        toggleDevTools(win);
      });
    }
  } else {
    const indexHtml = resolveIndexHtml();
    if (!indexHtml || !fssync.existsSync(indexHtml)) {
      void win.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            "<pre>Falta el build web. En la raíz del repo: npm run build:desktop</pre>",
          ),
      );
      return;
    }
    void win.loadFile(indexHtml);
    win.webContents.on("did-finish-load", () => syncRendererApiOrigin(win));
  }
}

app.on("before-quit", () => {
  unregisterCartHotkeys();
  stopEmbeddedEncoder();
  if (apiChild && !apiChild.killed) {
    try {
      apiChild.kill("SIGTERM");
    } catch {
      /* */
    }
    apiChild = null;
  }
});

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    if (embeddedApiEnabled()) {
      const ok = await startEmbeddedApi();
      if (!ok) {
        void dialog.showErrorBox(
          "RadioFlow Studio",
          "No se pudo iniciar la API local (SQLite). Revise la consola o reinstale la aplicación.",
        );
      }
    }
    createWindow();
    if (app.isPackaged) {
      wireAutoUpdater(console);
      installDesktopAppMenu();
      setTimeout(() => {
        void checkForUpdates({ silent: true });
      }, 20_000);
    }
    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      }
    });
  });

  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

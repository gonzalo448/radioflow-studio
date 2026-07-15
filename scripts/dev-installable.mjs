#!/usr/bin/env node
/**
 * Desarrollo como app instalable: solo abre Electron.
 * - API SQLite embebida (spawn desde Electron, igual que el .exe)
 * - Vite solo alimenta la ventana de Electron (no es producto para navegador)
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDist = path.join(root, "apps", "api", "dist", "index.js");
const waitOnBin = path.join(root, "node_modules", "wait-on", "bin", "wait-on");

/** Evita choque con Docker/API en :4000 durante desarrollo. */
const API_PORT = process.env.RADIOFLOW_API_PORT || "4001";
const VITE_PORT = process.env.RADIOFLOW_VITE_PORT || "5173";
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const VITE_URL = `http://127.0.0.1:${VITE_PORT}`;

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const shell = process.platform === "win32";

const children = [];

function run(cmd, args, opts = {}) {
  const c = spawn(cmd, args, { stdio: "inherit", shell, ...opts });
  children.push(c);
  return c;
}

function shutdown(code = 0) {
  for (const c of children) {
    if (!c.killed) {
      try {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(c.pid), "/F", "/T"], { stdio: "ignore", shell: true });
        } else {
          c.kill("SIGTERM");
        }
      } catch {
        /* */
      }
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[radioflow] Modo app instalable — se abrirá Electron (no uses el navegador).\n");

spawnSync(process.execPath, [path.join(root, "scripts", "free-dev-ports.mjs")], {
  cwd: root,
  stdio: "inherit",
});

if (!fs.existsSync(apiDist)) {
  console.log("[radioflow] Compilando API embebida (primera vez)…");
  const b = spawnSync(npmCmd, ["run", "build", "-w", "@radioflow/api"], { cwd: root, stdio: "inherit", shell });
  if (b.status !== 0) process.exit(b.status ?? 1);
} else {
  /** Electron carga `apps/api/dist`; cualquier cambio en `src` debe recompilar. */
  const apiSrcRoot = path.join(root, "apps", "api", "src");
  const apiDistRoot = path.join(root, "apps", "api", "dist");
  function newestMtime(dir) {
    let max = 0;
    if (!fs.existsSync(dir)) return 0;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const full = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "generated" || ent.name === "node_modules") continue;
          stack.push(full);
        } else if (/\.(ts|js|mjs|cjs)$/i.test(ent.name)) {
          try {
            max = Math.max(max, fs.statSync(full).mtimeMs);
          } catch {
            /* */
          }
        }
      }
    }
    return max;
  }
  const marker = path.join(apiDistRoot, "routes", "time-announce.js");
  const needsRebuild = !fs.existsSync(marker) || newestMtime(apiSrcRoot) > newestMtime(apiDistRoot) + 500;
  if (needsRebuild) {
    console.log("[radioflow] API embebida desactualizada — recompilando…");
    const b = spawnSync(npmCmd, ["run", "build", "-w", "@radioflow/api"], { cwd: root, stdio: "inherit", shell });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
}

const webEnv = {
  ...process.env,
  VITE_HASH_ROUTER: "true",
  VITE_EMBEDDED_STANDALONE: "true",
  VITE_API_ORIGIN: API_ORIGIN,
};

console.log(`[radioflow] UI dev interna ${VITE_URL} → API ${API_ORIGIN}\n`);

run(npmCmd, ["run", "dev", "-w", "@radioflow/web"], { cwd: root, env: webEnv });

const wait = spawnSync(
  process.execPath,
  [waitOnBin, `tcp:127.0.0.1:${VITE_PORT}`, "-t", "60000"],
  { cwd: root, stdio: "inherit" },
);
if (wait.status !== 0) {
  console.error("[radioflow] Vite no respondió a tiempo.");
  shutdown(1);
}

const deskEnv = {
  ...process.env,
  RADIOFLOW_DEV: "1",
  RADIOFLOW_EMBEDDED_API: "1",
  RADIOFLOW_API_PORT: API_PORT,
  RADIOFLOW_VITE_URL: VITE_URL,
  /** Sin ventana blanca extra de DevTools al arrancar (F12 para abrirlas). */
  RADIOFLOW_DEVTOOLS: process.env.RADIOFLOW_DEVTOOLS ?? "0",
};

const desk = run(npmCmd, ["run", "dev:electron-only", "-w", "@radioflow/desktop"], { cwd: root, env: deskEnv });

desk.on("exit", (code) => shutdown(code ?? 0));

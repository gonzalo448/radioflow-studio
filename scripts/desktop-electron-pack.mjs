/**
 * Empaqueta Electron en `apps/desktop/dist-pack/run-<timestamp>/` para no chocar con
 * un `win-unpacked` anterior que Windows siga bloqueando (app abierta, antivirus, etc.).
 *
 * Uso: node scripts/desktop-electron-pack.mjs [--launch]
 *   --launch  Abre el .exe recién generado al terminar (Windows: win-unpacked).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const launch = process.argv.includes("--launch");
const winOnly = process.argv.includes("--win");
const macOnly = process.argv.includes("--mac");
const linuxOnly = process.argv.includes("--linux");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps", "desktop");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputRel = path.join("dist-pack", `run-${runId}`);

const ensure = spawnSync(process.execPath, [path.join(root, "scripts", "ensure-electron-for-desktop.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (ensure.status !== 0) process.exit(ensure.status ?? 1);

const outArg = `--config.directories.output=${outputRel}`;
const configPath = path.join(desktop, "electron-builder.config.cjs");
const builderArgs = ["electron-builder", "--config", configPath, outArg];
if (winOnly) builderArgs.push("--win", "nsis");
else if (macOnly) builderArgs.push("--mac", "dmg");
else if (linuxOnly) builderArgs.push("--linux", "AppImage");

const updateUrl = (process.env.RADIOFLOW_UPDATE_URL ?? "").trim();
if (updateUrl) {
  console.log(`[pack] Canal de actualizaciones: ${updateUrl.replace(/\/$/, "")}`);
} else {
  console.log("[pack] Sin RADIOFLOW_UPDATE_URL — el instalador no incluirá feed de auto-actualización.");
}
if (process.env.CSC_LINK || process.env.WIN_CSC_LINK) {
  console.log("[pack] Firma de código: certificado detectado (CSC_LINK / WIN_CSC_LINK).");
} else if (process.env.RADIOFLOW_SKIP_SIGNING !== "1") {
  console.log("[pack] Sin certificado — el .exe no estará firmado (SmartScreen puede advertir).");
}
const build = spawnSync("npx", builderArgs, {
  cwd: desktop,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (build.status === 0) {
  const absOut = path.join(desktop, outputRel);
  console.log(`\nListo. Salida en:\n  ${absOut}\n`);

  if (process.platform === "win32") {
    try {
      const names = fs.readdirSync(absOut).filter((f) => /^RadioFlow-Studio-Setup-.+\.exe$/i.test(f));
      for (const name of names) {
        console.log(`Instalador para clientes (entregar este archivo):\n  ${path.join(absOut, name)}\n`);
      }
    } catch {
      /* */
    }
  } else if (process.platform === "darwin") {
    try {
      const names = fs.readdirSync(absOut).filter((f) => f.endsWith(".dmg"));
      for (const name of names) {
        console.log(`Instalador macOS:\n  ${path.join(absOut, name)}\n`);
      }
    } catch {
      /* */
    }
  } else {
    try {
      const names = fs.readdirSync(absOut).filter((f) => f.endsWith(".AppImage"));
      for (const name of names) {
        console.log(`AppImage Linux:\n  ${path.join(absOut, name)}\n`);
      }
    } catch {
      /* */
    }
  }

  if (launch && process.platform === "win32") {
    const unpacked = path.join(absOut, "win-unpacked");
    const candidates = ["radioflow-studio.exe", "RadioFlow Studio.exe"];
    let exePath = null;
    for (const c of candidates) {
      const p = path.join(unpacked, c);
      if (fs.existsSync(p)) {
        exePath = p;
        break;
      }
    }
    if (!exePath && fs.existsSync(unpacked)) {
      const files = fs
        .readdirSync(unpacked)
        .filter((f) => f.endsWith(".exe") && f.toLowerCase() !== "elevate.exe");
      if (files.length) exePath = path.join(unpacked, files[0]);
    }
    if (exePath) {
      console.log(`Iniciando aplicación:\n  ${exePath}\n`);
      const child = spawn(exePath, [], { detached: true, stdio: "ignore", cwd: unpacked });
      child.unref();
    } else {
      console.warn("No se encontró el ejecutable en win-unpacked; abrilo manualmente desde la carpeta indicada.");
    }
  } else if (launch) {
    console.warn("--launch solo está cableado para Windows (win-unpacked). En esta plataforma abrí el artefacto a mano.");
  }
}

process.exit(build.status ?? 1);

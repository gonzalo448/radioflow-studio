"use strict";

const fssync = require("node:fs");
const path = require("node:path");
const { app, dialog, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");

let checking = false;

function feedConfigured() {
  if (process.env.RADIOFLOW_AUTO_UPDATE === "0") return false;
  try {
    const yml = path.join(process.resourcesPath, "app-update.yml");
    return fssync.existsSync(yml);
  } catch {
    return false;
  }
}

function wireAutoUpdater(log = console) {
  if (!feedConfigured()) {
    log.info("[radioflow:update] Sin feed (definí RADIOFLOW_UPDATE_URL al empaquetar)");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m) => log.info(m),
    warn: (m) => log.warn(m),
    error: (m) => log.error(m),
  };

  autoUpdater.on("update-downloaded", (info) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const choice = dialog.showMessageBoxSync(win ?? undefined, {
      type: "info",
      title: "RadioFlow Studio",
      message: `Hay una actualización (${info.version}) lista para instalar.`,
      detail: "La aplicación se reiniciará para completar la instalación.",
      buttons: ["Reiniciar ahora", "Más tarde"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  });

  autoUpdater.on("error", (err) => {
    log.error("[radioflow:update]", err);
  });
}

async function checkForUpdates({ silent = false } = {}) {
  if (!app.isPackaged) {
    if (!silent) {
      dialog.showMessageBox({
        type: "info",
        title: "RadioFlow Studio",
        message: "Las actualizaciones automáticas solo están disponibles en la aplicación instalada.",
      });
    }
    return { status: "dev" };
  }

  if (!feedConfigured()) {
    if (!silent) {
      dialog.showMessageBox({
        type: "info",
        title: "RadioFlow Studio",
        message: "Este instalador no incluye canal de actualizaciones.",
        detail: "Vuelva a instalar desde el .exe que le entregó su proveedor.",
      });
    }
    return { status: "no-feed" };
  }

  if (checking) return { status: "busy" };
  checking = true;

  try {
    const result = await autoUpdater.checkForUpdates();
    const remote = result?.updateInfo?.version;
    const current = app.getVersion();

    if (!remote || remote === current) {
      if (!silent) {
        dialog.showMessageBox({
          type: "info",
          title: "RadioFlow Studio",
          message: "Ya tiene la última versión.",
          detail: `Versión instalada: ${current}`,
        });
      }
      return { status: "up-to-date", version: current };
    }

    if (!silent) {
      dialog.showMessageBox({
        type: "info",
        title: "RadioFlow Studio",
        message: `Actualización ${remote} encontrada.`,
        detail: "Se descargará en segundo plano. Le avisaremos cuando pueda reiniciar.",
      });
    }
    return { status: "available", version: remote };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!silent) {
      dialog.showMessageBox({
        type: "error",
        title: "RadioFlow Studio",
        message: "No se pudo comprobar actualizaciones.",
        detail: msg,
      });
    }
    return { status: "error", error: msg };
  } finally {
    checking = false;
  }
}

module.exports = { wireAutoUpdater, checkForUpdates, feedConfigured };

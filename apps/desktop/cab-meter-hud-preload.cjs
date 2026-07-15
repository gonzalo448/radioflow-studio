"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cabHud", {
  /**
   * Registra el callback para cada broadcast desde el proceso principal.
   * La página HUD debe llamar esto una sola vez al cargar.
   */
  onMeter: (cb) => {
    if (typeof cb !== "function") return;
    const fn = (_e, payload) => {
      try {
        cb(payload);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on("radioflow:cab-meter-update", fn);
  },
});

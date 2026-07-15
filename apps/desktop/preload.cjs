"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("radioflow", {
  paths: {
    userData: () => ipcRenderer.invoke("radioflow:paths:user-data"),
    openUserDataFolder: () => ipcRenderer.invoke("radioflow:paths:open-user-data"),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke("radioflow:shell:open-external", url),
  },
  navigation: {
    onNavigate: (listener) => {
      const handler = (_e, path) => {
        if (typeof path === "string") listener(path);
      };
      ipcRenderer.on("radioflow:navigate", handler);
      return () => ipcRenderer.removeListener("radioflow:navigate", handler);
    },
  },
  nativeFs: {
    listRoots: () => ipcRenderer.invoke("radioflow:native-fs:list-roots"),
    readDirectory: (dirPath) => ipcRenderer.invoke("radioflow:native-fs:read-directory", dirPath),
    parentPath: (dirPath) => ipcRenderer.invoke("radioflow:native-fs:parent-path", dirPath),
    filesFromPaths: (paths) => ipcRenderer.invoke("radioflow:native-fs:files-from-paths", paths),
    openAudioDialog: () => ipcRenderer.invoke("radioflow:native-fs:open-audio-dialog"),
    openAudioFolderDialog: () => ipcRenderer.invoke("radioflow:native-fs:open-audio-folder-dialog"),
    /** Solo la ruta de carpeta (sin listar archivos). */
    openDirectoryDialog: (opts) =>
      ipcRenderer.invoke("radioflow:native-fs:open-directory-dialog", opts ?? {}),
    openImageDialog: () => ipcRenderer.invoke("radioflow:native-fs:open-image-dialog"),
    uploadPathsToLibrary: (payload) => ipcRenderer.invoke("radioflow:native-fs:upload-paths-to-library", payload),
  },
  cabMeter: {
    pushSample: (sample) => {
      ipcRenderer.send("radioflow:cab-meter-sample", sample);
    },
    toggleHud: () => ipcRenderer.invoke("radioflow:cab-meter:hud-toggle"),
    isHudVisible: () => ipcRenderer.invoke("radioflow:cab-meter:hud-visible"),
  },
  updates: {
    check: () => ipcRenderer.invoke("radioflow:updates:check"),
  },
  encoder: {
    start: (payload) => ipcRenderer.invoke("radioflow:encoder:start", payload),
    stop: () => ipcRenderer.invoke("radioflow:encoder:stop"),
    status: () => ipcRenderer.invoke("radioflow:encoder:status"),
  },
  cartHotkeys: {
    enable: () => ipcRenderer.invoke("radioflow:cart-hotkeys:enable"),
    disable: () => ipcRenderer.invoke("radioflow:cart-hotkeys:disable"),
    onKey: (listener) => {
      const handler = (_e, key) => listener(key);
      ipcRenderer.on("radioflow:cart-key", handler);
      return () => ipcRenderer.removeListener("radioflow:cart-key", handler);
    },
  },
});

"use strict";

/**
 * Configuración de empaquetado Electron.
 * - Iconos: apps/desktop/build/ (generar con `npm run icons:desktop`)
 * - Firma Windows: variables CSC_LINK / CSC_KEY_PASSWORD (certificado .pfx Authenticode)
 * - Actualizaciones: RADIOFLOW_UPDATE_URL=https://tu-cdn/.../win (genera latest.yml en el build)
 */
const pkg = require("./package.json");

const updateUrl = (process.env.RADIOFLOW_UPDATE_URL ?? "").trim().replace(/\/$/, "");

/** @type {import('electron-builder').Configuration} */
const config = {
  ...pkg.build,
  directories: {
    ...pkg.build.directories,
    buildResources: "build",
  },
  win: {
    ...pkg.build.win,
    icon: "build/icon.ico",
    signAndEditExecutable: process.env.RADIOFLOW_SKIP_SIGNING !== "1",
  },
  mac: {
    ...pkg.build.mac,
    icon: "build/icon.png",
    identity: process.env.CSC_NAME || null,
  },
  linux: {
    ...pkg.build.linux,
    icon: "build/icons",
  },
  publish: updateUrl
    ? [
        {
          provider: "generic",
          url: updateUrl,
          useMultipleRangeRequest: false,
        },
      ]
    : undefined,
};

module.exports = config;

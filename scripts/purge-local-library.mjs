#!/usr/bin/env node
/**
 * Vacía la biblioteca de la instalación local (Electron / SQLite en %APPDATA%\\radioflow-studio).
 * Uso: node scripts/purge-local-library.mjs
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const userData = path.join(os.homedir(), "AppData", "Roaming", "radioflow-studio");
const mediaRoot = path.join(userData, "media");
const dbPath = path.join(userData, "radioflow.db");

if (!existsSync(dbPath)) {
  console.error("[purge] No se encontró", dbPath);
  process.exit(1);
}

const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
process.env.DATABASE_URL = dbUrl;

const { prisma } = await import(pathToFileURL(path.join(root, "apps", "api", "dist", "db.js")).href);

const before = await prisma.mediaAsset.count();
console.log(`[purge] Pistas en catálogo: ${before}`);

await prisma.mediaAsset.deleteMany({});
await prisma.libraryProcessJob.deleteMany({}).catch(() => undefined);

for (const sub of ["uploads", "covers"]) {
  const dir = path.join(mediaRoot, sub);
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  await fs.mkdir(dir, { recursive: true });
  console.log(`[purge] Limpiado ${dir}`);
}

const after = await prisma.mediaAsset.count();
await prisma.$disconnect();

console.log(`[purge] Listo. Pistas restantes: ${after}. Reinicie la aplicación si estaba abierta.`);

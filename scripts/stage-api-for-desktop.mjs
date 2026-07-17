/**
 * Prepara `apps/desktop/.embedded-api` para empaquetar la API con Electron (node_modules de producción).
 * Ejecutar desde la raíz del repo tras `npm run build -w @radioflow/api`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiSrc = path.join(root, "apps", "api");
const dest = path.join(root, "apps", "desktop", ".embedded-api");

if (!fs.existsSync(path.join(apiSrc, "dist", "index.js"))) {
  console.error("[stage-api-desktop] Falta apps/api/dist/index.js — ejecutá npm run build -w @radioflow/api");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const name of ["dist", "prisma"]) {
  fs.cpSync(path.join(apiSrc, name), path.join(dest, name), {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === ".data" || base === "node_modules") return false;
      if (/^tmp.*\.db$/i.test(base)) return false;
      if (/\.db-(?:wal|shm)$/i.test(base)) return false;
      // El cliente standalone se regenera en dest; no copiar src/generated del monorepo.
      if (src.replace(/\\/g, "/").includes("/prisma/") && base === "src") return false;
      return true;
    },
  });
}

const pkg = JSON.parse(fs.readFileSync(path.join(apiSrc, "package.json"), "utf8"));
const stagingPkg = {
  name: "radioflow-embedded-api",
  private: true,
  type: "module",
  version: pkg.version ?? "0.0.0",
  dependencies: {
    ...pkg.dependencies,
    "@radioflow/shared": "file:../../../packages/shared",
  },
};
fs.writeFileSync(path.join(dest, "package.json"), `${JSON.stringify(stagingPkg, null, 2)}\n`);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const inst = spawnSync(npmCmd, ["install", "--omit=dev"], {
  cwd: dest,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
if (inst.status !== 0) {
  console.error("[stage-api-desktop] npm install falló");
  process.exit(inst.status ?? 1);
}

const dummyPg = "postgresql://radioflow:radioflow_dev@127.0.0.1:5432/radioflow_embedded_stage";
const dummySqlite = "file:./.prisma-generate-placeholder.db";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

const g1 = spawnSync(npxCmd, ["prisma", "generate"], {
  cwd: dest,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: dummyPg },
  shell: process.platform === "win32",
});
if (g1.status !== 0) process.exit(g1.status ?? 1);

const g2 = spawnSync(npxCmd, ["prisma", "generate", "--schema=prisma/standalone/schema.prisma"], {
  cwd: dest,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: dummySqlite },
  shell: process.platform === "win32",
});
if (g2.status !== 0) process.exit(g2.status ?? 1);

const standaloneWrong = path.join(dest, "src", "generated", "prisma-standalone");
const standaloneDest = path.join(dest, "dist", "generated", "prisma-standalone");
if (fs.existsSync(standaloneWrong)) {
  fs.mkdirSync(path.dirname(standaloneDest), { recursive: true });
  fs.rmSync(standaloneDest, { recursive: true, force: true });
  fs.cpSync(standaloneWrong, standaloneDest, { recursive: true });
}

// electron-builder excluye carpetas llamadas `node_modules` en extraResources.
// Las renombramos a `vendor` y Electron crea el junction `node_modules` al arrancar.
const nm = path.join(dest, "node_modules");
const vendor = path.join(dest, "vendor");
if (fs.existsSync(nm)) {
  fs.rmSync(vendor, { recursive: true, force: true });
  fs.renameSync(nm, vendor);
}

console.log("[stage-api-desktop] listo en", dest);

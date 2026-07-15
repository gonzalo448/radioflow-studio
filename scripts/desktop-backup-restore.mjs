/**
 * A6 — Backup / restore del producto desktop (SQLite + jwt + media opcional).
 *
 * Backup:
 *   node scripts/desktop-backup-restore.mjs
 *   DESKTOP_USER_DATA="%APPDATA%\\radioflow-studio" INCLUDE_MEDIA=1 node scripts/desktop-backup-restore.mjs
 *
 * Restore (app CERRADA):
 *   RESTORE=1 BACKUP_DIR=backups/desktop-... node scripts/desktop-backup-restore.mjs
 *
 * Solo verificar manifiesto:
 *   VERIFY=1 BACKUP_DIR=backups/desktop-... node scripts/desktop-backup-restore.mjs
 *
 * Autotest (CI / local sin app):
 *   DESKTOP_BACKUP_SELFTEST=1 node scripts/desktop-backup-restore.mjs
 *
 * Firma: SHA-256 por archivo + HMAC-SHA256 si BACKUP_HMAC_SECRET o JWT_SECRET.
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  sha256File,
  stampNow,
  writeManifest,
  verifyManifest,
  relativeSafe,
} from "./lib/backup-manifest.mjs";

const doRestore = process.env.RESTORE === "1";
const doVerify = process.env.VERIFY === "1";
const selfTest = process.env.DESKTOP_BACKUP_SELFTEST === "1";

function fail(msg) {
  console.error("[desktop-backup]", msg);
  process.exit(1);
}

function log(msg) {
  console.log(`[desktop-backup] ${msg}`);
}

function backupsRoot() {
  return resolve(process.env.BACKUPS_ROOT ?? "backups");
}

function includeMedia() {
  return process.env.INCLUDE_MEDIA === "1";
}

function defaultUserData() {
  if (process.env.DESKTOP_USER_DATA?.trim()) return resolve(process.env.DESKTOP_USER_DATA.trim());
  const appData = process.env.APPDATA || process.env.HOME || process.env.USERPROFILE;
  if (!appData) fail("no se pudo resolver carpeta de datos; definí DESKTOP_USER_DATA");
  return resolve(join(appData, "radioflow-studio"));
}

function trySqliteBackup(srcDb, destDb) {
  const r = spawnSync("sqlite3", [srcDb, `.backup '${destDb.replace(/'/g, "''")}'`], {
    encoding: "utf8",
    shell: false,
  });
  if (r.status === 0 && existsSync(destDb)) return true;
  return false;
}

function copyDbHot(userData, destDir) {
  const srcDb = join(userData, "radioflow.db");
  if (!existsSync(srcDb)) fail(`no existe ${srcDb} (¿instalaste / abriste RadioFlow al menos una vez?)`);
  const destDb = join(destDir, "radioflow.db");
  if (trySqliteBackup(srcDb, destDb)) {
    log("DB: sqlite3 .backup OK");
    return;
  }
  log("aviso: sqlite3 CLI no disponible — copia de archivos (cerrá la app si hay WAL activo)");
  copyFileSync(srcDb, destDb);
  for (const side of ["radioflow.db-wal", "radioflow.db-shm"]) {
    const p = join(userData, side);
    if (existsSync(p)) copyFileSync(p, join(destDir, side));
  }
}

async function collectHashes(backupDir, relPaths) {
  const files = {};
  for (const rel of relPaths) {
    const abs = join(backupDir, rel);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkFiles(abs, (fileAbs) => {
        const relFile = relativeSafe(backupDir, fileAbs);
        files[relFile] = null; // filled below
      });
    } else {
      files[rel] = null;
    }
  }
  for (const rel of Object.keys(files)) {
    files[rel] = await sha256File(join(backupDir, rel));
  }
  return files;
}

function walkFiles(dir, visit) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkFiles(abs, visit);
    else visit(abs);
  }
}

async function doBackup(userData) {
  const root = backupsRoot();
  const withMedia = includeMedia();
  mkdirSync(root, { recursive: true });
  const backupDir = join(root, `desktop-${stampNow()}`);
  mkdirSync(backupDir, { recursive: true });
  log(`origen: ${userData}`);
  log(`destino: ${backupDir}`);

  copyDbHot(userData, backupDir);

  const jwtSrc = join(userData, "jwt-secret.txt");
  if (existsSync(jwtSrc)) {
    copyFileSync(jwtSrc, join(backupDir, "jwt-secret.txt"));
  }

  const mediaSrc = join(userData, "media");
  if (withMedia && existsSync(mediaSrc)) {
    log("copiando media/ (puede tardar)…");
    cpSync(mediaSrc, join(backupDir, "media"), { recursive: true });
  }

  const rels = ["radioflow.db", "radioflow.db-wal", "radioflow.db-shm", "jwt-secret.txt"];
  if (withMedia) rels.push("media");
  const files = await collectHashes(backupDir, rels);
  if (!files["radioflow.db"]) fail("backup sin radioflow.db");

  const { manifestPath } = writeManifest({
    kind: "desktop",
    backupDir,
    files,
    meta: {
      userData,
      includeMedia: withMedia,
      note: "Cerrá RadioFlow Studio antes de RESTORE=1",
    },
  });
  const man = JSON.parse(readFileSync(manifestPath, "utf8"));
  log(`OK backup + manifiesto: ${manifestPath}`);
  log(`archivos: ${Object.keys(files).length}; firma HMAC: ${man.signature ? "sí" : "no (definí BACKUP_HMAC_SECRET)"}`);
  return backupDir;
}

async function doRestoreFrom(backupDir, userData) {
  const v = await verifyManifest(backupDir, { requireSignature: process.env.REQUIRE_BACKUP_SIGNATURE === "1" });
  if (!v.ok) fail(`manifest inválido: ${v.reason}`);

  mkdirSync(userData, { recursive: true });
  const srcDb = join(backupDir, "radioflow.db");
  if (!existsSync(srcDb)) fail(`falta radioflow.db en ${backupDir}`);

  copyFileSync(srcDb, join(userData, "radioflow.db"));
  for (const side of ["radioflow.db-wal", "radioflow.db-shm"]) {
    const p = join(backupDir, side);
    if (existsSync(p)) copyFileSync(p, join(userData, side));
    else {
      // limpia WAL huérfano que rompería restore
      const dest = join(userData, side);
      if (existsSync(dest)) rmSync(dest, { force: true });
    }
  }

  const jwtSrc = join(backupDir, "jwt-secret.txt");
  if (existsSync(jwtSrc)) copyFileSync(jwtSrc, join(userData, "jwt-secret.txt"));

  const mediaSrc = join(backupDir, "media");
  if (existsSync(mediaSrc)) {
    const mediaDest = join(userData, "media");
    mkdirSync(mediaDest, { recursive: true });
    cpSync(mediaSrc, mediaDest, { recursive: true });
  }

  log(`OK restore → ${userData}`);
  log("Abrí RadioFlow Studio y comprobá login / biblioteca.");
}

async function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), "rf-desktop-backup-"));
  const userData = join(root, "userData");
  const restoreTo = join(root, "restored");
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, "radioflow.db"), Buffer.from("RF-SQLITE-SELFTEST-V1\n" + "x".repeat(2048)));
  writeFileSync(join(userData, "jwt-secret.txt"), "selftest-jwt-secret-32-chars-minimum!!");
  mkdirSync(join(userData, "media"), { recursive: true });
  writeFileSync(join(userData, "media", "tone.txt"), "audio-placeholder");

  process.env.DESKTOP_USER_DATA = userData;
  process.env.BACKUPS_ROOT = join(root, "backups");
  process.env.INCLUDE_MEDIA = "1";
  process.env.BACKUP_HMAC_SECRET = "selftest-hmac-secret";

  log("selftest: backup…");
  const backupDir = await doBackup(userData);

  log("selftest: verify…");
  const v1 = await verifyManifest(backupDir, { requireSignature: true });
  if (!v1.ok) fail(`verify post-backup: ${v1.reason}`);

  log("selftest: restore…");
  await doRestoreFrom(backupDir, restoreTo);
  const a = readFileSync(join(userData, "radioflow.db"));
  const b = readFileSync(join(restoreTo, "radioflow.db"));
  if (!a.equals(b)) fail("DB restaurada ≠ original");
  if (!existsSync(join(restoreTo, "media", "tone.txt"))) fail("media no restaurada");

  log("selftest: detectar corrupción…");
  writeFileSync(join(backupDir, "radioflow.db"), Buffer.from("CORRUPTED"));
  const vBad = await verifyManifest(backupDir);
  if (vBad.ok) fail("debía fallar verify tras corrupción");
  log(`selftest: corrupción detectada OK (${vBad.reason})`);

  rmSync(root, { recursive: true, force: true });
  log("OK DESKTOP_BACKUP_SELFTEST");
}

async function main() {
  if (selfTest) {
    await runSelfTest();
    return;
  }

  if (doVerify) {
    const dir = process.env.BACKUP_DIR;
    if (!dir) fail("VERIFY=1 requiere BACKUP_DIR=backups/desktop-…");
    const v = await verifyManifest(resolve(dir), {
      requireSignature: process.env.REQUIRE_BACKUP_SIGNATURE === "1",
    });
    if (!v.ok) fail(v.reason);
    log(`OK verify ${resolve(dir)} (kind=${v.manifest.kind}, files=${Object.keys(v.manifest.files).length})`);
    return;
  }

  if (doRestore) {
    const dir = process.env.BACKUP_DIR;
    if (!dir) fail("RESTORE=1 requiere BACKUP_DIR=backups/desktop-…");
    await doRestoreFrom(resolve(dir), defaultUserData());
    return;
  }

  await doBackup(defaultUserData());
}

main().catch((e) => fail(e?.stack || e?.message || String(e)));

/**
 * A6 — Backup / restore del producto desktop (SQLite + jwt + media opcional).
 *
 * Backup (incluye media por defecto; DB + jwt + bóveda):
 *   node scripts/desktop-backup-restore.mjs
 *   DESKTOP_USER_DATA="%APPDATA%\\radioflow-studio" node scripts/desktop-backup-restore.mjs
 *   INCLUDE_MEDIA=0 node scripts/desktop-backup-restore.mjs   # solo DB + jwt
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
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  sha256File,
  stampNow,
  writeManifest,
  verifyManifest,
  relativeSafe,
} from "./lib/backup-manifest.mjs";

const require = createRequire(import.meta.url);

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
  // Producto desktop: la bóveda es parte del estado. Opt-out con INCLUDE_MEDIA=0.
  const raw = process.env.INCLUDE_MEDIA;
  if (raw == null || raw === "") return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
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

function createSelftestSqlite(dbPath) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE Station (id TEXT PRIMARY KEY, cabCrossfadeSec REAL NOT NULL DEFAULT 2);
      INSERT INTO Station (id, cabCrossfadeSec) VALUES ('main', 2);
      CREATE TABLE MediaAsset (id TEXT PRIMARY KEY, path TEXT NOT NULL);
      INSERT INTO MediaAsset (id, path) VALUES ('a1', 'uploads/tone.wav');
    `);
    db.close();
    return "node:sqlite";
  } catch {
    /* CLI o fallback */
  }
  const sql = [
    "CREATE TABLE Station (id TEXT PRIMARY KEY, cabCrossfadeSec REAL NOT NULL DEFAULT 2);",
    "INSERT INTO Station (id, cabCrossfadeSec) VALUES ('main', 2);",
    "CREATE TABLE MediaAsset (id TEXT PRIMARY KEY, path TEXT NOT NULL);",
    "INSERT INTO MediaAsset (id, path) VALUES ('a1', 'uploads/tone.wav');",
  ].join("");
  const r = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8", shell: false });
  if (r.status === 0 && existsSync(dbPath)) return "sqlite3";
  fail("no se pudo crear SQLite de selftest (node:sqlite / sqlite3)");
}

function assertSqliteReadable(dbPath) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("PRAGMA integrity_check").get();
    const station = db.prepare("SELECT cabCrossfadeSec FROM Station WHERE id = ?").get("main");
    db.close();
    const ok = String(row?.integrity_check ?? row?.["integrity_check"] ?? Object.values(row ?? {})[0] ?? "")
      .trim()
      .toLowerCase();
    if (ok !== "ok") return { ok: false, detail: ok || "integrity_check falló" };
    if (!station || Number(station.cabCrossfadeSec) !== 2) {
      return { ok: false, detail: "fila Station.main inválida tras restore" };
    }
    return { ok: true, detail: "ok" };
  } catch (err) {
    const r = spawnSync("sqlite3", [dbPath, "PRAGMA integrity_check;"], {
      encoding: "utf8",
      shell: false,
    });
    if (r.status !== 0) {
      return { ok: false, detail: err?.message || "no se pudo abrir SQLite restaurada" };
    }
    const out = String(r.stdout || "").trim().toLowerCase();
    if (out !== "ok") return { ok: false, detail: out || r.stderr || "integrity_check falló" };
    return { ok: true, detail: "ok" };
  }
}

async function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), "rf-desktop-backup-"));
  const userData = join(root, "userData");
  const restoreTo = join(root, "restored");
  mkdirSync(userData, { recursive: true });
  const dbMode = createSelftestSqlite(join(userData, "radioflow.db"));
  writeFileSync(join(userData, "jwt-secret.txt"), "selftest-jwt-secret-32-chars-minimum!!");
  mkdirSync(join(userData, "media", "uploads"), { recursive: true });
  writeFileSync(join(userData, "media", "uploads", "tone.wav"), "RIFF....WAVEfmt ");

  process.env.DESKTOP_USER_DATA = userData;
  process.env.BACKUPS_ROOT = join(root, "backups");
  delete process.env.INCLUDE_MEDIA; // debe incluir media por defecto
  process.env.BACKUP_HMAC_SECRET = "selftest-hmac-secret";

  log(`selftest: DB modo=${dbMode}`);
  log("selftest: backup…");
  const backupDir = await doBackup(userData);
  if (!existsSync(join(backupDir, "media", "uploads", "tone.wav"))) {
    fail("backup sin media (INCLUDE_MEDIA debería ser on por defecto)");
  }

  log("selftest: verify…");
  const v1 = await verifyManifest(backupDir, { requireSignature: true });
  if (!v1.ok) fail(`verify post-backup: ${v1.reason}`);

  log("selftest: restore…");
  await doRestoreFrom(backupDir, restoreTo);
  // El backup puede pasar por `sqlite3 .backup` (bytes de cabecera distintos según versión):
  // exigimos identidad restaurado ↔ backup, y equivalencia lógica con el original vía integrity/queries.
  const a = readFileSync(join(backupDir, "radioflow.db"));
  const b = readFileSync(join(restoreTo, "radioflow.db"));
  if (!a.equals(b)) fail("DB restaurada ≠ backup");
  if (!existsSync(join(restoreTo, "media", "uploads", "tone.wav"))) fail("media no restaurada");

  const integrity = assertSqliteReadable(join(restoreTo, "radioflow.db"));
  if (!integrity.ok) fail(`SQLite integrity: ${integrity.detail}`);
  log(`selftest: SQLite integrity_check=${integrity.detail}`);

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

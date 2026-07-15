/**
 * Drill backup + restore Postgres (V1-02 / A6) según docs/backup-restore.md.
 * Requiere stack prod levantado. No destruye volúmenes salvo RESTORE=1.
 *
 * Uso:
 *   node scripts/prod-backup-restore-drill.mjs
 *   RESTORE=1 node scripts/prod-backup-restore-drill.mjs
 *   VERIFY=1 BACKUP_DIR=backups/postgres-… node scripts/prod-backup-restore-drill.mjs
 *
 * Escribe backup.manifest.json + SHA256SUMS (firma HMAC si JWT_SECRET/BACKUP_HMAC_SECRET).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  sha256File,
  stampNow,
  writeManifest,
  verifyManifest,
} from "./lib/backup-manifest.mjs";

const composeFile = process.env.COMPOSE_FILE ?? "docker-compose.prod.yml";
const base = (process.env.SMOKE_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const doRestore = process.env.RESTORE === "1";
const doVerifyOnly = process.env.VERIFY === "1";

function backupsRoot() {
  return resolve(process.env.BACKUPS_ROOT ?? "backups");
}

function fail(msg) {
  console.error("[prod-backup-drill]", msg);
  process.exit(1);
}

function log(msg) {
  console.log(`[prod-backup-drill] ${msg}`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: false,
    maxBuffer: 50 * 1024 * 1024,
    ...opts,
  });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")}\n${r.stderr ?? r.stdout ?? ""}`);
  }
  return r.stdout ?? "";
}

async function expectReady() {
  const r = await fetch(`${base}/api/health/ready`);
  if (!r.ok) fail(`health/ready → ${r.status}`);
  const j = await r.json();
  if (!j.ready) fail("health/ready not ready");
}

function runBuffer(cmd, args) {
  const r = spawnSync(cmd, args, {
    shell: false,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")}\n${(r.stderr ?? r.stdout ?? "").toString().slice(0, 800)}`);
  }
  return r.stdout ?? Buffer.alloc(0);
}

async function main() {
  if (doVerifyOnly) {
    const dir = process.env.BACKUP_DIR;
    if (!dir) fail("VERIFY=1 requiere BACKUP_DIR");
    const v = await verifyManifest(resolve(dir), {
      requireSignature: process.env.REQUIRE_BACKUP_SIGNATURE === "1",
    });
    if (!v.ok) fail(v.reason);
    log(`OK verify ${resolve(dir)}`);
    return;
  }

  mkdirSync(backupsRoot(), { recursive: true });
  const stamp = stampNow();
  const backupDir = join(backupsRoot(), `postgres-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  const dumpRel = "radioflow.dump";
  const dumpPath = join(backupDir, dumpRel);

  log(`backup → ${dumpPath}`);
  const dump = runBuffer("docker", [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "radioflow",
    "-d",
    "radioflow",
    "--format=custom",
  ]);
  writeFileSync(dumpPath, dump);

  const files = { [dumpRel]: await sha256File(dumpPath) };
  const { manifestPath } = writeManifest({
    kind: "postgres",
    backupDir,
    files,
    meta: {
      composeFile,
      format: "pg_dump custom",
      database: "radioflow",
    },
  });
  log(`OK backup + manifiesto: ${manifestPath}`);

  // Compat: también un .dump suelto con el stamp (como drills viejos)
  const legacyDump = join(backupsRoot(), `radioflow-drill-${stamp}.dump`);
  writeFileSync(legacyDump, dump);
  writeFileSync(`${legacyDump}.sha256`, `${files[dumpRel]}  radioflow-drill-${stamp}.dump\n`);

  const usersBefore = run("docker", [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "radioflow",
    "-d",
    "radioflow",
    "-tAc",
    'SELECT COUNT(*) FROM "User";',
  ]).trim();
  log(`User count antes: ${usersBefore}`);

  if (!doRestore) {
    log("OK (solo backup). Para restore: RESTORE=1 BACKUP_DIR=" + backupDir + " npm run drill:backup-restore");
    log("o: RESTORE=1 node scripts/prod-backup-restore-drill.mjs  (usa el último dump de esta corrida vía BACKUP_DIR)");
    // Allow RESTORE=1 without BACKUP_DIR to use this run's dir when same process — already handled below with doRestore right after.
    return;
  }

  const restoreDir = process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : backupDir;
  const v = await verifyManifest(restoreDir, {
    requireSignature: process.env.REQUIRE_BACKUP_SIGNATURE === "1",
  });
  if (!v.ok) fail(`manifest inválido antes de restore: ${v.reason}`);

  const restoreDump = join(restoreDir, "radioflow.dump");
  const dumpFile = existsSync(restoreDump)
    ? restoreDump
    : existsSync(legacyDump)
      ? legacyDump
      : fail(`no hay radioflow.dump en ${restoreDir}`);

  log(`restore desde ${dumpFile}`);
  const buf = readFileSync(dumpFile);
  const r = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "pg_restore",
      "-U",
      "radioflow",
      "-d",
      "radioflow",
      "--clean",
      "--if-exists",
    ],
    { input: buf, shell: false, maxBuffer: 50 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    console.warn("[prod-backup-drill] pg_restore warnings:", (r.stderr ?? "").toString().slice(0, 500));
  }

  await expectReady();
  const usersAfter = run("docker", [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "radioflow",
    "-d",
    "radioflow",
    "-tAc",
    'SELECT COUNT(*) FROM "User";',
  ]).trim();
  log(`User count después: ${usersAfter}`);

  if (usersBefore !== usersAfter) {
    fail(`conteo User distinto: ${usersBefore} → ${usersAfter}`);
  }

  log("OK backup + restore verificado (A6)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

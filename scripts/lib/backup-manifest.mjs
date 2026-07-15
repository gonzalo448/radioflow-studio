/**
 * Manifiesto de backup (A6): SHA-256 por archivo + firma HMAC opcional.
 * “Firmado” = integridad verificable (checksums + HMAC si hay secreto).
 */
import { createHash, createHmac } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export async function sha256File(filePath) {
  return new Promise((resolveHash, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(filePath);
    s.on("error", reject);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolveHash(h.digest("hex")));
  });
}

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function hmacSecret() {
  return (process.env.BACKUP_HMAC_SECRET || process.env.JWT_SECRET || "").trim();
}

/** Canonical string of path→sha256 pairs (sorted). */
export function canonicalPayload(files) {
  const lines = Object.keys(files)
    .sort()
    .map((k) => `${k}:${files[k]}`);
  return lines.join("\n");
}

export function signPayload(files) {
  const secret = hmacSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(canonicalPayload(files)).digest("hex");
}

export function verifySignature(files, signature) {
  if (!signature) return { ok: true, skipped: true };
  const expected = signPayload(files);
  if (!expected) return { ok: false, reason: "falta BACKUP_HMAC_SECRET/JWT_SECRET para verificar firma" };
  return { ok: expected === signature, expected, got: signature };
}

/**
 * @param {object} opts
 * @param {"postgres"|"desktop"} opts.kind
 * @param {string} opts.backupDir absolute or relative dir of this backup
 * @param {Record<string, string>} opts.files relativePath → sha256
 * @param {object} [opts.meta]
 */
export function writeManifest(opts) {
  const { kind, backupDir, files, meta = {} } = opts;
  const signature = signPayload(files);
  const manifest = {
    version: 1,
    kind,
    createdAt: new Date().toISOString(),
    radioflowBackup: true,
    files,
    signature,
    signatureAlg: signature ? "hmac-sha256" : null,
    meta,
  };
  mkdirSync(backupDir, { recursive: true });
  const manifestPath = join(backupDir, "backup.manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const shaPath = join(backupDir, "SHA256SUMS");
  const sums = Object.keys(files)
    .sort()
    .map((k) => `${files[k]}  ${k}`)
    .join("\n");
  writeFileSync(shaPath, sums + (sums ? "\n" : ""), "utf8");
  return { manifestPath, shaPath, manifest };
}

/**
 * Verifica archivos listados en el manifiesto contra disco.
 * @param {string} backupDir
 * @param {{ requireSignature?: boolean }} [opts]
 */
export async function verifyManifest(backupDir, opts = {}) {
  const manifestPath = join(backupDir, "backup.manifest.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, reason: `falta ${manifestPath}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return { ok: false, reason: `manifest JSON inválido: ${e.message}` };
  }
  if (!manifest?.radioflowBackup || !manifest.files || typeof manifest.files !== "object") {
    return { ok: false, reason: "manifest no es un backup RadioFlow válido" };
  }

  const root = resolve(backupDir);
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const abs = resolve(root, rel);
    if (!abs.startsWith(root)) {
      return { ok: false, reason: `ruta sospechosa en manifest: ${rel}` };
    }
    if (!existsSync(abs)) {
      return { ok: false, reason: `falta archivo ${rel}` };
    }
    const got = await sha256File(abs);
    if (got !== expected) {
      return { ok: false, reason: `SHA-256 mismatch en ${rel}` };
    }
  }

  const sig = verifySignature(manifest.files, manifest.signature);
  if (opts.requireSignature && (!manifest.signature || !sig.ok)) {
    return { ok: false, reason: sig.reason || "firma HMAC requerida y no válida" };
  }
  if (manifest.signature && !sig.ok && !sig.skipped) {
    return { ok: false, reason: "firma HMAC no coincide (¿otro JWT_SECRET/BACKUP_HMAC_SECRET?)" };
  }

  return { ok: true, manifest };
}

export function relativeSafe(from, to) {
  return relative(from, to).replace(/\\/g, "/");
}

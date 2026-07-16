/**
 * Falla CI si hay vulnerabilidades npm critical (V1-01 / release gate).
 * Uso: node scripts/ci-verify-npm-audit.mjs
 * Env:
 * - NPM_AUDIT_MAX_CRITICAL (default 0)
 * - NPM_AUDIT_MAX_HIGH (default, sin límite)
 * - NPM_AUDIT_OMIT_DEV=1 (audita solo dependencias de producción)
 */
import { spawnSync } from "node:child_process";

const maxCritical = Number(process.env.NPM_AUDIT_MAX_CRITICAL ?? "0");
const maxHighRaw = process.env.NPM_AUDIT_MAX_HIGH;
const maxHigh = maxHighRaw != null && maxHighRaw !== "" ? Number(maxHighRaw) : null;
const omitDev = process.env.NPM_AUDIT_OMIT_DEV === "1";

if (!Number.isFinite(maxCritical) || (maxHigh != null && !Number.isFinite(maxHigh))) {
  console.error("[ci-verify-npm-audit] FAIL: umbral inválido");
  process.exit(1);
}

const auditArgs = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
const command =
  process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", `npm ${auditArgs.join(" ")}`]
    : auditArgs;
const r = spawnSync(command, args, {
  encoding: "utf8",
  shell: false,
  maxBuffer: 20 * 1024 * 1024,
});

if (r.error) {
  console.error(`[ci-verify-npm-audit] FAIL: no se pudo ejecutar npm audit: ${r.error.message}`);
  process.exit(1);
}

let audit;
try {
  audit = JSON.parse(r.stdout || "");
} catch {
  console.error("[ci-verify-npm-audit] FAIL: npm audit no devolvió JSON válido");
  if (r.stderr) console.error(r.stderr.trim());
  process.exit(1);
}

if (audit.error || !audit.metadata?.vulnerabilities) {
  console.error(
    `[ci-verify-npm-audit] FAIL: respuesta de npm audit incompleta${
      audit.error?.summary ? `: ${audit.error.summary}` : ""
    }`,
  );
  process.exit(1);
}

// npm audit usa exit 1 cuando encuentra vulnerabilidades; otros códigos indican fallo operativo.
if (r.status != null && r.status > 1) {
  console.error(`[ci-verify-npm-audit] FAIL: npm audit terminó con código ${r.status}`);
  process.exit(1);
}

const vuln = audit.metadata.vulnerabilities;
const critical = Number(vuln.critical ?? 0);
const high = Number(vuln.high ?? 0);
const moderate = Number(vuln.moderate ?? 0);
const low = Number(vuln.low ?? 0);

console.log(
  `[ci-verify-npm-audit] scope=${omitDev ? "production" : "all"} critical=${critical} high=${high} moderate=${moderate} low=${low}`,
);

if (critical > maxCritical) {
  console.error(
    `[ci-verify-npm-audit] FAIL: ${critical} critical (máx ${maxCritical}). Ejecutá npm audit para detalle.`,
  );
  process.exit(1);
}

if (maxHigh != null && high > maxHigh) {
  console.error(`[ci-verify-npm-audit] FAIL: ${high} high (máx ${maxHigh})`);
  process.exit(1);
}

console.log("[ci-verify-npm-audit] OK");

/**
 * Falla CI si hay vulnerabilidades npm critical (V1-01 / release gate).
 * Uso: node scripts/ci-verify-npm-audit.mjs
 * Env: NPM_AUDIT_MAX_CRITICAL (default 0), NPM_AUDIT_MAX_HIGH (default, sin límite)
 */
import { spawnSync } from "node:child_process";

const maxCritical = Number(process.env.NPM_AUDIT_MAX_CRITICAL ?? "0");
const maxHighRaw = process.env.NPM_AUDIT_MAX_HIGH;
const maxHigh = maxHighRaw != null && maxHighRaw !== "" ? Number(maxHighRaw) : null;

const r = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  shell: false,
  maxBuffer: 20 * 1024 * 1024,
});

let audit;
try {
  audit = JSON.parse(r.stdout || "{}");
} catch {
  console.error("[ci-verify-npm-audit] FAIL: npm audit no devolvió JSON válido");
  process.exit(1);
}

const vuln = audit.metadata?.vulnerabilities ?? {};
const critical = Number(vuln.critical ?? 0);
const high = Number(vuln.high ?? 0);
const moderate = Number(vuln.moderate ?? 0);
const low = Number(vuln.low ?? 0);

console.log(
  `[ci-verify-npm-audit] critical=${critical} high=${high} moderate=${moderate} low=${low}`,
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

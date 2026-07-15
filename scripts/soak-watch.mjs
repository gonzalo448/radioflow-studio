/**
 * A8 / V1-06 — Observador de soak staging.
 * Muestrea health (+ broadcast si hay token) y escribe evidencia JSONL + resumen PASS/FAIL.
 *
 * Uso:
 *   npm run soak:sample          # una muestra → logs/soak/
 *   npm run soak:watch           # 72 h (o SOAK_DURATION_MS) con intervalo SOAK_INTERVAL_MS
 *
 * Env:
 *   SMOKE_API_URL                 default http://127.0.0.1:4000
 *   SOAK_DURATION_MS              default 259200000 (72 h); usa 60000 para prueba corta
 *   SOAK_INTERVAL_MS              default 300000 (5 min)
 *   SOAK_ONCE=1                   una sola muestra y sale
 *   SOAK_TOKEN                    JWT (dj+) para /streaming/broadcast-status
 *   SOAK_REQUIRE_BROADCAST=1      falla el resumen si no hubo muestras de Icecast OK
 *   SOAK_MAX_SOURCE_DOWN_MS       default 300000 (5 min) — racha sourceAlert activa
 *   SOAK_DIR                      default logs/soak
 *   SOAK_FAIL_ON_READY=1          (default) ready=false cuenta como fallo de muestra
 */

import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const base = (process.env.SMOKE_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const once = process.env.SOAK_ONCE === "1";
const durationMs = once ? 0 : Number(process.env.SOAK_DURATION_MS ?? String(72 * 60 * 60 * 1000));
const intervalMs = Math.max(5_000, Number(process.env.SOAK_INTERVAL_MS ?? "300000"));
const token = process.env.SOAK_TOKEN?.trim() || "";
const requireBroadcast = process.env.SOAK_REQUIRE_BROADCAST === "1";
const maxSourceDownMs = Number(process.env.SOAK_MAX_SOURCE_DOWN_MS ?? "300000");
const failOnReady = process.env.SOAK_FAIL_ON_READY !== "0";
const soakDir = resolve(process.env.SOAK_DIR ?? "logs/soak");

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function log(msg) {
  console.log(`[soak-watch] ${msg}`);
}

function fail(msg) {
  console.error(`[soak-watch] FAIL: ${msg}`);
  process.exit(1);
}

async function fetchJson(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, {
    ...opts,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { ok: r.ok, status: r.status, data };
}

/**
 * @returns {Promise<{
 *   at: string,
 *   ok: boolean,
 *   ready: boolean|null,
 *   healthStatus: string|null,
 *   sourceConnected: boolean|null,
 *   sourceAlertActive: boolean|null,
 *   encoderStale: boolean|null,
 *   errors: string[],
 * }>}
 */
async function sample() {
  const at = new Date().toISOString();
  const errors = [];
  let ready = null;
  let healthStatus = null;
  let sourceConnected = null;
  let sourceAlertActive = null;
  let encoderStale = null;

  try {
    const h = await fetchJson("/api/health");
    if (!h.ok) errors.push(`health HTTP ${h.status}`);
    healthStatus = h.data?.status ?? null;
    if (healthStatus && healthStatus !== "ok" && healthStatus !== "degraded") {
      errors.push(`health.status=${healthStatus}`);
    }
  } catch (e) {
    errors.push(`health: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const r = await fetchJson("/api/health/ready");
    ready = Boolean(r.data?.ready && r.data?.database === "ok");
    if (!r.ok || (failOnReady && !ready)) {
      errors.push(`ready HTTP ${r.status} ready=${r.data?.ready} db=${r.data?.database}`);
    }
  } catch (e) {
    errors.push(`ready: ${e instanceof Error ? e.message : String(e)}`);
    ready = false;
  }

  if (token) {
    try {
      const b = await fetchJson("/api/streaming/broadcast-status");
      if (!b.ok) {
        errors.push(`broadcast-status HTTP ${b.status}`);
      } else {
        sourceConnected = b.data?.icecast?.sourceConnected ?? null;
        sourceAlertActive = Boolean(b.data?.sourceAlert?.active);
        encoderStale = b.data?.encoder == null ? null : Boolean(b.data.encoder.stale);
        if (sourceAlertActive) errors.push("sourceAlert.active");
        if (b.data?.icecast?.sourceConnected === false) {
          // no necesariamente error de muestra hasta superar umbral de racha
        }
      }
    } catch (e) {
      errors.push(`broadcast: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const ok = errors.length === 0;
  return {
    at,
    ok,
    ready,
    healthStatus,
    sourceConnected,
    sourceAlertActive,
    encoderStale,
    errors,
  };
}

function summarize(samples, startedAt, endedAt) {
  const total = samples.length;
  const okCount = samples.filter((s) => s.ok).length;
  const readyOk = samples.filter((s) => s.ready === true).length;
  const uptimePct = total ? (100 * readyOk) / total : 0;

  let maxSourceAlertStreakMs = 0;
  let streakStart = null;
  for (const s of samples) {
    if (s.sourceAlertActive) {
      if (!streakStart) streakStart = Date.parse(s.at);
      maxSourceAlertStreakMs = Math.max(maxSourceAlertStreakMs, Date.parse(s.at) - streakStart);
    } else {
      streakStart = null;
    }
  }

  const broadcastSamples = samples.filter((s) => s.sourceConnected !== null || s.sourceAlertActive !== null);
  const reasons = [];
  if (uptimePct < 99) reasons.push(`uptime ready ${uptimePct.toFixed(2)}% < 99%`);
  if (maxSourceAlertStreakMs >= maxSourceDownMs) {
    reasons.push(`sourceAlert streak ${maxSourceAlertStreakMs}ms ≥ ${maxSourceDownMs}ms`);
  }
  if (requireBroadcast && broadcastSamples.length === 0) {
    reasons.push("SOAK_REQUIRE_BROADCAST=1 pero no hubo muestras broadcast (¿SOAK_TOKEN?)");
  }
  if (total === 0) reasons.push("sin muestras");

  const pass = reasons.length === 0;
  return {
    version: 1,
    radioflowSoak: true,
    pass,
    reasons,
    startedAt,
    endedAt,
    durationMs: Date.parse(endedAt) - Date.parse(startedAt),
    sampleCount: total,
    okSamples: okCount,
    readyOkSamples: readyOk,
    uptimeReadyPct: Number(uptimePct.toFixed(3)),
    maxSourceAlertStreakMs,
    maxSourceDownMs,
    requireBroadcast,
    apiBase: base,
  };
}

async function main() {
  mkdirSync(soakDir, { recursive: true });
  const runId = stamp();
  const jsonlPath = join(soakDir, `soak-${runId}.jsonl`);
  const summaryPath = join(soakDir, `soak-summary-${runId}.json`);
  const startedAt = new Date().toISOString();
  const deadline = once ? Date.now() : Date.now() + durationMs;

  log(`API ${base}`);
  log(`evidencia → ${jsonlPath}`);
  log(once ? "modo: una muestra" : `modo: watch ${durationMs}ms cada ${intervalMs}ms`);

  /** @type {Awaited<ReturnType<typeof sample>>[]} */
  const samples = [];

  while (true) {
    const s = await sample();
    samples.push(s);
    appendFileSync(jsonlPath, JSON.stringify(s) + "\n", "utf8");
    const mark = s.ok ? "OK" : "ERR";
    log(`${mark} ${s.at} ready=${s.ready} source=${s.sourceConnected} alert=${s.sourceAlertActive} ${s.errors.join("; ")}`);

    if (once) break;
    if (Date.now() >= deadline) break;
    const sleep = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
    if (sleep <= 0) break;
    await new Promise((r) => setTimeout(r, sleep));
  }

  const endedAt = new Date().toISOString();
  const summary = summarize(samples, startedAt, endedAt);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  log(`resumen → ${summaryPath}`);
  log(summary.pass ? "PASS" : `FAIL: ${summary.reasons.join(" | ")}`);

  // Firma operativa: plantilla markdown junto al resumen
  const mdPath = join(soakDir, `soak-signoff-${runId}.md`);
  writeFileSync(
    mdPath,
    [
      `# Soak sign-off ${runId}`,
      "",
      `- Resultado automático: **${summary.pass ? "PASS" : "FAIL"}**`,
      `- Inicio: ${startedAt}`,
      `- Fin: ${endedAt}`,
      `- Muestras: ${summary.sampleCount} (ready OK ${summary.readyOkSamples}, uptime ${summary.uptimeReadyPct}%)`,
      `- Racha máx. sourceAlert: ${summary.maxSourceAlertStreakMs} ms (límite ${summary.maxSourceDownMs} ms)`,
      `- Evidencia: \`${jsonlPath.replace(/\\/g, "/")}\``,
      `- Resumen JSON: \`${summaryPath.replace(/\\/g, "/")}\``,
      "",
      "## Firma humana (V1-06)",
      "",
      "| Campo | Valor |",
      "|-------|-------|",
      "| Responsable | |",
      "| Escenarios manuales (cabina/playlist/pedido/backup) | ☐ OK |",
      "| CI verde en main | ☐ OK |",
      "| Restore backup ≤ 30 min | ☐ OK |",
      "| Firma / fecha | |",
      "",
    ].join("\n"),
    "utf8",
  );
  log(`sign-off → ${mdPath}`);

  if (!existsSync(join(soakDir, ".gitkeep"))) {
    writeFileSync(join(soakDir, ".gitkeep"), "", "utf8");
  }

  if (!summary.pass) process.exit(1);
}

main().catch((e) => fail(e?.stack || e?.message || String(e)));

/**
 * Verificación prod-like según docs/release-1.0-runbook.md §2.
 * Requiere stack levantado: docker compose -f docker-compose.prod.yml up -d
 *
 * Uso: node scripts/prod-staging-verify.mjs
 * Env: SMOKE_API_URL (default http://127.0.0.1:4000), COMPOSE_FILE (default docker-compose.prod.yml)
 */
import { spawnSync } from "node:child_process";

const base = (process.env.SMOKE_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const composeFile = process.env.COMPOSE_FILE ?? "docker-compose.prod.yml";

function fail(msg) {
  console.error("[prod-staging-verify]", msg);
  process.exit(1);
}

async function expectOk(url, what) {
  const r = await fetch(url);
  const text = await r.text();
  if (!r.ok) fail(`${what} → ${r.status}: ${text.slice(0, 300)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    fail(`${what}: respuesta no JSON`);
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, maxBuffer: 50 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")} → ${r.status}\n${r.stderr ?? r.stdout ?? ""}`);
  }
  return (r.stdout ?? "").trim();
}

async function main() {
  console.log("[prod-staging-verify] compose ps");
  console.log(run("docker", ["compose", "-f", composeFile, "ps"]));

  const health = await expectOk(`${base}/api/health`, "GET /api/health");
  if (health.status !== "ok" && health.status !== "degraded") {
    fail(`health.status inesperado: ${health.status}`);
  }

  const ready = await expectOk(`${base}/api/health/ready`, "GET /api/health/ready");
  if (!ready.ready || ready.database !== "ok") fail("health/ready: BD no ok");

  console.log("[prod-staging-verify] ci-verify-migrate (en contenedor api)");
  run("docker", [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "api",
    "node",
    "/app/apps/api/scripts/ci-verify-migrate.mjs",
  ]);

  console.log("[prod-staging-verify] pgvector");
  const pgOut = run("docker", [
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
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');",
  ]);
  if (!pgOut.includes("t")) {
    console.warn("[prod-staging-verify] WARN: extensión vector no detectada");
  } else {
    console.log("[prod-staging-verify] OK: pgvector instalado");
  }

  console.log("[prod-staging-verify] smoke API básico");
  run("node", ["scripts/smoke-api.mjs"], { env: { ...process.env, SMOKE_API_URL: base } });

  console.log("[prod-staging-verify] OK — deploy prod-like verificado");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

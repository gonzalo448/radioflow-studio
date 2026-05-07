/**
 * Pruebas de humo contra una API ya levantada (p. ej. CI u orden local).
 * Uso: SMOKE_API_URL=http://127.0.0.1:4000 node scripts/smoke-api.mjs
 */

const base = (process.env.SMOKE_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

function fail(msg) {
  console.error("[smoke]", msg);
  process.exit(1);
}

async function expectOk(r, what) {
  const text = await r.text();
  if (!r.ok) fail(`${what} → ${r.status}: ${text.slice(0, 400)}`);
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    fail(`${what}: respuesta no JSON`);
  }
  return data;
}

async function main() {
  let r = await fetch(`${base}/api/health`);
  const health = await expectOk(r, "GET /api/health");
  if (health.status !== "ok") fail("health.status !== ok");

  r = await fetch(`${base}/api/health/ready`);
  const ready = await expectOk(r, "GET /api/health/ready");
  if (!ready.ready || ready.database !== "ok") fail("health/ready: BD no ok");

  r = await fetch(`${base}/api/station`);
  const station = await expectOk(r, "GET /api/station");
  if (!station.station || !Array.isArray(station.queue)) fail("forma de /api/station");

  r = await fetch(`${base}/api/settings`);
  await expectOk(r, "GET /api/settings");

  const email = `smoke-${Date.now()}@example.com`;
  const password = "SmokeTestPassword8";
  r = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "Smoke CI" }),
  });
  const reg = await expectOk(r, "POST /api/auth/register");
  if (!reg.token) fail("register sin token");

  r = await fetch(`${base}/api/users/me`, {
    headers: { Authorization: `Bearer ${reg.token}` },
  });
  const me = await expectOk(r, "GET /api/users/me");
  if (me.email !== email) fail("users/me email no coincide");

  console.log("[smoke] OK", base);
}

await main();

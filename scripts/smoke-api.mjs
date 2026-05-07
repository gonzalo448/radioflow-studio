/**
 * Pruebas de humo contra una API ya levantada (p. ej. CI u orden local).
 * Uso: SMOKE_API_URL=http://127.0.0.1:4000 node scripts/smoke-api.mjs
 *
 * Flujo ampliado (upload + playlist → cola): definir SMOKE_PROMOTE_TO_EDITOR=1 y DATABASE_URL
 * para subir el usuario recién registrado a rol editor (solo entornos de prueba).
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

/** Sube a editor vía Prisma (misma BD que la API). Solo para CI / entornos controlados. */
async function promoteToEditor(userId) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail("SMOKE_PROMOTE_TO_EDITOR sin DATABASE_URL");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    await prisma.user.update({ where: { id: userId }, data: { role: "editor" } });
  } finally {
    await prisma.$disconnect();
  }
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
  r = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "SmokeTestPassword8", displayName: "Smoke CI" }),
  });
  const reg = await expectOk(r, "POST /api/auth/register");
  if (!reg.token) fail("register sin token");
  if (!reg.user?.id) fail("register sin user.id");

  r = await fetch(`${base}/api/users/me`, {
    headers: { Authorization: `Bearer ${reg.token}` },
  });
  const me = await expectOk(r, "GET /api/users/me");
  if (me.email !== email) fail("users/me email no coincide");

  const auth = { Authorization: `Bearer ${reg.token}` };

  if (process.env.SMOKE_PROMOTE_TO_EDITOR === "1") {
    await promoteToEditor(reg.user.id);
    console.log("[smoke] usuario promovido a editor (BD)");

    const fd = new FormData();
    fd.append(
      "file",
      new Blob([Uint8Array.of(0xff, 0xf3, 0x14, 0xc4, 0x00)], { type: "audio/mpeg" }),
      "smoke-min.mp3",
    );
    r = await fetch(`${base}/api/library/upload`, { method: "POST", headers: auth, body: fd });
    const uploaded = await expectOk(r, "POST /api/library/upload");
    if (!uploaded.id || !uploaded.path) fail("upload sin asset");

    r = await fetch(`${base}/api/library/assets/${uploaded.id}/stream`);
    if (!r.ok) fail(`GET stream → ${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 1) fail("stream vacío");

    r = await fetch(`${base}/api/playlists`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Smoke playlist ${Date.now()}` }),
    });
    const playlist = await expectOk(r, "POST /api/playlists");
    if (!playlist.id) fail("playlist sin id");

    r = await fetch(`${base}/api/playlists/${playlist.id}/items`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: uploaded.id }),
    });
    await expectOk(r, "POST /api/playlists/.../items");

    r = await fetch(`${base}/api/station/queue-from-playlist`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ playlistId: playlist.id, replace: true }),
    });
    const stationAfter = await expectOk(r, "POST /api/station/queue-from-playlist");
    if (!Array.isArray(stationAfter.queue) || stationAfter.queue.length < 1) {
      fail("cola vacía tras queue-from-playlist");
    }
    const first = stationAfter.queue[0];
    if (!first?.asset?.id || first.asset.id !== uploaded.id) {
      fail("primer ítem de cola no coincide con el upload");
    }
  } else {
    console.log("[smoke] (omitido flujo profundo; SMOKE_PROMOTE_TO_EDITOR=1 para upload/playlist/cola)");
  }

  console.log("[smoke] OK", base);
}

await main();

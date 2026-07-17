/**
 * Pruebas de humo contra una API ya levantada (p. ej. CI u orden local).
 * Uso: SMOKE_API_URL=http://127.0.0.1:4000 node scripts/smoke-api.mjs
 *
 * Rate-limit (opcional): API con RATE_LIMIT_AUTH_MAX=N (2–20), luego:
 *   SMOKE_RATE_LIMIT_PROBE=1 SMOKE_EXPECT_AUTH_MAX=N node scripts/smoke-api.mjs
 *
 * Flujo ampliado (upload + playlist → cola + process-jobs): definir SMOKE_PROMOTE_TO_EDITOR=1 y DATABASE_URL
 * para subir el usuario recién registrado a rol editor (solo entornos de prueba). Los jobs encolados pueden
 * quedar `pending` si no hay worker de biblioteca en el mismo entorno.
 */

const base = (process.env.SMOKE_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

function fail(msg) {
  console.error("[smoke]", msg);
  process.exit(1);
}

function expectRateLimitHeaders(r, what) {
  const limit = r.headers.get("RateLimit-Limit");
  const rem = r.headers.get("RateLimit-Remaining");
  const reset = r.headers.get("RateLimit-Reset");
  if (limit == null || rem == null || reset == null) {
    fail(`${what}: faltan RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset`);
  }
  const num = (s) => /^\d+$/.test(String(s).trim());
  if (!num(limit) || !num(rem) || !num(reset)) {
    fail(`${what}: RateLimit-* no son enteros (${limit}, ${rem}, ${reset})`);
  }
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
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const apiPkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "api", "package.json");
  const require = createRequire(apiPkg);
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    await prisma.user.update({ where: { id: userId }, data: { role: "editor" } });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  let   r = await fetch(`${base}/api/health`);
  const health = await expectOk(r, "GET /api/health");
  if (health.status !== "ok" && health.status !== "degraded") {
    fail(`health.status inesperado: ${health.status} (se esperaba ok o degraded)`);
  }

  r = await fetch(`${base}/api/health/ready`);
  const ready = await expectOk(r, "GET /api/health/ready");
  if (!ready.ready || ready.database !== "ok") fail("health/ready: BD no ok");
  if (typeof ready.degraded !== "boolean") fail("health/ready: degraded no es boolean");
  if (!["disabled", "ok", "down"].includes(ready.redis)) fail("health/ready: redis inválido");

  r = await fetch(`${base}/api/health/meta`);
  const meta = await expectOk(r, "GET /api/health/meta");
  if (meta.rateLimitAuth?.max == null || meta.rateLimitAuth?.windowSec == null) {
    fail("health/meta: rateLimitAuth incompleto");
  }
  if (!meta.schedule || typeof meta.schedule.applyMode !== "string") {
    fail("health/meta: schedule (C3) ausente");
  }
  if (!["internal", "worker", "manual", "off"].includes(meta.schedule.applyMode)) {
    fail(`health/meta: schedule.applyMode inválido (${meta.schedule.applyMode})`);
  }
  if (typeof meta.schedule.internalPollMsEffective !== "number") {
    fail("health/meta: schedule.internalPollMsEffective");
  }
  if (typeof meta.schedule.liquidsoapM3uPollMs !== "number") {
    fail("health/meta: schedule.liquidsoapM3uPollMs");
  }
  if (meta.schedule.applyMode === "worker" && meta.schedule.internalPollMsEffective > 0) {
    fail("health/meta C3: modo worker con internalPollMsEffective>0");
  }
  if (meta.internalSchedulerActive !== (meta.schedule.internalPollMsEffective > 0)) {
    fail("health/meta C3: internalSchedulerActive no coincide con poll efectivo");
  }
  console.log(
    `[smoke] C3 schedule applyMode=${meta.schedule.applyMode} pollEff=${meta.schedule.internalPollMsEffective}`,
  );

  r = await fetch(`${base}/api/station`);
  const station = await expectOk(r, "GET /api/station");
  if (!station.station || !Array.isArray(station.queue)) fail("forma de /api/station");
  if (!("nowPlayingInfo" in station)) fail("/api/station: falta nowPlayingInfo");

  r = await fetch(`${base}/api/public/now-playing`);
  const npPublic = await expectOk(r, "GET /api/public/now-playing");
  if (typeof npPublic.playing !== "boolean" || !("now" in npPublic) || typeof npPublic.fetchedAt !== "string") {
    fail("forma de /api/public/now-playing");
  }

  r = await fetch(`${base}/api/public/nowplaying.json`);
  const npJson = await expectOk(r, "GET /api/public/nowplaying.json");
  if (typeof npJson.playing !== "boolean" || typeof npJson.fetchedAt !== "string") {
    fail("forma de /api/public/nowplaying.json");
  }

  r = await fetch(`${base}/api/public/current-cover.jpg`);
  if (r.status !== 404 && r.status !== 200) {
    fail(`GET /api/public/current-cover.jpg → ${r.status} (esperado 200 o 404 sin pista)`);
  }

  r = await fetch(`${base}/api/settings`);
  await expectOk(r, "GET /api/settings");

  const email = `smoke-${Date.now()}@example.com`;
  r = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "SmokeTestPassword8", displayName: "Smoke CI" }),
  });
  expectRateLimitHeaders(r, "POST /api/auth/register");
  const reg = await expectOk(r, "POST /api/auth/register");
  if (!reg.token) fail("register sin token");
  if (!reg.refreshToken) fail("register sin refreshToken");
  if (!reg.user?.id) fail("register sin user.id");

  r = await fetch(`${base}/api/users/me`, {
    headers: { Authorization: `Bearer ${reg.token}` },
  });
  const me = await expectOk(r, "GET /api/users/me");
  if (me.email !== email) fail("users/me email no coincide");

  // Refresh token flow
  r = await fetch(`${base}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: reg.refreshToken }),
  });
  const refreshed = await expectOk(r, "POST /api/auth/refresh");
  if (!refreshed.token || !refreshed.refreshToken) fail("refresh sin token/refreshToken");

  // Scheduler events (manual run): requiere rol editor o admin. Usamos promoción a editor si está habilitado.
  if (process.env.SMOKE_PROMOTE_TO_EDITOR === "1") {
    await promoteToEditor(reg.user.id);
    console.log("[smoke] usuario promovido a editor (BD)");

    // Crear evento PLAY_PLAYLIST con runAt null (lo ejecutamos manual)
    // Primero creamos una playlist mínima
    r = await fetch(`${base}/api/playlists`, {
      method: "POST",
      headers: { Authorization: `Bearer ${reg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Smoke sched ${Date.now()}` }),
    });
    const pl = await expectOk(r, "POST /api/playlists (sched prep)");

    // Subimos un asset demo pequeño vía upload para poder meterlo en playlist
    const fd2 = new FormData();
    fd2.append("file", new Blob([Uint8Array.of(0x52,0x49,0x46,0x46,0,0,0,0)], { type: "audio/wav" }), "smoke.wav");
    r = await fetch(`${base}/api/library/upload`, { method: "POST", headers: { Authorization: `Bearer ${reg.token}` }, body: fd2 });
    const a = await expectOk(r, "POST /api/library/upload (sched prep)");

    r = await fetch(`${base}/api/playlists/${pl.id}/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${reg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: a.id }),
    });
    await expectOk(r, "POST /api/playlists/:id/items (sched prep)");

    r = await fetch(`${base}/api/scheduler/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${reg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "smoke event", actionType: "PLAY_PLAYLIST", runAt: null, payload: { playlistId: pl.id, replaceQueue: true } }),
    });
    const ev = await expectOk(r, "POST /api/scheduler/events");
    if (!ev.id) fail("scheduler event sin id");

    r = await fetch(`${base}/api/scheduler/events/${ev.id}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${reg.token}` },
    });
    const ran = await expectOk(r, "POST /api/scheduler/events/:id/run");
    if (!ran.ok || ran.run?.status !== "success") fail("scheduler run no success");
    console.log("[smoke] scheduler events (run now) OK");
  }

  // Logout-all invalida refresh tokens activos
  r = await fetch(`${base}/api/auth/logout-all`, { method: "POST", headers: { Authorization: `Bearer ${reg.token}` } });
  await expectOk(r, "POST /api/auth/logout-all");
  r = await fetch(`${base}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: refreshed.refreshToken }),
  });
  if (r.status !== 401) {
    const t = await r.text();
    fail(`logout-all: refresh debería fallar con 401, ${r.status}: ${t.slice(0, 200)}`);
  }

  // Reuse detection controlado:
  // 1) emitimos una sesión nueva (login) para obtener rt0
  r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "SmokeTestPassword8" }),
  });
  expectRateLimitHeaders(r, "POST /api/auth/login");
  const loginRemaining = Number(r.headers.get("RateLimit-Remaining"));
  const login = await expectOk(r, "POST /api/auth/login");
  // 2) rotamos rt0 -> rt1
  r = await fetch(`${base}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: login.refreshToken }),
  });
  const r1 = await expectOk(r, "POST /api/auth/refresh (rotación)");
  // 3) reutilizamos rt0 (revocado + replacedById) → 401 y revocación defensiva
  r = await fetch(`${base}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: login.refreshToken }),
  });
  if (r.status !== 401) {
    const t = await r.text();
    fail(`reuse detection: esperaba 401 al reusar rt0, ${r.status}: ${t.slice(0, 200)}`);
  }
  // 4) tras la defensa, rt1 también debería quedar inválido (revocado globalmente)
  r = await fetch(`${base}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: r1.refreshToken }),
  });
  if (r.status !== 401) {
    const t = await r.text();
    fail(`reuse detection: esperaba 401 al usar rt1 tras defensa, ${r.status}: ${t.slice(0, 200)}`);
  }

  if (process.env.SMOKE_RATE_LIMIT_PROBE === "1") {
    const max = Number(process.env.SMOKE_EXPECT_AUTH_MAX);
    if (!Number.isInteger(max) || max < 2 || max > 20) {
      fail(
        "SMOKE_RATE_LIMIT_PROBE=1 requiere SMOKE_EXPECT_AUTH_MAX entero 2–20 (debe coincidir con RATE_LIMIT_AUTH_MAX de la API)",
      );
    }
    const loginUrl = `${base}/api/auth/login`;
    const badBody = JSON.stringify({ email, password: "WrongPassword!!!999" });
    // El login de reuse detection ya consumió cupos de la misma IP: usar Remaining.
    const remaining =
      Number.isInteger(loginRemaining) && loginRemaining >= 0 ? loginRemaining : Math.max(0, max - 1);
    let saw401 = false;
    for (let i = 0; i < remaining; i++) {
      r = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: badBody,
      });
      expectRateLimitHeaders(r, `POST /api/auth/login fallido ${i + 1}/${remaining}`);
      const t401 = await r.text();
      if (r.status !== 401) fail(`login fallido: esperaba 401, ${r.status}: ${t401.slice(0, 200)}`);
      saw401 = true;
    }
    if (!saw401 && remaining > 0) fail("rate-limit probe: no hubo 401 previos al 429");
    r = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: badBody,
    });
    expectRateLimitHeaders(r, "POST /api/auth/login (rate limit)");
    const t429 = await r.text();
    if (r.status !== 429) fail(`esperaba 429 tras agotar límite, ${r.status}: ${t429.slice(0, 200)}`);
    const ra = r.headers.get("Retry-After");
    if (ra == null || !/^\d+$/.test(String(ra).trim())) fail("429 sin Retry-After entero");
    console.log(`[smoke] rate-limit (429 + cabeceras, remainingPrev=${remaining}) OK`);
  }

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

    r = await fetch(`${base}/api/library/assets`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Externo", path: "C:/no-en-boveda/smoke.mp3" }),
    });
    if (r.status !== 403) {
      const t = await r.text();
      fail(`POST /api/library/assets register en modo copy: esperaba 403, ${r.status}: ${t.slice(0, 200)}`);
    }
    const regErr = await r.json();
    if (regErr.code !== "VAULT_INGEST_COPY_ONLY") {
      fail(`register_path: code esperado VAULT_INGEST_COPY_ONLY, got ${regErr.code}`);
    }

    r = await fetch(`${base}/api/library/import/m3u`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "#EXTM3U\nuploads/smoke-min.mp3\n" }),
    });
    if (r.status !== 403) {
      const t = await r.text();
      fail(`POST /api/library/import/m3u en modo copy: esperaba 403, ${r.status}: ${t.slice(0, 200)}`);
    }

    r = await fetch(`${base}/api/library/assets/${uploaded.id}/stream`);
    if (!r.ok) fail(`GET stream → ${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 1) fail("stream vacío");

    r = await fetch(`${base}/api/library/process-jobs`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "bpm_detect",
        assetIds: [uploaded.id],
        policy: { preferEmbeddedTags: true },
      }),
    });
    const jobEnq = await expectOk(r, "POST /api/library/process-jobs (bpm_detect)");
    if (!jobEnq.jobId || typeof jobEnq.jobId !== "string") fail("process-jobs sin jobId");

    r = await fetch(`${base}/api/library/process-jobs/${encodeURIComponent(jobEnq.jobId)}`, {
      headers: auth,
    });
    const jobDet = await expectOk(r, "GET /api/library/process-jobs/:id");
    if (jobDet.id !== jobEnq.jobId) fail("process-jobs detail: id no coincide");
    if (jobDet.kind !== "bpm_detect") fail(`process-jobs detail: kind inesperado (${jobDet.kind})`);
    if (!["pending", "running", "completed", "failed"].includes(jobDet.status)) {
      fail(`process-jobs detail: status inesperado (${jobDet.status})`);
    }

    r = await fetch(`${base}/api/library/process-jobs?take=10`, { headers: auth });
    const jobList = await expectOk(r, "GET /api/library/process-jobs");
    if (!Array.isArray(jobList) || !jobList.some((j) => j.id === jobEnq.jobId)) {
      fail("GET /api/library/process-jobs no incluye el job encolado");
    }

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

    // B3: parrilla apply-active + ads break (pathPrefix = uploads/ del smoke)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const startMinute = Math.max(0, minuteOfDay - 15);
    const endMinute = Math.min(1439, minuteOfDay + 45);

    r = await fetch(`${base}/api/schedule`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        label: `Smoke B3 ${Date.now()}`,
        dayOfWeek,
        startMinute,
        endMinute,
        playlistId: playlist.id,
        priority: 10,
      }),
    });
    const block = await expectOk(r, "POST /api/schedule");
    if (!block.id) fail("schedule block sin id");

    r = await fetch(`${base}/api/schedule/apply-active`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ replace: true, force: true }),
    });
    const applied = await expectOk(r, "POST /api/schedule/apply-active");
    if (!applied.applied) {
      fail(`apply-active no aplicado: reason=${applied.reason}`);
    }

    r = await fetch(`${base}/api/ads/config`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ pathPrefix: "uploads/" }),
    });
    await expectOk(r, "PATCH /api/ads/config");

    r = await fetch(`${base}/api/ads/spots?pathPrefix=uploads/`, { headers: auth });
    const spots = await expectOk(r, "GET /api/ads/spots");
    if (!Array.isArray(spots) || spots.length < 1) fail("ads/spots vacío tras upload en uploads/");

    r = await fetch(`${base}/api/ads/break`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ pathPrefix: "uploads/", spotCount: 1 }),
    });
    const brk = await expectOk(r, "POST /api/ads/break");
    if (!brk.insertedCount || brk.insertedCount < 1) fail(`ads/break insertedCount=${brk.insertedCount}`);

    r = await fetch(`${base}/api/station`);
    const afterBreak = await expectOk(r, "GET /api/station (post ads break)");
    if (!Array.isArray(afterBreak.queue) || afterBreak.queue.length < 2) {
      fail("cola debería crecer tras ads/break (pista + spot)");
    }
    console.log("[smoke] B3 schedule apply-active + ads/break OK");

    // B4: skip poda lo sonado; AutoDJ refill deja buffer tras agotar cola corta
    r = await fetch(`${base}/api/station/queue-from-playlist`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ playlistId: playlist.id, replace: true }),
    });
    const beforeSkip = await expectOk(r, "POST /api/station/queue-from-playlist (B4 reset)");
    if (!Array.isArray(beforeSkip.queue) || beforeSkip.queue.length < 1) {
      fail("B4: cola vacía antes de skip");
    }

    r = await fetch(`${base}/api/playlists/${playlist.id}/items`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: uploaded.id }),
    });
    await expectOk(r, "POST /api/playlists/.../items (2ª para B4)");

    r = await fetch(`${base}/api/station/queue-from-playlist`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ playlistId: playlist.id, replace: true }),
    });
    const twoTrack = await expectOk(r, "POST /api/station/queue-from-playlist (B4 2 pistas)");
    if (!Array.isArray(twoTrack.queue) || twoTrack.queue.length < 2) {
      fail(`B4: esperaba ≥2 en cola, got ${twoTrack.queue?.length}`);
    }
    const q0 = twoTrack.queue[0].id;
    const q1 = twoTrack.queue[1].id;

    r = await fetch(`${base}/api/station/skip`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: "{}",
    });
    const afterSkip = await expectOk(r, "POST /api/station/skip");
    if (!Array.isArray(afterSkip.queue) || afterSkip.queue.length < 1) {
      fail("B4: cola vacía tras skip (debería quedar siguiente + refill)");
    }
    if (afterSkip.queue.some((it) => it.id === q0)) {
      fail("B4: el ítem al aire no se podó tras skip");
    }
    if (afterSkip.queue[0]?.id !== q1) {
      fail(`B4: esperaba id=${q1} al aire tras skip, got ${afterSkip.queue[0]?.id}`);
    }
    // AutoDJ (min default 4): upcoming tras skip con 1 restante → need ≥3 extras; cola ≥ 4
    if (afterSkip.queue.length < 4) {
      fail(`B4: AutoDJ refill corto: cola=${afterSkip.queue.length} (min esperado 4)`);
    }
    console.log(
      `[smoke] B4 skip + AutoDJ refill OK (cola=${afterSkip.queue.length}, al aire=${afterSkip.queue[0]?.id})`,
    );
  } else {
    console.log("[smoke] (omitido flujo profundo; SMOKE_PROMOTE_TO_EDITOR=1 para upload/playlist/cola/B3/B4)");
  }

  console.log("[smoke] OK", base);
}

await main();

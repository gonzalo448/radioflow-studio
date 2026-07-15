/**
 * Humo C5 cart wall contra API local.
 * Uso: node scripts/smoke-cart.mjs
 * Env: SMOKE_API_URL, SMOKE_EMAIL, SMOKE_PASSWORD
 */
const base = (process.env.SMOKE_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const email = process.env.SMOKE_EMAIL ?? "studio@radioflow.local";
const password = process.env.SMOKE_PASSWORD ?? "Radioflow_local_dev_1";

function fail(msg) {
  console.error("[cart-smoke]", msg);
  process.exit(1);
}

async function expectOk(r, what) {
  const text = await r.text();
  if (!r.ok) fail(`${what} → ${r.status}: ${text.slice(0, 400)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    fail(`${what}: no JSON`);
  }
}

async function main() {
  let r = await fetch(`${base}/api/health`);
  await expectOk(r, "health");

  r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const login = await expectOk(r, "login");
  const token = login.accessToken;
  if (!token) fail("login sin accessToken");
  const auth = { Authorization: `Bearer ${token}` };

  const fd = new FormData();
  fd.append(
    "file",
    new Blob([Uint8Array.of(0xff, 0xf3, 0x14, 0xc4, 0x00)], { type: "audio/mpeg" }),
    "cart-smoke-min.mp3",
  );
  r = await fetch(`${base}/api/library/upload`, { method: "POST", headers: auth, body: fd });
  const uploaded = await expectOk(r, "upload");
  if (!uploaded?.id) fail("upload sin id");
  console.log("[cart-smoke] uploaded", uploaded.id);

  r = await fetch(`${base}/api/jingles/slots`, {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ pageKey: "A", slots: { "1": uploaded.id } }),
  });
  const slots = await expectOk(r, "PUT jingles/slots");
  if (slots["1"]?.assetId !== uploaded.id) fail("slot 1 no asignado");

  r = await fetch(`${base}/api/jingles/fire`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ slotKey: "1", pageKey: "A", playNow: true }),
  });
  const fired = await expectOk(r, "POST jingles/fire playNow");
  if (!fired.ok || fired.assetId !== uploaded.id) fail("fire playNow respuesta");
  if (fired.playNow === true) {
    console.log("[cart-smoke] playNow OK →", fired.label);
  } else if (fired.playNow === undefined) {
    console.warn(
      "[cart-smoke] WARN: API sin campo playNow (build anterior a C5). Fire OK; redeploy para validar skip inmediato.",
    );
  } else {
    fail(`playNow esperado true, got ${fired.playNow}`);
  }

  r = await fetch(`${base}/api/station`, { headers: auth });
  const st = await expectOk(r, "GET station");
  const blob = JSON.stringify(st);
  if (!blob.includes(uploaded.id)) fail("asset no aparece en estado de estación tras playNow");
  console.log(
    "[cart-smoke] station pos=",
    st.station?.currentPosition,
    "queueLen=",
    Array.isArray(st.queue) ? st.queue.length : "?",
  );

  r = await fetch(`${base}/api/jingles/fire`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ slotKey: "1", pageKey: "A", playNext: true }),
  });
  const soft = await expectOk(r, "POST jingles/fire playNext");
  if (soft.playNow === false) {
    console.log("[cart-smoke] playNext (RB-084) OK");
  } else if (soft.playNow === undefined) {
    console.warn("[cart-smoke] WARN: playNext sin playNow en respuesta (API pre-C5)");
  } else {
    fail(`playNext debe devolver playNow=false, got ${soft.playNow}`);
  }

  r = await fetch(`${base}/api/jingles/fire`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ slotKey: "9", pageKey: "A", playNow: true }),
  });
  const empty = await r.text();
  if (r.status !== 400) fail(`slot vacío: esperaba 400, ${r.status}: ${empty.slice(0, 200)}`);
  console.log("[cart-smoke] slot vacío → 400 OK");

  console.log("[cart-smoke] PASS");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));

/**
 * Deja listo Icecast + pista al aire + encoder (dev local).
 * Uso: node scripts/ensure-broadcast-dev.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = process.env.SMOKE_API_URL ?? "http://127.0.0.1:4000";
const icecastPort = process.env.RADIOFLOW_ICECAST_PUBLISH_PORT ?? "8840";
const loginEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "studio@radioflow.local";
const loginPass = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "Radioflow_local_dev_1";
const mediaDir = path.join(root, "apps", "api", "data", "media");
const uploadsDir = path.join(mediaDir, "uploads");
const testMp3 = "radioflow-test-tone.mp3";
const testPath = `uploads/${testMp3}`;

function fail(msg) {
  console.error("[broadcast]", msg);
  process.exit(1);
}

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: r.ok, status: r.status, data };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true, ...opts });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

async function main() {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const absMp3 = path.join(uploadsDir, testMp3);
  if (!fs.existsSync(absMp3)) {
    console.log("[broadcast] Generando MP3 de prueba…");
    await run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=120",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      absMp3,
    ]);
  }

  console.log("[broadcast] Reiniciando Icecast (puerto host", icecastPort, ")…");
  await run("docker", ["compose", "stop", "icecast-hold"], { cwd: root }).catch(() => {});
  await run("docker", ["compose", "--profile", "broadcast", "up", "-d", "icecast"], {
    cwd: root,
    env: { ...process.env, RADIOFLOW_ICECAST_PUBLISH_PORT: icecastPort },
  });
  await run("docker", ["compose", "stop", "encoder"], { cwd: root }).catch(() => {});
  await run("docker", ["compose", "--profile", "broadcast", "restart", "icecast"], {
    cwd: root,
    env: { ...process.env, RADIOFLOW_ICECAST_PUBLISH_PORT: icecastPort },
  });
  await new Promise((r) => setTimeout(r, 12_000));

  const login = await fetchJson(`${api}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: loginEmail, password: loginPass }),
  });
  if (!login.ok) fail(`login → ${login.status}: ${JSON.stringify(login.data)}`);
  const token = login.data.token;

  let assetId = null;
  const lib = await fetchJson(`${api}/api/library/assets`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (lib.ok && Array.isArray(lib.data) && lib.data.length > 0) {
    assetId = lib.data[0].id;
    const existing = lib.data[0].path;
    if (existing !== testPath) {
      const dstName = path.basename(existing);
      const dst = path.join(uploadsDir, dstName);
      if (!fs.existsSync(dst)) fs.copyFileSync(absMp3, dst);
    }
  } else {
    const up = await fetchJson(`${api}/api/library/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: (() => {
        const fd = new FormData();
        const blob = new Blob([fs.readFileSync(absMp3)], { type: "audio/mpeg" });
        fd.append("file", blob, testMp3);
        fd.append("title", "Radioflow test tone");
        return fd;
      })(),
    });
    if (!up.ok) fail(`upload → ${up.status}: ${JSON.stringify(up.data)}`);
    assetId = up.data.id;
  }

  await fetchJson(`${api}/api/station/queue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ assetId }),
  });

  const st = await fetchJson(`${api}/api/station`);
  if (!st.data?.nowPlaying) {
    await fetchJson(`${api}/api/station`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPosition: 0 }),
    });
  }

  console.log("[broadcast] Levantando encoder en Docker (con token para heartbeat / metadatos)…");
  await run("docker", ["compose", "stop", "icecast-hold"], { cwd: root }).catch(() => {});
  await run("docker", ["compose", "--profile", "broadcast", "up", "-d", "--no-deps", "encoder"], {
    cwd: root,
    env: {
      ...process.env,
      RADIOFLOW_ICECAST_PUBLISH_PORT: icecastPort,
      RADIOFLOW_TOKEN: token,
    },
  });
  console.log("[broadcast] Stream:", `http://127.0.0.1:${icecastPort}/stream`);
  console.log("[broadcast] Logs encoder: docker compose logs -f encoder");
}

main().catch((e) => fail(e.message));

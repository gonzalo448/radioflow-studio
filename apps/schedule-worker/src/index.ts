/**
 * Worker de parrilla: si la estación tiene autoScheduleEnabled, vigila los bloques activos
 * (GET /api/schedule/today-hints) y vuelca la playlist del bloque ganador en la cola (HTTP POST).
 *
 * Requiere un token con permiso de estación (dj / editor / admin).
 * La API persiste `lastAppliedScheduleBlockId` para sobrevivir a reinicios del worker.
 */

const API = process.env.RADIOFLOW_API_URL ?? "http://127.0.0.1:4000";
const TOKEN = process.env.RADIOFLOW_TOKEN ?? "";
const POLL_MS = Number(process.env.SCHEDULE_POLL_MS ?? "20000");
/** Si true, reemplaza toda la cola al cambiar de bloque (típico en radio por hora). */
const REPLACE_QUEUE = process.env.SCHEDULE_REPLACE_QUEUE !== "0";

type StationPayload = {
  station: { autoScheduleEnabled?: boolean; lastAppliedScheduleBlockId?: string | null };
};
type Block = {
  id: string;
  playlistId: string | null;
  priority: number;
  startMinute: number;
  label: string;
};
type Hints = { active: Block[] };

function log(msg: string, extra?: unknown) {
  const t = new Date().toISOString();
  if (extra !== undefined) console.log(`[${t}] [schedule-worker]`, msg, extra);
  else console.log(`[${t}] [schedule-worker]`, msg);
}

function authHeaders(): Record<string, string> {
  if (!TOKEN) {
    throw new Error("Define RADIOFLOW_TOKEN (usuario dj+ o service account)");
  }
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

function pickWinningBlock(active: Block[]): Block | null {
  const withPl = active.filter((b) => b.playlistId);
  if (withPl.length === 0) return null;
  withPl.sort((a, b) => b.priority - a.priority || a.startMinute - b.startMinute);
  return withPl[0]!;
}

async function fetchStation(): Promise<StationPayload> {
  const r = await fetch(`${API}/api/station`);
  if (!r.ok) throw new Error(`GET /api/station → ${r.status}`);
  return r.json() as Promise<StationPayload>;
}

async function fetchHints(): Promise<Hints> {
  const r = await fetch(`${API}/api/schedule/today-hints`);
  if (!r.ok) throw new Error(`GET /api/schedule/today-hints → ${r.status}`);
  return r.json() as Promise<Hints>;
}

async function applyPlaylist(playlistId: string, scheduleBlockId: string) {
  const r = await fetch(`${API}/api/station/queue-from-playlist`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ playlistId, replace: REPLACE_QUEUE, scheduleBlockId }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`queue-from-playlist ${r.status}: ${err.slice(0, 300)}`);
  }
}

async function tick() {
  const stationRes = await fetchStation();
  const station = stationRes.station;
  if (!station?.autoScheduleEnabled) {
    return;
  }

  if (!TOKEN) {
    log("autoScheduleEnabled=true pero RADIOFLOW_TOKEN vacío; no puedo aplicar playlist.");
    return;
  }

  const hints = await fetchHints();
  const active = hints.active ?? [];
  const winner = pickWinningBlock(active);

  if (!winner?.playlistId) {
    return;
  }

  const persisted = station.lastAppliedScheduleBlockId ?? null;
  if (winner.id === persisted) {
    return;
  }

  log(`Aplicando bloque "${winner.label}" → playlist ${winner.playlistId}`, { replace: REPLACE_QUEUE });
  await applyPlaylist(winner.playlistId, winner.id);
}

log(
  `API=${API} · poll=${POLL_MS}ms · replaceQueue=${REPLACE_QUEUE} · aplicación con token=${Boolean(TOKEN)}`,
);

const run = () => {
  void tick().catch((e) => console.error("[schedule-worker]", e));
};
run();
setInterval(run, POLL_MS);

import crypto from "node:crypto";
import { createClient } from "redis";

export type RedisState = "disabled" | "connected" | "down";

type RedisClient = ReturnType<typeof createClient>;

const WS_BROADCAST_CHANNEL = "radioflow:station:broadcast";

let client: RedisClient | null = null;
let subscriber: RedisClient | null = null;
let state: RedisState = "disabled";
let instanceId = "";
let stationRelayHandler: ((payload: unknown) => void) | null = null;

export function getRedisState(): RedisState {
  return state;
}

export function getRedis(): RedisClient | null {
  return client;
}

export function getRedisInstanceId(): string {
  return instanceId;
}

/** Registra handler para mensajes WS reenviados desde otras réplicas API. */
export function setStationWsRelayHandler(handler: (payload: unknown) => void): void {
  stationRelayHandler = handler;
}

/** Publica estado de estación a otras réplicas (P2-05). */
export async function publishStationBroadcast(payload: unknown): Promise<boolean> {
  const c = client;
  if (!c?.isOpen || state !== "connected") return false;
  try {
    await c.publish(WS_BROADCAST_CHANNEL, JSON.stringify({ origin: instanceId, payload }));
    return true;
  } catch {
    return false;
  }
}

/** Inicializa el cliente si hay URL; errores de conexión dejan estado `down` (fallback en memoria para rate-limit). */
export async function initRedis(url: string | undefined, originId?: string): Promise<void> {
  instanceId = originId?.trim() || crypto.randomUUID();

  if (!url) {
    state = "disabled";
    client = null;
    subscriber = null;
    return;
  }

  try {
    const c = createClient({ url });
    c.on("error", () => {
      state = "down";
    });
    await c.connect();
    client = c;
    state = "connected";

    const sub = createClient({ url });
    sub.on("error", () => {
      /* subscriber down — fan-out local sigue funcionando */
    });
    await sub.connect();
    await sub.subscribe(WS_BROADCAST_CHANNEL, (message) => {
      try {
        const parsed = JSON.parse(message) as { origin?: string; payload?: unknown };
        if (!parsed.payload || parsed.origin === instanceId) return;
        stationRelayHandler?.(parsed.payload);
      } catch {
        // ignore malformed
      }
    });
    subscriber = sub;
  } catch (err) {
    console.error("[redis] no se pudo conectar:", err);
    client = null;
    subscriber = null;
    state = "down";
  }
}

export async function closeRedis(): Promise<void> {
  const sub = subscriber;
  const c = client;
  subscriber = null;
  client = null;
  state = state === "disabled" ? "disabled" : "down";
  if (sub) {
    try {
      if (sub.isOpen) await sub.quit();
    } catch {
      // best-effort
    }
  }
  if (!c) return;
  try {
    if (c.isOpen) await c.quit();
  } catch {
    // best-effort
  }
}

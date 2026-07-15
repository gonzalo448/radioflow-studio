import type { Env } from "../config.js";
import { getRedis } from "./redis.js";

/** Reutiliza el PING entre `/health` y `/health/ready` y ante ráfagas de probes (p. ej. balanceadores). */
const PROBE_CACHE_TTL_MS = 1500;

export type RedisPingStatus = "disabled" | "ok" | "down";

let probeCache: { expiresAt: number; status: RedisPingStatus } | null = null;

async function redisPingUncached(env: Env): Promise<RedisPingStatus> {
  if (!env.REDIS_URL) return "disabled";
  const client = getRedis();
  if (!client?.isOpen) return "down";
  try {
    const pong = await client.ping();
    return pong === "PONG" ? "ok" : "down";
  } catch {
    return "down";
  }
}

/** PING con caché en memoria del proceso (solo aplica si hay `REDIS_URL`). */
export async function redisReadyProbe(env: Env): Promise<RedisPingStatus> {
  if (!env.REDIS_URL) return "disabled";
  const now = Date.now();
  if (probeCache && now < probeCache.expiresAt) {
    return probeCache.status;
  }
  const status = await redisPingUncached(env);
  probeCache = { expiresAt: now + PROBE_CACHE_TTL_MS, status };
  return status;
}

export function redisDegraded(env: Env, redis: RedisPingStatus): boolean {
  return Boolean(env.REDIS_URL && redis === "down");
}

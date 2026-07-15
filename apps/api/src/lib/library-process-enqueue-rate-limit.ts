import type { Env } from "../config.js";
import { getRedis, getRedisState } from "./redis.js";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export type LibraryEnqueueRateOutcome =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

function isLightProcessKind(kind: string): boolean {
  return kind === "sync_metadata" || kind === "pgvector_backfill";
}

function userBucketMax(env: Env, kind: string): number {
  return isLightProcessKind(kind) ? env.LIBRARY_PROCESS_ENQUEUE_LIGHT_KIND_MAX_PER_MIN : env.LIBRARY_PROCESS_ENQUEUE_MAX_PER_MIN;
}

function memoryConsume(key: string, max: number, windowSec: number): LibraryEnqueueRateOutcome {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  let b = memoryBuckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    memoryBuckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

function memoryRollback(key: string): void {
  const b = memoryBuckets.get(key);
  if (b && b.count > 0) b.count -= 1;
}

function sanitizeIpForKey(ip: string): string {
  const t = ip.trim().slice(0, 64);
  return t.length > 0 ? t.replace(/[^\d.a-fA-F:.%_\-]/g, "_") : "unknown";
}

async function redisTtlSeconds(redis: NonNullable<ReturnType<typeof getRedis>>, key: string, fallback: number): Promise<number> {
  try {
    const ttl = await redis.ttl(key);
    return ttl > 0 ? ttl : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Consume slots de encolado: tope por usuario (más alto para `bpm_detect`) y tope global por IP.
 * Si el segundo control falla, revierte el primero (Redis DECR o memoria).
 */
export async function consumeLibraryProcessEnqueueBudget(
  env: Env,
  userId: string,
  clientIp: string,
  kind: string,
): Promise<LibraryEnqueueRateOutcome> {
  const windowSec = env.LIBRARY_PROCESS_ENQUEUE_WINDOW_SEC;
  const maxUser = userBucketMax(env, kind);
  const maxIp = env.LIBRARY_PROCESS_ENQUEUE_IP_MAX_PER_MIN;
  const userKey = `library:process:enqueue:user:${userId}:kind:${isLightProcessKind(kind) ? "light" : "heavy"}`;
  const ipKey = `library:process:enqueue:ip:${sanitizeIpForKey(clientIp)}`;
  const redis = getRedis();

  if (redis?.isOpen && getRedisState() === "connected") {
    try {
      const nUser = await redis.incr(userKey);
      if (nUser === 1) await redis.expire(userKey, windowSec);
      if (nUser > maxUser) {
        await redis.decr(userKey);
        return { ok: false, retryAfterSec: await redisTtlSeconds(redis, userKey, windowSec) };
      }
      const nIp = await redis.incr(ipKey);
      if (nIp === 1) await redis.expire(ipKey, windowSec);
      if (nIp > maxIp) {
        await redis.decr(userKey);
        await redis.decr(ipKey);
        return { ok: false, retryAfterSec: await redisTtlSeconds(redis, ipKey, windowSec) };
      }
      return { ok: true };
    } catch {
      // degradar a memoria
    }
  }

  const u = memoryConsume(userKey, maxUser, windowSec);
  if (!u.ok) return u;
  const i = memoryConsume(ipKey, maxIp, windowSec);
  if (!i.ok) {
    memoryRollback(userKey);
    return i;
  }
  return { ok: true };
}

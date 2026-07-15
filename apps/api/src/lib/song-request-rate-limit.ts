import type { Env } from "../config.js";
import { getRedis, getRedisState } from "./redis.js";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export type SongRequestRateOutcome =
  | { ok: true; remaining: number; resetSec: number }
  | { ok: false; retryAfterSec: number };

function sanitizeIpForKey(ip: string): string {
  const t = ip.trim().slice(0, 64);
  return t.length > 0 ? t.replace(/[^\d.a-fA-F:.%_\-]/g, "_") : "unknown";
}

function memoryConsume(key: string, max: number, windowSec: number): SongRequestRateOutcome {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  let b = memoryBuckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    memoryBuckets.set(key, b);
  }
  b.count += 1;
  const resetSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  if (b.count > max) {
    return { ok: false, retryAfterSec: resetSec };
  }
  return { ok: true, remaining: Math.max(0, max - b.count), resetSec };
}

/** Límite de POST públicos `/api/requests` por IP (Redis si está disponible). */
export async function consumeSongRequestSubmitBudget(
  env: Env,
  clientIp: string,
): Promise<SongRequestRateOutcome> {
  const max = env.SONG_REQUEST_MAX_PER_WINDOW;
  const windowSec = env.SONG_REQUEST_WINDOW_SEC;
  const key = `songrequest:submit:ip:${sanitizeIpForKey(clientIp)}`;
  const redis = getRedis();

  if (redis?.isOpen && getRedisState() === "connected") {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
      const ttl = await redis.ttl(key);
      const resetSec = ttl > 0 ? ttl : windowSec;
      if (count > max) {
        return { ok: false, retryAfterSec: resetSec };
      }
      return { ok: true, remaining: Math.max(0, max - count), resetSec };
    } catch {
      /* memoria */
    }
  }

  return memoryConsume(key, max, windowSec);
}

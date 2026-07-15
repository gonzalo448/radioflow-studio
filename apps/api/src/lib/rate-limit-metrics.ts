import type { AuthRateLimitScope } from "./rate-limit.js";
import { getRedis } from "./redis.js";

type Outcome = "allowed" | "blocked";
type Backend = "redis" | "memory";

const KEY_PREFIX = "metrics:ratelimit:auth";
const KEY_TTL_SEC = 60 * 60; // 1h
const DEFAULT_WINDOW_MINUTES = 15;
const MAX_WINDOW_MINUTES = 60;

function minuteBucket(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

function keyFor(bucket: string, scope: AuthRateLimitScope, backend: Backend, outcome: Outcome): string {
  return `${KEY_PREFIX}:${bucket}:${scope}:${backend}:${outcome}`;
}

export function recordAuthRateLimitMetric(
  scope: AuthRateLimitScope,
  backend: Backend,
  outcome: Outcome,
): void {
  const redis = getRedis();
  if (!redis?.isOpen) return;
  const bucket = minuteBucket(Date.now());
  const key = keyFor(bucket, scope, backend, outcome);
  void redis
    .multi()
    .incrBy(key, 1)
    .expire(key, KEY_TTL_SEC)
    .exec()
    .catch(() => {});
}

export async function readAuthRateLimitMetrics(
  windowMinutes: number = DEFAULT_WINDOW_MINUTES,
): Promise<
  | {
      windowMinutes: number;
      totals: Record<
        AuthRateLimitScope,
        {
          redis: { allowed: number; blocked: number };
          memory: { allowed: number; blocked: number };
        }
      >;
    }
  | null
> {
  const redis = getRedis();
  if (!redis?.isOpen) return null;

  const w = Math.max(1, Math.min(MAX_WINDOW_MINUTES, Math.floor(windowMinutes)));

  const scopes: AuthRateLimitScope[] = ["login", "register"];
  const totals: Record<
    AuthRateLimitScope,
    {
      redis: { allowed: number; blocked: number };
      memory: { allowed: number; blocked: number };
    }
  > = {
    login: { redis: { allowed: 0, blocked: 0 }, memory: { allowed: 0, blocked: 0 } },
    register: { redis: { allowed: 0, blocked: 0 }, memory: { allowed: 0, blocked: 0 } },
  };

  const now = Date.now();
  const buckets: string[] = [];
  for (let i = 0; i < w; i++) {
    buckets.push(minuteBucket(now - i * 60_000));
  }

  const keys: string[] = [];
  for (const b of buckets) {
    for (const s of scopes) {
      keys.push(keyFor(b, s, "redis", "allowed"));
      keys.push(keyFor(b, s, "redis", "blocked"));
      keys.push(keyFor(b, s, "memory", "allowed"));
      keys.push(keyFor(b, s, "memory", "blocked"));
    }
  }

  const values = await redis.mGet(keys);
  let idx = 0;
  for (const _b of buckets) {
    for (const s of scopes) {
      const ra = Number(values[idx++] ?? 0);
      const rb = Number(values[idx++] ?? 0);
      const ma = Number(values[idx++] ?? 0);
      const mb = Number(values[idx++] ?? 0);
      totals[s].redis.allowed += Number.isFinite(ra) ? ra : 0;
      totals[s].redis.blocked += Number.isFinite(rb) ? rb : 0;
      totals[s].memory.allowed += Number.isFinite(ma) ? ma : 0;
      totals[s].memory.blocked += Number.isFinite(mb) ? mb : 0;
    }
  }

  return { windowMinutes: w, totals };
}


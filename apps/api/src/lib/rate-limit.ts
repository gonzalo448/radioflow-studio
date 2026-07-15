import type { FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../config.js";
import { getRedis } from "./redis.js";
import { recordAuthRateLimitMetric } from "./rate-limit-metrics.js";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 10_000;
const MAX_BUCKETS = 20_000;

function sweepMemoryBuckets(now: number): void {
  if (now - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
  if (memoryBuckets.size > MAX_BUCKETS) {
    // Protección ante abuso/malas IPs: mejor perder estado que filtrar memoria.
    memoryBuckets.clear();
  }
}

export function getAuthRateLimitMemoryBucketCount(): number {
  return memoryBuckets.size;
}

export interface AuthRateLimitOutcome {
  allowed: boolean;
  remaining: number;
  /** Segundos hasta reinicio de la ventana (RateLimit-Reset / coherente con Retry-After en 429). */
  resetSec: number;
  retryAfterSec?: number;
}

export type AuthRateLimitScope = "login" | "register";

type AuthStats = {
  redis: { allowed: number; blocked: number };
  memory: { allowed: number; blocked: number };
  scopes: Record<AuthRateLimitScope, { allowed: number; blocked: number }>;
};

const authStats: AuthStats = {
  redis: { allowed: 0, blocked: 0 },
  memory: { allowed: 0, blocked: 0 },
  scopes: {
    login: { allowed: 0, blocked: 0 },
    register: { allowed: 0, blocked: 0 },
  },
};

export function getAuthRateLimitStats() {
  return {
    backend: {
      redis: { ...authStats.redis },
      memory: { ...authStats.memory },
    },
    scopes: {
      login: { ...authStats.scopes.login },
      register: { ...authStats.scopes.register },
    },
    memoryBuckets: memoryBuckets.size,
  };
}

export function applyAuthRateLimitHeaders(
  reply: FastifyReply,
  env: Env,
  rl: AuthRateLimitOutcome,
): void {
  reply.header("RateLimit-Limit", String(env.RATE_LIMIT_AUTH_MAX));
  reply.header("RateLimit-Remaining", String(Math.max(0, rl.remaining)));
  reply.header("RateLimit-Reset", String(rl.resetSec));
}

export function getClientIp(request: FastifyRequest): string {
  const xf = request.headers["x-forwarded-for"];
  if (typeof xf === "string") {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(xf) && xf[0]) {
    const first = xf[0].split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip || "unknown";
}

function authKey(ip: string): string {
  return `ratelimit:auth:${ip}`;
}

function authKeyScoped(ip: string, scope: AuthRateLimitScope): string {
  return `ratelimit:auth:${scope}:${ip}`;
}

export async function allowAuthAttempt(
  ip: string,
  env: Env,
  scope: AuthRateLimitScope,
): Promise<AuthRateLimitOutcome> {
  const max = env.RATE_LIMIT_AUTH_MAX;
  const windowSec = env.RATE_LIMIT_AUTH_WINDOW_SEC;

  const redis = getRedis();
  if (redis?.isOpen) {
    const key = authKeyScoped(ip, scope);
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
      if (count > max) {
        const ttl = await redis.ttl(key);
        const retry = ttl > 0 ? ttl : windowSec;
        authStats.redis.blocked += 1;
        authStats.scopes[scope].blocked += 1;
        recordAuthRateLimitMetric(scope, "redis", "blocked");
        return {
          allowed: false,
          remaining: 0,
          resetSec: retry,
          retryAfterSec: retry,
        };
      }
      const ttl = await redis.ttl(key);
      const resetSec = ttl > 0 ? ttl : windowSec;
      authStats.redis.allowed += 1;
      authStats.scopes[scope].allowed += 1;
      recordAuthRateLimitMetric(scope, "redis", "allowed");
      return { allowed: true, remaining: Math.max(0, max - count), resetSec };
    } catch {
      /* Redis falló en mitad de petición → memoria */
    }
  }

  const now = Date.now();
  sweepMemoryBuckets(now);
  const windowMs = windowSec * 1000;
  const memKey = `${scope}:${ip}`;
  let b = memoryBuckets.get(memKey);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    memoryBuckets.set(memKey, b);
  }
  b.count += 1;
  if (b.count > max) {
    const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    authStats.memory.blocked += 1;
    authStats.scopes[scope].blocked += 1;
    recordAuthRateLimitMetric(scope, "memory", "blocked");
    return {
      allowed: false,
      remaining: 0,
      resetSec: retry,
      retryAfterSec: retry,
    };
  }
  const resetSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  authStats.memory.allowed += 1;
  authStats.scopes[scope].allowed += 1;
  recordAuthRateLimitMetric(scope, "memory", "allowed");
  return { allowed: true, remaining: Math.max(0, max - b.count), resetSec };
}

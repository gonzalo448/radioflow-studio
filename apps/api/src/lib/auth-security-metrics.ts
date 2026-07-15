import { getRedis } from "./redis.js";

const KEY_PREFIX = "metrics:auth:refresh_reuse";
const KEY_TTL_SEC = 60 * 60;
const MAX_WINDOW_MINUTES = 60;
const DEFAULT_WINDOW_MINUTES = 60;

let localReuseDetections = 0;

function minuteBucket(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

function keyFor(bucket: string): string {
  return `${KEY_PREFIX}:${bucket}`;
}

export function recordRefreshReuseDetection(): void {
  localReuseDetections += 1;
  const redis = getRedis();
  if (!redis?.isOpen) return;
  const bucket = minuteBucket(Date.now());
  const key = keyFor(bucket);
  void redis
    .multi()
    .incrBy(key, 1)
    .expire(key, KEY_TTL_SEC)
    .exec()
    .catch(() => {});
}

export function getLocalRefreshReuseDetections(): number {
  return localReuseDetections;
}

export async function readRefreshReuseDetections(windowMinutes: number = DEFAULT_WINDOW_MINUTES): Promise<
  | {
      windowMinutes: number;
      total: number;
    }
  | null
> {
  const redis = getRedis();
  if (!redis?.isOpen) return null;
  const w = Math.max(1, Math.min(MAX_WINDOW_MINUTES, Math.floor(windowMinutes)));
  const now = Date.now();
  const buckets: string[] = [];
  for (let i = 0; i < w; i++) buckets.push(minuteBucket(now - i * 60_000));
  const keys = buckets.map(keyFor);
  const values = await redis.mGet(keys);
  let total = 0;
  for (const v of values) {
    const n = Number(v ?? 0);
    total += Number.isFinite(n) ? n : 0;
  }
  return { windowMinutes: w, total };
}


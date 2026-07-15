import { getRedis } from "./redis.js";

const KEY_PREFIX = "metrics:ops";
const KEY_TTL_SEC = 60 * 60;
const MAX_WINDOW_MINUTES = 60;
const DEFAULT_WINDOW_MINUTES = 60;

let localRevocations = 0;

function minuteBucket(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 16);
}

function keyFor(bucket: string, metric: string): string {
  return `${KEY_PREFIX}:${bucket}:${metric}`;
}

export function recordOpsRevocation(): void {
  localRevocations += 1;
  const redis = getRedis();
  if (!redis?.isOpen) return;
  const bucket = minuteBucket(Date.now());
  const key = keyFor(bucket, "revoke_refresh_chain");
  void redis
    .multi()
    .incrBy(key, 1)
    .expire(key, KEY_TTL_SEC)
    .exec()
    .catch(() => {});
}

export function getLocalOpsRevocations(): number {
  return localRevocations;
}

export async function readOpsRevocations(windowMinutes: number = DEFAULT_WINDOW_MINUTES): Promise<
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
  const keys: string[] = [];
  for (let i = 0; i < w; i++) {
    const bucket = minuteBucket(now - i * 60_000);
    keys.push(keyFor(bucket, "revoke_refresh_chain"));
  }
  const values = await redis.mGet(keys);
  let total = 0;
  for (const v of values) {
    const n = Number(v ?? 0);
    total += Number.isFinite(n) ? n : 0;
  }
  return { windowMinutes: w, total };
}


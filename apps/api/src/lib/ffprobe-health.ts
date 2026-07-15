import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Env } from "../config.js";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60_000;

type CacheEntry = { until: number; reachable: boolean; detail: string };

let cache: { key: string; entry: CacheEntry } | null = null;

function cacheKey(env: Env): string {
  return env.FFPROBE_PATH;
}

/**
 * Si `AUDIO_FFPROBE_ENABLED`, ejecuta `ffprobe -version` (resultado cacheado ~1 min).
 * Si ffprobe está desactivado, no ejecuta nada (`reachable: null`).
 * @param opts.bypassCache — omitir entrada en caché (p. ej. tras `?refresh=1` solo admin).
 */
export async function getFfprobeReachability(
  env: Env,
  opts?: { bypassCache?: boolean },
): Promise<{
  reachable: boolean | null;
  detail: string | null;
}> {
  if (!env.AUDIO_FFPROBE_ENABLED) {
    return { reachable: null, detail: null };
  }
  const key = cacheKey(env);
  const now = Date.now();
  const bypass = opts?.bypassCache === true;
  if (bypass) {
    cache = null;
  } else if (cache && cache.key === key && now < cache.entry.until) {
    return { reachable: cache.entry.reachable, detail: cache.entry.detail };
  }
  try {
    const { stdout } = await execFileAsync(env.FFPROBE_PATH, ["-version"], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    const first = String(stdout).split(/\r?\n/)[0]?.trim() ?? "";
    const detail = first.length > 0 ? first.slice(0, 240) : "ffprobe respondió";
    const entry: CacheEntry = { until: now + CACHE_TTL_MS, reachable: true, detail };
    cache = { key, entry };
    return { reachable: true, detail };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const detail = msg.slice(0, 240);
    const entry: CacheEntry = { until: now + CACHE_TTL_MS, reachable: false, detail };
    cache = { key, entry };
    return { reachable: false, detail };
  }
}

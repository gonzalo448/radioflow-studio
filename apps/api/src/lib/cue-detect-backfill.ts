import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { isSqliteDatabaseUrl } from "./db-dialect.js";
import { getFfmpegReachability } from "./ffmpeg-health.js";
import { detectAndPersistTrackCues } from "./detect-track-cues.js";

export async function countAssetsMissingCues(): Promise<number> {
  return prisma.mediaAsset.count({
    where: {
      OR: [{ cueStartSec: null }, { cueEndSec: null }],
      NOT: [
        { genre: "time-announce" },
        { path: { startsWith: "uploads/time-announce/" } },
        { genre: "station-intro" },
        { path: { startsWith: "uploads/station-intro/" } },
      ],
    },
  });
}

/**
 * Procesa un lote de pistas sin Cue Start/End (importaciones antiguas).
 * Pensado para corridas periódicas con 10k+ pistas: avanza solo un poco cada tick.
 */
export async function runCueDetectBackfillBatch(
  env: Env,
  opts?: { batchSize?: number },
): Promise<{ scanned: number; updated: number; failed: number; remaining: number }> {
  if (!env.AUDIO_FFMPEG_ENABLED) {
    return { scanned: 0, updated: 0, failed: 0, remaining: await countAssetsMissingCues() };
  }
  const ff = await getFfmpegReachability(env);
  if (ff.reachable !== true) {
    return { scanned: 0, updated: 0, failed: 0, remaining: await countAssetsMissingCues() };
  }

  const batchSize = Math.min(Math.max(opts?.batchSize ?? env.CUE_DETECT_BACKFILL_BATCH_SIZE, 1), 25);
  const station = await prisma.station.findUnique({
    where: { id: "main" },
    select: { cabSilenceThresholdDb: true },
  });
  const silenceThresholdDb =
    station?.cabSilenceThresholdDb != null && Number.isFinite(station.cabSilenceThresholdDb)
      ? station.cabSilenceThresholdDb
      : -40;

  const assets = await prisma.mediaAsset.findMany({
    where: {
      OR: [{ cueStartSec: null }, { cueEndSec: null }],
      NOT: [
        { genre: "time-announce" },
        { path: { startsWith: "uploads/time-announce/" } },
        { genre: "station-intro" },
        { path: { startsWith: "uploads/station-intro/" } },
      ],
    },
    select: {
      id: true,
      path: true,
      durationSec: true,
      cueStartSec: true,
      cueEndSec: true,
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  let updated = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      const cues = await detectAndPersistTrackCues(prisma, env, asset, {
        force: true,
        fallbackOnFailure: true,
        noiseDb: silenceThresholdDb,
        timeoutMs: Math.min(env.LIBRARY_PROCESS_FFMPEG_TIMEOUT_MS, 90_000),
      });
      if (cues) updated += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  const remaining = await countAssetsMissingCues();
  return { scanned: assets.length, updated, failed, remaining };
}

let cueBackfillBusy = false;

/** Tick periódico: un lote por llamada; evita solaparse. */
export async function runCueDetectBackfillTick(env: Env): Promise<void> {
  if (!env.CUE_DETECT_BACKFILL_ENABLED) return;
  if (!env.AUDIO_FFMPEG_ENABLED) return;
  if (cueBackfillBusy) return;
  cueBackfillBusy = true;
  try {
    const run = async () => {
      const pending = await countAssetsMissingCues();
      if (pending === 0) return;
      const result = await runCueDetectBackfillBatch(env);
      if (result.scanned > 0) {
        console.info(
          `[radioflow] cue backfill: lote ${result.scanned} · ok ${result.updated} · fail ${result.failed} · quedan ${result.remaining}`,
        );
      }
    };

    if (isSqliteDatabaseUrl()) {
      await run();
      return;
    }

    const lockId = 915_000_088;
    const got = await prisma.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(${lockId}) AS locked`;
    if (!got?.[0]?.locked) return;
    try {
      await run();
    } finally {
      await prisma.$executeRaw`SELECT pg_advisory_unlock(${lockId})`;
    }
  } finally {
    cueBackfillBusy = false;
  }
}

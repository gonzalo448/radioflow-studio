import type { LibraryProcessJob } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { runBpmDetectBatchForAssets } from "./library-bpm-batch.js";
import { getFfmpegReachability } from "./ffmpeg-health.js";
import { runLoudnessBatchForAssets } from "./library-loudness-batch.js";
import {
  runTranscodeMp3BatchForAssets,
  runTrimSilenceBatchForAssets,
} from "./library-process-trim-transcode.js";
import { runTimeStretchBatchForAssets } from "./library-time-stretch.js";
import { renderPlaylistToFile } from "./playlist-render.js";
import {
  countAssetsForMetadataSync,
  runSyncMetadataBatchForAssets,
  runSyncMetadataForLibrary,
} from "./library-metadata-sync-batch.js";
import { runSemanticEnrichBatchForAssets } from "./library-semantic-enrich-batch.js";
import { runPgVectorBackfillBatch, countAssetsForPgVectorBackfill } from "./pgvector-backfill-batch.js";
import {
  bpmDetectJobPayloadSchema,
  loudnessJobPayloadSchema,
  playlistRenderJobPayloadSchema,
  syncMetadataJobPayloadSchema,
  semanticEnrichJobPayloadSchema,
  pgvectorBackfillJobPayloadSchema,
  transcodeMp3JobPayloadSchema,
  trimSilenceJobPayloadSchema,
  trimSilenceJobPolicySchema,
  transcodeMp3JobPolicySchema,
  timeStretchJobPayloadSchema,
  timeStretchJobPolicySchema,
} from "./library-process-job-payloads.js";

function isPostgresDatabaseUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

async function claimNextLibraryProcessJobSqlite(): Promise<LibraryProcessJob | null> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.libraryProcessJob.findFirst({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    if (!job) return null;
    await tx.libraryProcessJob.update({
      where: { id: job.id },
      data: { status: "running", startedAt: new Date() },
    });
    return job;
  });
}

/** Claim atómico con `SKIP LOCKED` (varios workers Postgres). SQLite sigue en modo findFirst+update. */
async function claimNextLibraryProcessJobPostgres(): Promise<LibraryProcessJob | null> {
  const rows = await prisma.$queryRaw<LibraryProcessJob[]>(Prisma.sql`
    WITH picked AS (
      SELECT "id"
      FROM "LibraryProcessJob"
      WHERE "status" = 'pending'::"LibraryProcessJobStatus"
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "LibraryProcessJob" AS j
    SET
      "status" = 'running'::"LibraryProcessJobStatus",
      "startedAt" = NOW()
    FROM picked
    WHERE j."id" = picked."id"
    RETURNING j.*;
  `);
  const job = rows[0];
  return job ?? null;
}

export async function claimNextLibraryProcessJob(env: Env): Promise<LibraryProcessJob | null> {
  if (isPostgresDatabaseUrl(env.DATABASE_URL)) {
    try {
      return await claimNextLibraryProcessJobPostgres();
    } catch (err) {
      console.error("[library-process-job] claim Postgres falló, usando SQLite-style:", err);
      return claimNextLibraryProcessJobSqlite();
    }
  }
  return claimNextLibraryProcessJobSqlite();
}

export async function executeLibraryProcessJob(job: LibraryProcessJob, env: Env): Promise<void> {
  if (job.kind === "loudness_batch") {
    const parsed = loudnessJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para loudness_batch",
          finishedAt: new Date(),
        },
      });
      return;
    }
    if (!env.AUDIO_FFMPEG_ENABLED) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "AUDIO_FFMPEG_ENABLED=0",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const ff = await getFfmpegReachability(env);
    if (ff.reachable !== true) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: ff.detail ?? "ffmpeg no disponible",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const { assetIds, targetLufs, apply } = parsed.data;
    const dryRun = !apply;
    await prisma.libraryProcessJob.update({
      where: { id: job.id },
      data: { progressTotal: assetIds.length, progressCurrent: 0 },
    });
    try {
      const result = await runLoudnessBatchForAssets(prisma, env, {
        assetIds,
        targetLufs,
        dryRun,
        onProgress: async ({ done, total, rows }) => {
          await prisma.libraryProcessJob.update({
            where: { id: job.id },
            data: {
              progressCurrent: done,
              progressTotal: total,
              result: rows as unknown as Prisma.InputJsonValue,
            },
          });
        },
      });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
          progressCurrent: assetIds.length,
          progressTotal: assetIds.length,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
    return;
  }

  if (job.kind === "bpm_detect") {
    const parsed = bpmDetectJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para bpm_detect",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const { assetIds, policy } = parsed.data;
    const preferEmbeddedTags = policy?.preferEmbeddedTags !== false;
    const analyzeAudio = policy?.analyzeAudio !== false;
    const timeoutMs = policy?.timeoutMsPerAsset ?? env.LIBRARY_PROCESS_FFMPEG_TIMEOUT_MS;
    await prisma.libraryProcessJob.update({
      where: { id: job.id },
      data: { progressTotal: assetIds.length, progressCurrent: 0 },
    });
    try {
      const result = await runBpmDetectBatchForAssets(prisma, env, {
        assetIds,
        preferEmbeddedTags,
        analyzeAudio,
        timeoutMsPerAsset: timeoutMs,
        onProgress: async ({ done, total, rows }) => {
          await prisma.libraryProcessJob.update({
            where: { id: job.id },
            data: {
              progressCurrent: done,
              progressTotal: total,
              result: { kind: "bpm_detect" as const, rows } as unknown as Prisma.InputJsonValue,
            },
          });
        },
      });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
          progressCurrent: assetIds.length,
          progressTotal: assetIds.length,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
    return;
  }

  if (job.kind === "trim_silence") {
    const parsed = trimSilenceJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para trim_silence",
          finishedAt: new Date(),
        },
      });
      return;
    }
    if (!env.AUDIO_FFMPEG_ENABLED) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "AUDIO_FFMPEG_ENABLED=0",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const ff = await getFfmpegReachability(env);
    if (ff.reachable !== true) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: ff.detail ?? "ffmpeg no disponible",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const policy = trimSilenceJobPolicySchema.parse({ ...(parsed.data.policy ?? {}) });
    const { assetIds, apply } = parsed.data;
    const timeoutMs = policy.timeoutMsPerAsset ?? env.LIBRARY_PROCESS_FFMPEG_TIMEOUT_MS;
    await prisma.libraryProcessJob.update({
      where: { id: job.id },
      data: { progressTotal: assetIds.length, progressCurrent: 0 },
    });
    try {
      const result = await runTrimSilenceBatchForAssets(prisma, env, {
        assetIds,
        apply,
        noiseDb: policy.noiseDb,
        minSilenceSec: policy.minSilenceSec,
        timeoutMsPerAsset: timeoutMs,
        ffmpegPath: env.FFMPEG_PATH,
        onProgress: async ({ done, total, rows }) => {
          await prisma.libraryProcessJob.update({
            where: { id: job.id },
            data: {
              progressCurrent: done,
              progressTotal: total,
              result: { kind: "trim_silence" as const, apply, policy, rows } as unknown as Prisma.InputJsonValue,
            },
          });
        },
      });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
          progressCurrent: assetIds.length,
          progressTotal: assetIds.length,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
    return;
  }

  if (job.kind === "transcode_mp3") {
    const parsed = transcodeMp3JobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para transcode_mp3",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const { assetIds, apply } = parsed.data;
    if (apply) {
      if (!env.AUDIO_FFMPEG_ENABLED) {
        await prisma.libraryProcessJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            error: "AUDIO_FFMPEG_ENABLED=0",
            finishedAt: new Date(),
          },
        });
        return;
      }
      const ff = await getFfmpegReachability(env);
      if (ff.reachable !== true) {
        await prisma.libraryProcessJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            error: ff.detail ?? "ffmpeg no disponible",
            finishedAt: new Date(),
          },
        });
        return;
      }
    }
    const policy = transcodeMp3JobPolicySchema.parse({ ...(parsed.data.policy ?? {}) });
    const timeoutMs = policy.timeoutMsPerAsset ?? env.LIBRARY_PROCESS_FFMPEG_TIMEOUT_MS;
    await prisma.libraryProcessJob.update({
      where: { id: job.id },
      data: { progressTotal: assetIds.length, progressCurrent: 0 },
    });
    try {
      const result = await runTranscodeMp3BatchForAssets(prisma, env, {
        assetIds,
        apply,
        bitrateKbps: policy.bitrateKbps,
        preserveMetadata: policy.preserveMetadata,
        timeoutMsPerAsset: timeoutMs,
        ffmpegPath: env.FFMPEG_PATH,
        onProgress: async ({ done, total, rows }) => {
          await prisma.libraryProcessJob.update({
            where: { id: job.id },
            data: {
              progressCurrent: done,
              progressTotal: total,
              result: { kind: "transcode_mp3" as const, apply, policy, rows } as unknown as Prisma.InputJsonValue,
            },
          });
        },
      });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
          progressCurrent: assetIds.length,
          progressTotal: assetIds.length,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
    return;
  }

  if (job.kind === "time_stretch") {
    const parsed = timeStretchJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para time_stretch",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const policy = timeStretchJobPolicySchema.parse({ ...(parsed.data.policy ?? {}) });
    const { assetIds, apply } = parsed.data;
    if (apply) {
      if (!env.AUDIO_FFMPEG_ENABLED) {
        await prisma.libraryProcessJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            error: "AUDIO_FFMPEG_ENABLED=0",
            finishedAt: new Date(),
          },
        });
        return;
      }
      const ff = await getFfmpegReachability(env);
      if (ff.reachable !== true) {
        await prisma.libraryProcessJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            error: ff.detail ?? "ffmpeg no disponible",
            finishedAt: new Date(),
          },
        });
        return;
      }
    }
    const timeoutMs = policy.timeoutMsPerAsset ?? env.LIBRARY_PROCESS_FFMPEG_TIMEOUT_MS;
    await prisma.libraryProcessJob.update({
      where: { id: job.id },
      data: { progressTotal: assetIds.length, progressCurrent: 0 },
    });
    try {
      const result = await runTimeStretchBatchForAssets(prisma, env, {
        assetIds,
        apply,
        tempoRatio: policy.tempoRatio,
        timeoutMsPerAsset: timeoutMs,
        ffmpegPath: env.FFMPEG_PATH,
        onProgress: async ({ done, total, rows }) => {
          await prisma.libraryProcessJob.update({
            where: { id: job.id },
            data: {
              progressCurrent: done,
              progressTotal: total,
              result: {
                kind: "time_stretch" as const,
                apply,
                tempoRatio: policy.tempoRatio,
                rows,
              } as unknown as Prisma.InputJsonValue,
            },
          });
        },
      });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
          progressCurrent: assetIds.length,
          progressTotal: assetIds.length,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
    return;
  }

  if (job.kind === "sync_metadata") {
    const parsed = syncMetadataJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para sync_metadata",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const { mode, assetIds, filters } = parsed.data;
    const progressTotal =
      mode === "asset_ids"
        ? (assetIds?.length ?? 0)
        : await countAssetsForMetadataSync(prisma, filters ?? {});
    await prisma.libraryProcessJob.update({
      where: { id: job.id },
      data: { progressTotal, progressCurrent: 0 },
    });
    const onProgress = async (p: {
      done: number;
      total: number;
      updated: number;
      failures: number;
      recentFailures: { assetId: string; title: string; error: string }[];
    }) => {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          progressCurrent: p.done,
          progressTotal: p.total,
          result: {
            kind: "sync_metadata" as const,
            updated: p.updated,
            failures: p.failures,
            total: p.total,
            recentFailures: p.recentFailures,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    };
    try {
      const result =
        mode === "asset_ids"
          ? await runSyncMetadataBatchForAssets(prisma, env, {
              assetIds: assetIds ?? [],
              onProgress,
            })
          : await runSyncMetadataForLibrary(prisma, env, {
              filters: filters ?? {},
              onProgress,
            });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
          progressCurrent: result.total,
          progressTotal: result.total,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
    return;
  }

  if (job.kind === "semantic_enrich") {
    const parsed = semanticEnrichJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para semantic_enrich",
          finishedAt: new Date(),
        },
      });
      return;
    }
    if (!env.OLLAMA_BASE_URL) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "OLLAMA_BASE_URL no configurada",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const { assetIds, policy } = parsed.data;
    await prisma.libraryProcessJob.update({
      where: { id: job.id },
      data: { progressTotal: assetIds.length, progressCurrent: 0 },
    });
    try {
      const result = await runSemanticEnrichBatchForAssets(prisma, env, {
        assetIds,
        skipIfEmbedded: policy?.skipIfEmbedded,
        onProgress: async ({ done, total, rows }) => {
          await prisma.libraryProcessJob.update({
            where: { id: job.id },
            data: {
              progressCurrent: done,
              progressTotal: total,
              result: { kind: "semantic_enrich" as const, rows } as unknown as Prisma.InputJsonValue,
            },
          });
        },
      });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
          progressCurrent: assetIds.length,
          progressTotal: assetIds.length,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
    return;
  }

  if (job.kind === "pgvector_backfill") {
    const parsed = pgvectorBackfillJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para pgvector_backfill",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const { assetIds, limit } = parsed.data;
    const progressTotal = assetIds?.length ?? (await countAssetsForPgVectorBackfill(prisma));
    await prisma.libraryProcessJob.update({
      where: { id: job.id },
      data: { progressTotal, progressCurrent: 0 },
    });
    try {
      const result = await runPgVectorBackfillBatch(prisma, {
        assetIds,
        limit,
        onProgress: async ({ done, total, updated, skipped, failed, rows }) => {
          await prisma.libraryProcessJob.update({
            where: { id: job.id },
            data: {
              progressCurrent: done,
              progressTotal: total,
              result: {
                kind: "pgvector_backfill" as const,
                updated,
                skipped,
                failed,
                rows,
              } as unknown as Prisma.InputJsonValue,
            },
          });
        },
      });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
          progressCurrent: result.total,
          progressTotal: result.total,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
    return;
  }

  if (job.kind === "playlist_render") {
    const parsed = playlistRenderJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: "Payload inválido para playlist_render",
          finishedAt: new Date(),
        },
      });
      return;
    }
    if (!env.AUDIO_FFMPEG_ENABLED) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: { status: "failed", error: "AUDIO_FFMPEG_ENABLED=0", finishedAt: new Date() },
      });
      return;
    }
    const ff = await getFfmpegReachability(env);
    if (ff.reachable !== true) {
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: ff.detail ?? "ffmpeg no disponible",
          finishedAt: new Date(),
        },
      });
      return;
    }
    try {
      const result = await renderPlaylistToFile({
        playlistId: parsed.data.playlistId,
        format: parsed.data.format,
        env,
      });
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          progressCurrent: result.trackCount,
          progressTotal: result.trackCount,
          result: {
            kind: "playlist_render" as const,
            relPath: result.relPath,
            format: parsed.data.format,
            trackCount: result.trackCount,
            durationSec: result.durationSec,
          } as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.libraryProcessJob.update({
        where: { id: job.id },
        data: { status: "failed", error: msg.slice(0, 2000), finishedAt: new Date() },
      });
    }
    return;
  }

  await prisma.libraryProcessJob.update({
    where: { id: job.id },
    data: {
      status: "failed",
      error: `Kind no implementado: ${job.kind}`,
      finishedAt: new Date(),
    },
  });
}

import type { FastifyPluginAsync } from "fastify";
import type { ApiHealth, ApiHealthMeta, ApiReadiness } from "@radioflow/shared";
import type { Env } from "../config.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import { getRedisState } from "../lib/redis.js";
import { redisDegraded, redisReadyProbe } from "../lib/redis-readiness.js";
import { getAuthRateLimitMemoryBucketCount } from "../lib/rate-limit.js";
import { resolveScheduleApplyMode } from "../lib/schedule-apply-mode.js";

const healthOkSchema = {
  tags: ["health"] as string[],
  summary: "Estado rápido del proceso",
  description: "No consulta la base de datos. Útil para balanceadores.",
  response: {
    200: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "degraded"] },
        version: { type: "string" },
        uptimeSeconds: { type: "number" },
      },
    },
  },
} as const;

const healthReadySchema = {
  tags: ["health"] as string[],
  summary: "Readiness (incluye PostgreSQL)",
  response: {
    200: {
      type: "object",
      properties: {
        ready: { type: "boolean" },
        database: { type: "string", enum: ["ok", "down"] },
        redis: { type: "string" },
        degraded: { type: "boolean" },
        version: { type: "string" },
      },
    },
    503: {
      type: "object",
      properties: {
        ready: { type: "boolean" },
        database: { type: "string" },
      },
    },
  },
} as const;

const healthMetaSchema = {
  tags: ["health"] as string[],
  summary: "Metadatos de configuración en runtime",
  response: {
    200: {
      type: "object",
      additionalProperties: true,
    },
  },
} as const;

export const healthRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.get<{ Reply: ApiHealth }>("/health", { schema: healthOkSchema }, async () => {
    const redis = await redisReadyProbe(opts.env);
    const degraded = redisDegraded(opts.env, redis);
    return {
      status: degraded ? "degraded" : "ok",
      version: "0.1.0",
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  app.get<{ Reply: ApiReadiness }>("/health/ready", { schema: healthReadySchema }, async (_request, reply) => {
    let database: "ok" | "down" = "ok";
    let schemaOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.mediaAsset.findFirst({ select: { id: true, releaseYear: true } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2022") {
        database = "ok";
        schemaOk = false;
      } else {
        database = "down";
      }
    }
    const redis = await redisReadyProbe(opts.env);
    const degraded = redisDegraded(opts.env, redis);
    const body: ApiReadiness = {
      ready: database === "ok" && schemaOk,
      database,
      redis,
      degraded,
      version: "0.1.0",
    };
    if (!body.ready) {
      return reply.code(503).send({
        ...body,
        ...(schemaOk ? {} : { error: "Esquema desactualizado. Ejecute: npm run db:migrate" }),
      });
    }
    return body;
  });

  app.get<{ Reply: ApiHealthMeta }>("/health/meta", { schema: healthMetaSchema }, async () => {
    const configuredPoll = opts.env.INTERNAL_SCHEDULE_POLL_MS;
    const resolved = resolveScheduleApplyMode({
      scheduleApplyMode: opts.env.SCHEDULE_APPLY_MODE,
      internalSchedulePollMs: configuredPoll,
      scheduleWorkerExpected: opts.env.SCHEDULE_WORKER_EXPECTED === true,
    });
    const settings = await getOrCreateSettings();
    let activeTargetEnabled = false;
    if (settings.activeStreamingTargetId) {
      const t = await prisma.streamingTarget.findUnique({
        where: { id: settings.activeStreamingTargetId },
        select: { enabled: true },
      });
      activeTargetEnabled = Boolean(t?.enabled);
    }
    return {
      internalSchedulePollMs: resolved.effectiveInternalPollMs,
      internalSchedulerActive: resolved.effectiveInternalPollMs > 0,
      scheduleReplaceQueue: opts.env.SCHEDULE_REPLACE_QUEUE,
      redis: getRedisState(),
      rateLimitAuth: {
        max: opts.env.RATE_LIMIT_AUTH_MAX,
        windowSec: opts.env.RATE_LIMIT_AUTH_WINDOW_SEC,
        memoryBuckets: getAuthRateLimitMemoryBucketCount(),
      },
      streamingEncoder: {
        activeStreamingTargetId: settings.activeStreamingTargetId,
        activeTargetEnabled,
      },
      background: {
        mode: opts.env.API_BACKGROUND_MODE,
        libraryProcessWorker:
          opts.env.API_BACKGROUND_MODE === "maintenance" || opts.env.API_BACKGROUND_MODE === "full",
        libraryProcessWorkerPollMs: opts.env.LIBRARY_PROCESS_WORKER_POLL_MS,
        cueDetectBackfill:
          (opts.env.API_BACKGROUND_MODE === "maintenance" || opts.env.API_BACKGROUND_MODE === "full") &&
          opts.env.CUE_DETECT_BACKFILL_ENABLED &&
          opts.env.CUE_DETECT_BACKFILL_POLL_MS > 0,
        audioFfmpeg: opts.env.AUDIO_FFMPEG_ENABLED,
        audioFfprobe: opts.env.AUDIO_FFPROBE_ENABLED,
        embeddedStandalone: Boolean(opts.env.EMBEDDED_STANDALONE),
      },
      schedule: {
        applyMode: resolved.mode,
        configuredApplyMode: opts.env.SCHEDULE_APPLY_MODE,
        internalPollMsEffective: resolved.effectiveInternalPollMs,
        internalPollMsConfigured: configuredPoll,
        workerExpected: opts.env.SCHEDULE_WORKER_EXPECTED === true,
        conflictResolved: resolved.conflictResolved,
        liquidsoapM3uPollMs: opts.env.LIQUIDSOAP_M3U_POLL_MS,
      },
    };
  });
};
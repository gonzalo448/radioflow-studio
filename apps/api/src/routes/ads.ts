import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  ApiAdBreakLogRow,
  ApiAdBreakResult,
  ApiAdSchedulerConfig,
  ApiAdSchedulerConfigPatchBody,
  ApiAdSpotRow,
  ApiError,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE, ROLES_STATION_WRITE } from "../lib/auth.js";
import { adBreakPayloadSchema, adSchedulerConfigPatchSchema } from "../lib/ad-scheduler-body.js";
import {
  ensureAdSchedulerConfig,
  listAdSpots,
  playAdBreak,
  toApiAdConfig,
} from "../services/ad-scheduler.js";

export const adsRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiAdSchedulerConfig }>("/ads/config", async () => {
    const row = await ensureAdSchedulerConfig();
    return toApiAdConfig(row);
  });

  app.patch<{ Body: ApiAdSchedulerConfigPatchBody; Reply: ApiAdSchedulerConfig | ApiError }>(
    "/ads/config",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const body = adSchedulerConfigPatchSchema.parse(request.body ?? {});
      await ensureAdSchedulerConfig();
      const row = await prisma.adSchedulerConfig.update({
        where: { id: "main" },
        data: body,
      });
      return toApiAdConfig(row);
    },
  );

  app.get<{ Querystring: { pathPrefix?: string }; Reply: ApiAdSpotRow[] }>(
    "/ads/spots",
    async (request) => {
      const q = z.object({ pathPrefix: z.string().optional() }).parse(request.query);
      const config = await ensureAdSchedulerConfig();
      const prefix = q.pathPrefix ?? config.pathPrefix;
      return listAdSpots(prefix, opts.env);
    },
  );

  app.post<{ Body: unknown; Reply: ApiAdBreakResult | ApiError }>("/ads/break", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    const body = adBreakPayloadSchema.parse(request.body ?? {});
    try {
      const result = await playAdBreak({
        env: opts.env,
        source: "manual",
        spotCount: body.spotCount,
        pathPrefix: body.pathPrefix,
      });
      return {
        ok: true,
        assetIds: result.assetIds,
        insertedCount: result.insertedCount,
        source: "manual",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo insertar el bloque";
      return reply.status(400).send({ error: msg });
    }
  });

  app.get<{ Reply: ApiAdBreakLogRow[] }>("/ads/logs", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const rows = await prisma.adBreakLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    return rows.map((r) => ({
      id: r.id,
      stationId: r.stationId,
      assetIds: Array.isArray(r.assetIds) ? (r.assetIds as string[]) : [],
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    }));
  });
};

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiError } from "@radioflow/shared";
import type { Env } from "../config.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";
import { playStationIntroNow } from "../lib/station-intro-play.js";

const playBody = z.object({
  afterCurrent: z.boolean().optional(),
  sourceAbs: z.string().min(1).max(1024).optional(),
});

export type ApiStationIntroPlayResult = {
  ok: boolean;
  inserted: number;
  fileName?: string;
  assetId?: string;
  deferred?: boolean;
  error?: string;
};

export const stationIntroRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.post<{ Body: unknown; Reply: ApiStationIntroPlayResult | ApiError }>(
    "/station-intro/play",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const parsed = playBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "JSON inválido: { afterCurrent?: boolean, sourceAbs?: string }" });
      }
      const result = await playStationIntroNow(opts.env, {
        afterCurrent: parsed.data.afterCurrent !== false,
        sourceAbs: parsed.data.sourceAbs,
      });
      if (!result.ok) {
        return reply.status(400).send(result);
      }
      return result;
    },
  );
};

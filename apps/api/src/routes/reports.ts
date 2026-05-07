import type { FastifyPluginAsync } from "fastify";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_REPORTS_READ } from "../lib/auth.js";

export const reportsRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/reports/play-log", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_REPORTS_READ)) return;
    const limit = Math.min(
      500,
      Math.max(1, Number((request.query as { limit?: string })?.limit ?? "120")),
    );
    return prisma.playLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        asset: { select: { id: true, title: true, artist: true } },
      },
    });
  });
};

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";
import { getOrCreateSettings } from "../services/app-settings.js";

const patchSettings = z.object({
  stationName: z.string().min(1).optional(),
  tagline: z.string().nullable().optional(),
  primaryColor: z.string().min(1).nullable().optional(),
  logoUrl: z.string().max(2048).nullable().optional(),
});

export const settingsRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/settings", async () => {
    return getOrCreateSettings();
  });

  app.patch("/settings", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const body = patchSettings.parse(request.body);
    return prisma.appSettings.upsert({
      where: { id: "global" },
      create: {
        id: "global",
        stationName: body.stationName ?? "RadioFlow Studio",
        tagline: body.tagline ?? undefined,
        primaryColor: body.primaryColor ?? "#38bdf8",
        logoUrl: body.logoUrl ?? undefined,
      },
      update: body,
    });
  });
};

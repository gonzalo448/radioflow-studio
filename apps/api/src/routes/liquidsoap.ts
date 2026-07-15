import type { FastifyPluginAsync } from "fastify";
import type { Env } from "../config.js";
import { optionalAuth, requireRoles } from "../lib/auth.js";
import {
  buildStationQueueM3uBody,
  regenerateAllLiquidsoapM3u,
} from "../lib/liquidsoap-m3u-generator.js";

/** Endpoints Liquidsoap externos — legacy / opt-in (RF-007). Path por defecto = encoder→Icecast. */
export const liquidsoapRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  /** Cola de cabina en vivo (sin auth; uso en red interna / docker). */
  app.get("/liquidsoap/station-queue.m3u", async (_request, reply) => {
    const body = await buildStationQueueM3uBody(opts.env);
    return reply.type("audio/x-mpegurl").header("Cache-Control", "no-store").send(body);
  });

  app.post("/liquidsoap/regenerate", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin", "editor"])) return;
    const result = await regenerateAllLiquidsoapM3u(opts.env);
    return result;
  });
};

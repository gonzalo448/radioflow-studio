import type { FastifyPluginAsync } from "fastify";
import type { ApiHealth, ApiReadiness } from "@radioflow/shared";
import { prisma } from "../db.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: ApiHealth }>("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get<{ Reply: ApiReadiness }>("/health/ready", async (_request, reply) => {
    let database: "ok" | "down" = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }
    const body: ApiReadiness = {
      ready: database === "ok",
      database,
      version: "0.1.0",
    };
    if (!body.ready) return reply.code(503).send(body);
    return body;
  });
};

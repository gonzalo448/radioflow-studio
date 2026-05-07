import type { FastifyPluginAsync } from "fastify";
import type { ApiHealth } from "@radioflow/shared";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: ApiHealth }>("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    uptimeSeconds: Math.round(process.uptime()),
  }));
};

import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { optionalAuth } from "../lib/auth.js";

export const usersRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/users/me", async (request, reply) => {
    if (!request.userId) return reply.status(401).send({ error: "No autorizado" });
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
    });
    if (!user) return reply.status(404).send({ error: "Usuario no encontrado" });
    return user;
  });

  /** Listado básico para panel admin (Fase 7 ampliará roles) */
  app.get("/users", async (request, reply) => {
    if (!request.userId) return reply.status(401).send({ error: "No autorizado" });
    const me = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!me || me.role !== "admin") return reply.status(403).send({ error: "Prohibido" });
    return prisma.user.findMany({
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
};

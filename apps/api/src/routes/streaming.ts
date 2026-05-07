import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_STREAMING_WRITE } from "../lib/auth.js";

const targetBody = z.object({
  name: z.string().min(1),
  protocol: z.enum(["icecast", "shoutcast", "azuracast"]),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(8000),
  mountPath: z.string().default("/stream"),
  sourceUser: z.string().nullable().optional(),
  sourcePassword: z.string().min(1),
  publicBaseUrl: z.string().max(2048).nullable().optional(),
  tls: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

const patchBody = targetBody
  .partial()
  .extend({
    sourcePassword: z.string().min(1).optional(),
  });

function sanitize(t: {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  mountPath: string;
  sourceUser: string | null;
  sourcePassword: string;
  publicBaseUrl: string | null;
  tls: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { sourcePassword, ...rest } = t;
  return { ...rest, hasSourcePassword: sourcePassword.length > 0 };
}

export const streamingRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/streaming/targets", async () => {
    const rows = await prisma.streamingTarget.findMany({ orderBy: { name: "asc" } });
    return rows.map(sanitize);
  });

  app.get("/streaming/targets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.streamingTarget.findUnique({ where: { id } });
    if (!row) return reply.status(404).send({ error: "Destino no encontrado" });
    return sanitize(row);
  });

  app.post("/streaming/targets", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    const body = targetBody.parse(request.body);
    const row = await prisma.streamingTarget.create({ data: body });
    return reply.status(201).send(sanitize(row));
  });

  app.patch("/streaming/targets/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = patchBody.parse(request.body);
    try {
      const row = await prisma.streamingTarget.update({
        where: { id },
        data: {
          ...body,
        },
      });
      return sanitize(row);
    } catch {
      return reply.status(404).send({ error: "Destino no encontrado" });
    }
  });

  app.delete("/streaming/targets/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    const { id } = request.params as { id: string };
    try {
      await prisma.streamingTarget.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Destino no encontrado" });
    }
  });
};

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";

const blockBody = z.object({
  label: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  playlistId: z.string().nullable().optional(),
  priority: z.number().int().default(0),
});

const patchBlock = blockBody.partial();

export const scheduleRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/schedule", async () => {
    return prisma.scheduleBlock.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }, { priority: "desc" }],
      include: { playlist: { select: { id: true, name: true } } },
    });
  });

  app.get("/schedule/today-hints", async () => {
    const now = new Date();
    const day = now.getDay();
    const startMinute = now.getHours() * 60 + now.getMinutes();
    const blocks = await prisma.scheduleBlock.findMany({
      where: { dayOfWeek: day },
      orderBy: { startMinute: "asc" },
      include: { playlist: { select: { id: true, name: true } } },
    });
    const active = blocks.filter((b) => startMinute >= b.startMinute && startMinute < b.endMinute);
    return { dayOfWeek: day, minuteNow: startMinute, blocks, active };
  });

  app.post("/schedule", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const body = blockBody.parse(request.body);
    if (body.endMinute <= body.startMinute) {
      return reply.status(400).send({ error: "endMinute debe ser mayor que startMinute" });
    }
    if (body.playlistId) {
      const pl = await prisma.playlist.findUnique({ where: { id: body.playlistId } });
      if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
    }
    const block = await prisma.scheduleBlock.create({
      data: {
        label: body.label,
        dayOfWeek: body.dayOfWeek,
        startMinute: body.startMinute,
        endMinute: body.endMinute,
        playlistId: body.playlistId ?? null,
        priority: body.priority,
      },
      include: { playlist: { select: { id: true, name: true } } },
    });
    return reply.status(201).send(block);
  });

  app.patch("/schedule/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = patchBlock.parse(request.body);
    if (body.startMinute !== undefined && body.endMinute !== undefined && body.endMinute <= body.startMinute) {
      return reply.status(400).send({ error: "endMinute debe ser mayor que startMinute" });
    }
    try {
      const block = await prisma.scheduleBlock.update({
        where: { id },
        data: body,
        include: { playlist: { select: { id: true, name: true } } },
      });
      return block;
    } catch {
      return reply.status(404).send({ error: "Bloque no encontrado" });
    }
  });

  app.delete("/schedule/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    try {
      await prisma.scheduleBlock.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Bloque no encontrado" });
    }
  });
};

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_STATION_WRITE } from "../lib/auth.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { ensureMainStation, getStationState, MAIN_STATION_ID } from "../services/station-state.js";

const patchStation = z.object({
  mode: z.enum(["AUTO", "LIVE_ASSIST", "LIVE"]).optional(),
  currentPosition: z.number().int().min(0).optional(),
  liveTitle: z.string().nullable().optional(),
});

const appendBody = z.object({
  assetId: z.string().min(1),
});

export const stationRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/station", async () => getStationState());

  app.post("/station/queue", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    await ensureMainStation();
    const body = appendBody.parse(request.body);
    const asset = await prisma.mediaAsset.findUnique({ where: { id: body.assetId } });
    if (!asset) return reply.status(404).send({ error: "Medio no encontrado" });

    const last = await prisma.playQueueItem.findFirst({
      where: { stationId: MAIN_STATION_ID },
      orderBy: { position: "desc" },
    });
    const position = (last?.position ?? -1) + 1;
    const item = await prisma.playQueueItem.create({
      data: { stationId: MAIN_STATION_ID, assetId: body.assetId, position },
      include: { asset: true },
    });
    void broadcastStationState();
    return reply.status(201).send(item);
  });

  app.delete("/station/queue/:itemId", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    await ensureMainStation();
    const { itemId } = request.params as { itemId: string };
    const existing = await prisma.playQueueItem.findFirst({
      where: { id: itemId, stationId: MAIN_STATION_ID },
    });
    if (!existing) return reply.status(404).send({ error: "Ítem no encontrado" });

    await prisma.$transaction(async (tx) => {
      const queueBefore = await tx.playQueueItem.findMany({
        where: { stationId: MAIN_STATION_ID },
        orderBy: { position: "asc" },
      });
      const removedIndex = queueBefore.findIndex((q) => q.id === itemId);
      if (removedIndex === -1) return;
      await tx.playQueueItem.delete({ where: { id: itemId } });
      const queueAfter = queueBefore.filter((q) => q.id !== itemId);
      for (let i = 0; i < queueAfter.length; i++) {
        await tx.playQueueItem.update({ where: { id: queueAfter[i].id }, data: { position: i } });
      }
      const station = await tx.station.findUniqueOrThrow({ where: { id: MAIN_STATION_ID } });
      let pos = station.currentPosition;
      if (removedIndex < pos) pos -= 1;
      if (removedIndex === pos && queueAfter.length === 0) pos = 0;
      if (pos >= queueAfter.length) pos = Math.max(0, queueAfter.length - 1);
      await tx.station.update({ where: { id: MAIN_STATION_ID }, data: { currentPosition: pos } });
    });
    void broadcastStationState();
    return reply.status(204).send();
  });

  app.patch("/station", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    await ensureMainStation();
    const body = patchStation.parse(request.body);
    const station = await prisma.station.update({
      where: { id: MAIN_STATION_ID },
      data: {
        ...(body.mode && { mode: body.mode }),
        ...(body.currentPosition !== undefined && { currentPosition: body.currentPosition }),
        ...(body.liveTitle !== undefined && { liveTitle: body.liveTitle }),
      },
    });
    void broadcastStationState();
    return station;
  });

  app.post("/station/skip", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    await ensureMainStation();
    const count = await prisma.playQueueItem.count({ where: { stationId: MAIN_STATION_ID } });
    const station = await prisma.station.findUniqueOrThrow({ where: { id: MAIN_STATION_ID } });
    const next = Math.min(station.currentPosition + 1, Math.max(0, count - 1));
    const updated = await prisma.station.update({
      where: { id: MAIN_STATION_ID },
      data: { currentPosition: next },
    });
    void broadcastStationState();
    return updated;
  });
};

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";

const createPlaylist = z.object({
  name: z.string().min(1),
});

const addItem = z.object({
  assetId: z.string().min(1),
});

const rename = z.object({
  name: z.string().min(1),
});

const reorderBody = z.object({
  orderedItemIds: z.array(z.string()),
});

export const playlistRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/playlists", async () => {
    return prisma.playlist.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { items: true } } },
    });
  });

  app.get("/playlists/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const pl = await prisma.playlist.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: "asc" }, include: { asset: true } },
      },
    });
    if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
    return pl;
  });

  app.post("/playlists", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const body = createPlaylist.parse(request.body);
    const pl = await prisma.playlist.create({ data: { name: body.name } });
    return reply.status(201).send(pl);
  });

  app.patch("/playlists/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = rename.parse(request.body);
    try {
      return await prisma.playlist.update({ where: { id }, data: { name: body.name } });
    } catch {
      return reply.status(404).send({ error: "Playlist no encontrada" });
    }
  });

  app.delete("/playlists/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    try {
      await prisma.playlist.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Playlist no encontrada" });
    }
  });

  app.post("/playlists/:id/items", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = addItem.parse(request.body);
    const pl = await prisma.playlist.findUnique({ where: { id } });
    if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
    const asset = await prisma.mediaAsset.findUnique({ where: { id: body.assetId } });
    if (!asset) return reply.status(404).send({ error: "Medio no encontrado" });
    const last = await prisma.playlistItem.findFirst({
      where: { playlistId: id },
      orderBy: { position: "desc" },
    });
    const position = (last?.position ?? -1) + 1;
    const item = await prisma.playlistItem.create({
      data: { playlistId: id, assetId: body.assetId, position },
      include: { asset: true },
    });
    return reply.status(201).send(item);
  });

  app.delete("/playlists/:id/items/:itemId", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id, itemId } = request.params as { id: string; itemId: string };
    const existing = await prisma.playlistItem.findFirst({
      where: { id: itemId, playlistId: id },
    });
    if (!existing) return reply.status(404).send({ error: "Ítem no encontrado" });
    await prisma.$transaction(async (tx) => {
      await tx.playlistItem.delete({ where: { id: itemId } });
      const rest = await tx.playlistItem.findMany({
        where: { playlistId: id },
        orderBy: { position: "asc" },
      });
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].position !== i) {
          await tx.playlistItem.update({ where: { id: rest[i].id }, data: { position: i } });
        }
      }
    });
    return reply.status(204).send();
  });

  app.put("/playlists/:id/items/reorder", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = reorderBody.parse(request.body);
    const pl = await prisma.playlist.findUnique({ where: { id } });
    if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
    const items = await prisma.playlistItem.findMany({ where: { playlistId: id } });
    if (items.length !== body.orderedItemIds.length) {
      return reply.status(400).send({ error: "Lista de ids incompleta" });
    }
    const set = new Set(items.map((i) => i.id));
    for (const oid of body.orderedItemIds) {
      if (!set.has(oid)) return reply.status(400).send({ error: "Id inválido en orden" });
    }
    await prisma.$transaction(
      body.orderedItemIds.map((itemId, index) =>
        prisma.playlistItem.update({
          where: { id: itemId },
          data: { position: index },
        }),
      ),
    );
    const full = await prisma.playlist.findUnique({
      where: { id },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
    return full;
  });
};

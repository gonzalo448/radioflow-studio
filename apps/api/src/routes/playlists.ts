import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const createPlaylist = z.object({
  name: z.string().min(1),
});

export const playlistRoutes: FastifyPluginAsync = async (app) => {
  app.get("/playlists", async () => {
    return prisma.playlist.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { items: true } } },
    });
  });

  app.post("/playlists", async (request, reply) => {
    const body = createPlaylist.parse(request.body);
    const pl = await prisma.playlist.create({ data: { name: body.name } });
    return reply.status(201).send(pl);
  });
};

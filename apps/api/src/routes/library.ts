import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const createAsset = z.object({
  title: z.string().min(1),
  artist: z.string().optional(),
  path: z.string().min(1),
  durationSec: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
});

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/library/assets", async () => {
    return prisma.mediaAsset.findMany({
      orderBy: { title: "asc" },
      take: 200,
    });
  });

  app.post("/library/assets", async (request, reply) => {
    const body = createAsset.parse(request.body);
    const asset = await prisma.mediaAsset.create({ data: body });
    return reply.status(201).send(asset);
  });
};

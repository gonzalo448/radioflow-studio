import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";
import sanitize from "sanitize-filename";
import { z } from "zod";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_LIBRARY_WRITE } from "../lib/auth.js";
import { ensureMediaDirs, mediaRootAbs, relativeToMediaRoot, resolveAssetFilePath } from "../lib/media-path.js";
import { writePlayLog } from "../lib/play-log.js";

const createAsset = z.object({
  title: z.string().min(1),
  artist: z.string().optional(),
  path: z.string().min(1),
  durationSec: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
});

export const libraryRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const env = opts.env;

  app.addHook("preHandler", async (request) => optionalAuth(request, env));

  app.get("/library/assets", async (request) => {
    const q = typeof request.query === "object" && request.query && "q" in request.query
      ? String((request.query as { q?: string }).q ?? "").trim()
      : "";
    return prisma.mediaAsset.findMany({
      where: q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { artist: { contains: q, mode: "insensitive" } },
              { album: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { title: "asc" },
      take: 500,
    });
  });

  app.get("/library/assets/:id/stream", async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return reply.status(404).send({ error: "No encontrado" });
    const filePath = resolveAssetFilePath(asset.path, env);
    if (!filePath) return reply.status(404).send({ error: "Archivo no accesible en el servidor" });
    const st = await stat(filePath);
    reply.header("Accept-Ranges", "bytes");
    reply.type(asset.mimeType ?? "audio/mpeg");
    reply.header("Content-Length", st.size);
    return reply.send(createReadStream(filePath));
  });

  app.post("/library/assets", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    const body = createAsset.parse(request.body);
    const asset = await prisma.mediaAsset.create({ data: body });
    void writePlayLog({
      action: "LIBRARY_UPLOAD",
      userId: request.userId ?? null,
      assetId: asset.id,
      details: { kind: "register_path", path: body.path },
    });
    return reply.status(201).send(asset);
  });

  app.post("/library/upload", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    await ensureMediaDirs(env);
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Falta archivo (multipart field: file)" });

    const safeName = sanitize(file.filename || "audio.bin");
    const ext = path.extname(safeName) || "";
    const base = path.basename(safeName, ext);
    const storedName = `${base}-${randomUUID()}${ext}`;
    const absDest = path.join(mediaRootAbs(env), "uploads", storedName);
    await pipeline(file.file, createWriteStream(absDest));

    const mime = file.mimetype || "application/octet-stream";
    const relPath = relativeToMediaRoot(absDest, env);
    const asset = await prisma.mediaAsset.create({
      data: {
        title: base.replace(/[-_]/g, " ") || "Sin título",
        path: relPath,
        mimeType: mime,
      },
    });
    void writePlayLog({
      action: "LIBRARY_UPLOAD",
      userId: request.userId ?? null,
      assetId: asset.id,
      details: { kind: "multipart", filename: safeName },
    });
    return reply.status(201).send(asset);
  });
};

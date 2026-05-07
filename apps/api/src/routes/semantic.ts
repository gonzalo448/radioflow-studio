import type { FastifyPluginAsync } from "fastify";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";

export const semanticRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const env = opts.env;
  app.addHook("preHandler", async (request) => optionalAuth(request, env));

  app.get("/semantic/search", async (request) => {
    const q = typeof request.query === "object" && request.query && "q" in request.query
      ? String((request.query as { q?: string }).q ?? "").trim()
      : "";
    if (q.length < 1) return [];
    return prisma.mediaAsset.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { artist: { contains: q, mode: "insensitive" } },
          { album: { contains: q, mode: "insensitive" } },
          { semanticNote: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 80,
      orderBy: { title: "asc" },
    });
  });

  app.post("/semantic/enrich/:assetId", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    if (!env.OLLAMA_BASE_URL) {
      return reply.status(503).send({ error: "OLLAMA_BASE_URL no configurada" });
    }
    const { assetId } = request.params as { assetId: string };
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) return reply.status(404).send({ error: "Medio no encontrado" });

    const prompt = `En 2 o 3 frases en español, describe el posible contexto cultural o musical de una pieza titulada "${asset.title}"${
      asset.artist ? ` de ${asset.artist}` : ""
    }. Sé breve y neutro.`;

    const res = await fetch(`${env.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        prompt,
        stream: false,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return reply.status(502).send({ error: "Ollama no respondió", detail: res.status, body: t.slice(0, 500) });
    }

    const raw = (await res.json()) as { response?: string };
    const text = raw.response?.trim();
    if (!text) return reply.status(502).send({ error: "Respuesta vacía de Ollama" });

    const updated = await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { semanticNote: text },
    });
    return updated;
  });
};

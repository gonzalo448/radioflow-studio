import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";
import { enrichAssetSemantic, semanticSearchAssets } from "../lib/semantic-embeddings.js";
import { isPgVectorSemanticEnabled } from "../lib/pgvector-semantic.js";
import { countAssetsForPgVectorBackfill } from "../lib/pgvector-backfill-batch.js";

const batchBody = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(50),
});

function stripScore<T extends { semanticScore?: number | null }>(rows: T[]): Omit<T, "semanticScore">[] {
  return rows.map(({ semanticScore: _s, ...rest }) => rest);
}

export const semanticRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const env = opts.env;
  app.addHook("preHandler", async (request) => optionalAuth(request, env));

  app.get("/semantic/status", async () => {
    const [withNote, withEmbedding, total, pgvectorEnabled, pgvectorBackfillPending] = await Promise.all([
      prisma.mediaAsset.count({ where: { semanticNote: { not: null } } }),
      prisma.mediaAsset.count({ where: { embeddingRef: { not: null } } }),
      prisma.mediaAsset.count(),
      isPgVectorSemanticEnabled(),
      countAssetsForPgVectorBackfill(prisma),
    ]);
    return {
      ollamaConfigured: Boolean(env.OLLAMA_BASE_URL),
      chatModel: env.OLLAMA_MODEL,
      embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
      pgvectorEnabled,
      pgvectorBackfillPending,
      assetsTotal: total,
      assetsWithSemanticNote: withNote,
      assetsWithEmbedding: withEmbedding,
    };
  });

  app.get("/semantic/search", async (request) => {
    const q = request.query as {
      q?: string;
      mode?: string;
      genre?: string;
      artist?: string;
      album?: string;
      pathPrefix?: string;
    };
    const query = String(q.q ?? "").trim();
    if (query.length < 1) return [];

    const useVector = q.mode !== "text";
    const rows = await semanticSearchAssets(
      query,
      {
        genre: q.genre,
        artist: q.artist,
        album: q.album,
        pathPrefix: q.pathPrefix,
      },
      env,
    );

    if (!useVector) {
      return stripScore(rows);
    }

    return rows.map((r) => ({
      ...r,
      semanticScore: r.semanticScore != null ? Math.round(r.semanticScore * 1000) / 1000 : null,
    }));
  });

  app.post("/semantic/enrich/:assetId", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    if (!env.OLLAMA_BASE_URL) {
      return reply.status(503).send({ error: "OLLAMA_BASE_URL no configurada" });
    }
    const { assetId } = request.params as { assetId: string };
    try {
      const updated = await enrichAssetSemantic(assetId, env);
      return updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("no encontrado")) return reply.status(404).send({ error: msg });
      return reply.status(502).send({ error: msg });
    }
  });

  app.post("/semantic/enrich-batch", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    if (!env.OLLAMA_BASE_URL) {
      return reply.status(503).send({ error: "OLLAMA_BASE_URL no configurada" });
    }
    const body = batchBody.parse(request.body ?? {});
    const results: { assetId: string; ok: boolean; error?: string }[] = [];
    for (const assetId of body.assetIds) {
      try {
        await enrichAssetSemantic(assetId, env);
        results.push({ assetId, ok: true });
      } catch (err) {
        results.push({
          assetId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const ok = results.filter((r) => r.ok).length;
    return { ok, failed: results.length - ok, results };
  });
};

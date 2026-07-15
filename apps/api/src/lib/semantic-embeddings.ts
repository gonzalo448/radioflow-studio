import type { MediaAsset } from "@prisma/client";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { mediaAssetWhereFromLibraryFilters, type LibraryAssetListFilters } from "./library-list-filters.js";
import { isPgVectorSemanticEnabled, saveAssetEmbeddingPg, searchAssetsByPgVector } from "./pgvector-semantic.js";

export type StoredEmbedding = {
  v: 1;
  model: string;
  vector: number[];
};

export type SemanticSearchHit = MediaAsset & { semanticScore: number | null };

export function parseStoredEmbedding(raw: string | null | undefined): StoredEmbedding | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as StoredEmbedding;
    if (parsed?.v !== 1 || !Array.isArray(parsed.vector) || parsed.vector.length < 8) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeStoredEmbedding(model: string, vector: number[]): string {
  return JSON.stringify({ v: 1, model, vector } satisfies StoredEmbedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function assetEmbeddingText(asset: Pick<MediaAsset, "title" | "artist" | "album" | "genre" | "semanticNote">): string {
  const parts = [
    asset.title,
    asset.artist ? `Artista: ${asset.artist}` : null,
    asset.album ? `Álbum: ${asset.album}` : null,
    asset.genre ? `Género: ${asset.genre}` : null,
    asset.semanticNote ? `Contexto: ${asset.semanticNote}` : null,
  ].filter(Boolean);
  return parts.join(". ");
}

export async function ollamaEmbed(text: string, env: Env): Promise<number[]> {
  if (!env.OLLAMA_BASE_URL) throw new Error("OLLAMA_BASE_URL no configurada");
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Texto vacío para embedding");

  const res = await fetch(`${env.OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OLLAMA_EMBEDDING_MODEL,
      prompt: trimmed,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama embeddings falló (${res.status}): ${t.slice(0, 300)}`);
  }

  const raw = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(raw.embedding) || raw.embedding.length < 8) {
    throw new Error("Respuesta de embedding inválida");
  }
  return raw.embedding;
}

export async function ollamaGenerateSemanticNote(
  asset: Pick<MediaAsset, "title" | "artist" | "album" | "genre">,
  env: Env,
): Promise<string> {
  if (!env.OLLAMA_BASE_URL) throw new Error("OLLAMA_BASE_URL no configurada");
  const prompt = `En 2 o 3 frases en español, describe el posible contexto cultural o musical de una pieza titulada "${asset.title}"${
    asset.artist ? ` de ${asset.artist}` : ""
  }${asset.album ? ` del álbum «${asset.album}»` : ""}${asset.genre ? ` (género ${asset.genre})` : ""}. Sé breve y neutro.`;

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
    throw new Error(`Ollama generate falló (${res.status}): ${t.slice(0, 300)}`);
  }

  const raw = (await res.json()) as { response?: string };
  const text = raw.response?.trim();
  if (!text) throw new Error("Respuesta vacía de Ollama");
  return text;
}

export async function enrichAssetSemantic(assetId: string, env: Env): Promise<MediaAsset> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("Medio no encontrado");

  const semanticNote = await ollamaGenerateSemanticNote(asset, env);
  const embedText = assetEmbeddingText({ ...asset, semanticNote });
  const vector = await ollamaEmbed(embedText, env);

  const updated = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: {
      semanticNote,
      embeddingRef: serializeStoredEmbedding(env.OLLAMA_EMBEDDING_MODEL, vector),
    },
  });

  await saveAssetEmbeddingPg(assetId, vector).catch(() => {
    /* pgvector opcional */
  });

  return updated;
}

export async function semanticSearchAssets(
  q: string,
  filters: LibraryAssetListFilters,
  env: Env,
): Promise<SemanticSearchHit[]> {
  const query = q.trim();
  if (!query) return [];

  const where = mediaAssetWhereFromLibraryFilters(filters);
  const textWhere = {
    ...where,
    OR: [
      { title: { contains: query, mode: "insensitive" as const } },
      { artist: { contains: query, mode: "insensitive" as const } },
      { album: { contains: query, mode: "insensitive" as const } },
      { semanticNote: { contains: query, mode: "insensitive" as const } },
    ],
  };

  if (!env.OLLAMA_BASE_URL) {
    return (await prisma.mediaAsset.findMany({
      where: textWhere,
      take: 80,
      orderBy: { title: "asc" },
    })).map((a) => ({ ...a, semanticScore: null }));
  }

  let queryVector: number[] | null = null;
  try {
    queryVector = await ollamaEmbed(query, env);
  } catch {
    queryVector = null;
  }

  if (queryVector && (await isPgVectorSemanticEnabled())) {
    const pgHits = await searchAssetsByPgVector(queryVector, filters, 80);
    if (pgHits.length > 0) return pgHits;
  }

  if (queryVector) {
    const candidates = await prisma.mediaAsset.findMany({
      where,
      take: 3000,
      orderBy: { updatedAt: "desc" },
    });

    const ranked = candidates
      .map((asset) => {
        const stored = parseStoredEmbedding(asset.embeddingRef);
        if (!stored) return null;
        return {
          asset,
          score: cosineSimilarity(queryVector!, stored.vector),
        };
      })
      .filter((r): r is { asset: MediaAsset; score: number } => r != null && r.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 80);

    if (ranked.length > 0) {
      return ranked.map((r) => ({ ...r.asset, semanticScore: r.score }));
    }
  }

  return (await prisma.mediaAsset.findMany({
    where: textWhere,
    take: 80,
    orderBy: { title: "asc" },
  })).map((a) => ({ ...a, semanticScore: null }));
}

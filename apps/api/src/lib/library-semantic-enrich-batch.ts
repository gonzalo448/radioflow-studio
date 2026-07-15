import type { PrismaClient } from "@prisma/client";
import type { Env } from "../config.js";
import { enrichAssetSemantic } from "./semantic-embeddings.js";

export type SemanticEnrichBatchRow = {
  assetId: string;
  title: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export async function runSemanticEnrichBatchForAssets(
  prisma: PrismaClient,
  env: Env,
  opts: {
    assetIds: string[];
    skipIfEmbedded?: boolean;
    onProgress?: (p: {
      done: number;
      total: number;
      rows: SemanticEnrichBatchRow[];
    }) => void | Promise<void>;
  },
): Promise<{ kind: "semantic_enrich"; ok: number; skipped: number; failed: number; rows: SemanticEnrichBatchRow[] }> {
  if (!env.OLLAMA_BASE_URL) {
    throw new Error("OLLAMA_BASE_URL no configurada");
  }

  const skipIfEmbedded = opts.skipIfEmbedded === true;
  const rows: SemanticEnrichBatchRow[] = [];
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < opts.assetIds.length; i += 1) {
    const assetId = opts.assetIds[i]!;
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { id: true, title: true, embeddingRef: true },
    });
    if (!asset) {
      failed += 1;
      rows.push({ assetId, title: "?", ok: false, error: "Medio no encontrado" });
    } else if (skipIfEmbedded && asset.embeddingRef) {
      skipped += 1;
      rows.push({ assetId, title: asset.title, ok: true, skipped: true });
    } else {
      try {
        await enrichAssetSemantic(assetId, env);
        ok += 1;
        rows.push({ assetId, title: asset.title, ok: true });
      } catch (err) {
        failed += 1;
        rows.push({
          assetId,
          title: asset.title,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await opts.onProgress?.({ done: i + 1, total: opts.assetIds.length, rows: rows.slice(-20) });
  }

  return { kind: "semantic_enrich", ok, skipped, failed, rows };
}

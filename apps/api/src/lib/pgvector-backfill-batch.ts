import type { PrismaClient } from "@prisma/client";
import { parseStoredEmbedding } from "./semantic-embeddings.js";
import { isPgVectorSemanticEnabled, saveAssetEmbeddingPg } from "./pgvector-semantic.js";

export type PgVectorBackfillRow = {
  assetId: string;
  title: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export async function countAssetsForPgVectorBackfill(prisma: PrismaClient): Promise<number> {
  if (!(await isPgVectorSemanticEnabled())) return 0;
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "MediaAsset"
    WHERE "embeddingRef" IS NOT NULL
      AND "embedding" IS NULL
  `;
  return rows[0]?.n ?? 0;
}

/** Copia vectores JSON (`embeddingRef`) a columna pgvector (`embedding`). */
export async function runPgVectorBackfillBatch(
  prisma: PrismaClient,
  opts: {
    assetIds?: string[];
    limit?: number;
    onProgress?: (p: {
      done: number;
      total: number;
      updated: number;
      skipped: number;
      failed: number;
      rows: PgVectorBackfillRow[];
    }) => void | Promise<void>;
  },
): Promise<{
  kind: "pgvector_backfill";
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: PgVectorBackfillRow[];
}> {
  if (!(await isPgVectorSemanticEnabled())) {
    throw new Error("pgvector no disponible en esta base de datos");
  }

  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  let assets: { id: string; title: string; embeddingRef: string | null }[];

  if (opts.assetIds?.length) {
    assets = await prisma.mediaAsset.findMany({
      where: { id: { in: opts.assetIds.slice(0, 200) } },
      select: { id: true, title: true, embeddingRef: true },
    });
  } else {
    assets = await prisma.$queryRaw<{ id: string; title: string; embeddingRef: string }[]>`
      SELECT "id", "title", "embeddingRef"
      FROM "MediaAsset"
      WHERE "embeddingRef" IS NOT NULL
        AND "embedding" IS NULL
      ORDER BY "updatedAt" DESC
      LIMIT ${limit}
    `;
  }

  const rows: PgVectorBackfillRow[] = [];
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i]!;
    const stored = parseStoredEmbedding(asset.embeddingRef);
    if (!stored) {
      skipped += 1;
      rows.push({ assetId: asset.id, title: asset.title, ok: true, skipped: true, error: "embeddingRef inválido" });
    } else {
      try {
        await saveAssetEmbeddingPg(asset.id, stored.vector);
        updated += 1;
        rows.push({ assetId: asset.id, title: asset.title, ok: true });
      } catch (err) {
        failed += 1;
        rows.push({
          assetId: asset.id,
          title: asset.title,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await opts.onProgress?.({
      done: i + 1,
      total: assets.length,
      updated,
      skipped,
      failed,
      rows: rows.slice(-20),
    });
  }

  return {
    kind: "pgvector_backfill",
    total: assets.length,
    updated,
    skipped,
    failed,
    rows,
  };
}

import type { MediaAsset } from "@prisma/client";
import { prisma } from "../db.js";
import { isSqliteDatabaseUrl } from "./db-dialect.js";
import type { LibraryAssetListFilters } from "./library-list-filters.js";

const EMBEDDING_DIM = 768;

let pgVectorCached: boolean | null = null;

export function vectorToPgLiteral(values: number[]): string {
  if (values.length !== EMBEDDING_DIM) {
    throw new Error(`Embedding debe tener ${EMBEDDING_DIM} dimensiones (tiene ${values.length})`);
  }
  return `[${values.map((v) => Number(v).toFixed(8)).join(",")}]`;
}

/** Comprueba extensión pgvector + columna embedding (cache por proceso). */
export async function isPgVectorSemanticEnabled(): Promise<boolean> {
  if (isSqliteDatabaseUrl()) return false;
  if (pgVectorCached != null) return pgVectorCached;
  try {
    const ext = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok
    `;
    if (!ext[0]?.ok) {
      pgVectorCached = false;
      return false;
    }
    const col = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'MediaAsset' AND column_name = 'embedding'
      ) AS ok
    `;
    pgVectorCached = col[0]?.ok === true;
    return pgVectorCached;
  } catch {
    pgVectorCached = false;
    return false;
  }
}

export async function saveAssetEmbeddingPg(assetId: string, vector: number[]): Promise<void> {
  if (!(await isPgVectorSemanticEnabled())) return;
  const lit = vectorToPgLiteral(vector);
  await prisma.$executeRawUnsafe(
    `UPDATE "MediaAsset" SET "embedding" = $1::vector WHERE "id" = $2`,
    lit,
    assetId,
  );
}

type PgSearchRow = MediaAsset & { semantic_score: number };

/** Top-k por distancia coseno (`<=>`) en PostgreSQL + pgvector. */
export async function searchAssetsByPgVector(
  queryVector: number[],
  filters: LibraryAssetListFilters,
  limit = 80,
): Promise<Array<MediaAsset & { semanticScore: number }>> {
  if (!(await isPgVectorSemanticEnabled())) return [];

  const lit = vectorToPgLiteral(queryVector);
  const conditions: string[] = [`"embedding" IS NOT NULL`];
  const params: unknown[] = [lit];
  let idx = 2;

  const genre = (filters.genre ?? "").trim();
  const artist = (filters.artist ?? "").trim();
  const album = (filters.album ?? "").trim();
  const pathPrefix = (filters.pathPrefix ?? "").trim().replace(/\\/g, "/");

  if (genre) {
    conditions.push(`LOWER("genre") = LOWER($${idx})`);
    params.push(genre);
    idx += 1;
  }
  if (artist === "__none__") {
    conditions.push(`("artist" IS NULL OR "artist" = '')`);
  } else if (artist) {
    conditions.push(`LOWER("artist") = LOWER($${idx})`);
    params.push(artist);
    idx += 1;
  }
  if (album) {
    conditions.push(`LOWER("album") = LOWER($${idx})`);
    params.push(album);
    idx += 1;
  }
  if (pathPrefix) {
    conditions.push(`"path" LIKE $${idx}`);
    params.push(`${pathPrefix}%`);
    idx += 1;
  }

  const whereClause = conditions.join(" AND ");
  const sql = `
    SELECT
      "id", "title", "artist", "album", "genre", "path", "coverPath", "durationSec", "mimeType",
      "releaseYear", "id3Comment", "audioBitrateKbps", "audioSampleRateHz", "audioChannels",
      "playbackGainDb", "embeddingRef", "semanticNote", "introMatchKey",
      "customField1", "customField2", "customField3", "customField4", "customField5",
      "createdAt", "updatedAt",
      (1 - ("embedding" <=> $1::vector)) AS semantic_score
    FROM "MediaAsset"
    WHERE ${whereClause}
    ORDER BY "embedding" <=> $1::vector
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `;

  const rows = await prisma.$queryRawUnsafe<PgSearchRow[]>(sql, ...params);

  return rows
    .filter((r) => r.semantic_score > 0.05)
    .map(({ semantic_score, ...asset }) => ({
      ...(asset as MediaAsset),
      semanticScore: semantic_score,
    }));
}

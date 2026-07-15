-- pgvector para búsqueda semántica indexada (PostgreSQL prod).
-- Requiere imagen con extensión (ej. pgvector/pgvector:pg16). En SQLite/desktop se omite.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- HNSW: buen rendimiento en catálogos medianos/grandes (cosine distance).
CREATE INDEX IF NOT EXISTS "MediaAsset_embedding_hnsw_idx"
  ON "MediaAsset" USING hnsw ("embedding" vector_cosine_ops);

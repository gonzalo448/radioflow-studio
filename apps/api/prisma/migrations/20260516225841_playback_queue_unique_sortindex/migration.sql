-- 1) Agregar columnas nuevas a PlayQueueItem de forma segura
ALTER TABLE "PlayQueueItem"
ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "PlayQueueItem"
SET "updatedAt" = COALESCE("createdAt", NOW())
WHERE "updatedAt" IS NULL;

ALTER TABLE "PlayQueueItem"
ALTER COLUMN "updatedAt" SET NOT NULL;

-- 2) Agregar columnas nuevas a PlaybackQueueEntry
ALTER TABLE "PlaybackQueueEntry"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3) Crear índice auxiliar opcional para consultas por station + asset
CREATE INDEX IF NOT EXISTS "PlayQueueItem_stationId_assetId_idx"
ON "PlayQueueItem"("stationId", "assetId");

-- 4) Crear unique constraint para stationId + sortIndex
CREATE UNIQUE INDEX "PlaybackQueueEntry_stationId_sortIndex_key"
ON "PlaybackQueueEntry"("stationId", "sortIndex");
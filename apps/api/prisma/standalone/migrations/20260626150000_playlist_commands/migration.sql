-- SQLite: recreate columns via Prisma-compatible ALTER
ALTER TABLE "PlaylistItem" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'track';
ALTER TABLE "PlaylistItem" ADD COLUMN "label" TEXT;
ALTER TABLE "PlaylistItem" ADD COLUMN "pauseSec" INTEGER;

ALTER TABLE "PlayQueueItem" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'track';
ALTER TABLE "PlayQueueItem" ADD COLUMN "label" TEXT;
ALTER TABLE "PlayQueueItem" ADD COLUMN "pauseSec" INTEGER;

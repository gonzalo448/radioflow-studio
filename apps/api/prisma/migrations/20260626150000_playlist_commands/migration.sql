-- CreateEnum
CREATE TYPE "QueueEntryKind" AS ENUM ('track', 'pause', 'marker', 'note');

-- AlterTable PlaylistItem
ALTER TABLE "PlaylistItem" ADD COLUMN "kind" "QueueEntryKind" NOT NULL DEFAULT 'track';
ALTER TABLE "PlaylistItem" ADD COLUMN "label" TEXT;
ALTER TABLE "PlaylistItem" ADD COLUMN "pauseSec" INTEGER;
ALTER TABLE "PlaylistItem" ALTER COLUMN "assetId" DROP NOT NULL;

-- AlterTable PlayQueueItem
ALTER TABLE "PlayQueueItem" ADD COLUMN "kind" "QueueEntryKind" NOT NULL DEFAULT 'track';
ALTER TABLE "PlayQueueItem" ADD COLUMN "label" TEXT;
ALTER TABLE "PlayQueueItem" ADD COLUMN "pauseSec" INTEGER;
ALTER TABLE "PlayQueueItem" ALTER COLUMN "assetId" DROP NOT NULL;

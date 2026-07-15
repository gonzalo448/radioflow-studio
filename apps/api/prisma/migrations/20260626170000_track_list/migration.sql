-- AlterEnum
ALTER TYPE "QueueEntryKind" ADD VALUE 'track_list';

-- AlterTable
ALTER TABLE "PlaylistItem" ADD COLUMN "trackListSpec" JSONB;

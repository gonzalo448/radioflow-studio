-- AlterEnum
ALTER TYPE "QueueEntryKind" ADD VALUE 'dtmf';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "songRequestArtistCooldownMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "songRequestTitleCooldownMin" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN "rotationResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

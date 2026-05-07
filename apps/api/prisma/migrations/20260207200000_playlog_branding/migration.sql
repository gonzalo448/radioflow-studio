-- CreateEnum
CREATE TYPE "PlayAction" AS ENUM ('QUEUE_APPEND', 'QUEUE_REMOVE', 'SKIP', 'STATION_UPDATE', 'PLAYLIST_QUEUE_SYNC', 'LIBRARY_UPLOAD');

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "stationName" TEXT NOT NULL DEFAULT 'RadioFlow Studio',
    "tagline" TEXT,
    "primaryColor" TEXT DEFAULT '#38bdf8',
    "logoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayLog" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "action" "PlayAction" NOT NULL,
    "assetId" TEXT,
    "details" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayLog_pkey" PRIMARY KEY ("id")
);

-- Insert default branding
INSERT INTO "AppSettings" ("id", "stationName", "updatedAt")
VALUES ('global', 'RadioFlow Studio', CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "semanticNote" TEXT;

-- AddForeignKey
ALTER TABLE "PlayLog" ADD CONSTRAINT "PlayLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayLog" ADD CONSTRAINT "PlayLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "PlayLog_createdAt_idx" ON "PlayLog"("createdAt");

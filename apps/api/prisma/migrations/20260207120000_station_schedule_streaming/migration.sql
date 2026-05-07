-- CreateEnum
CREATE TYPE "StreamProtocol" AS ENUM ('icecast', 'shoutcast', 'azuracast');

-- CreateEnum
CREATE TYPE "StationMode" AS ENUM ('AUTO', 'LIVE_ASSIST', 'LIVE');

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "mode" "StationMode" NOT NULL DEFAULT 'AUTO',
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "liveTitle" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayQueueItem" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "position" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleBlock" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "playlistId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamingTarget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "StreamProtocol" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 8000,
    "mountPath" TEXT NOT NULL DEFAULT '/stream',
    "sourceUser" TEXT,
    "sourcePassword" TEXT NOT NULL,
    "publicBaseUrl" TEXT,
    "tls" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamingTarget_pkey" PRIMARY KEY ("id")
);

-- Insert default station
INSERT INTO "Station" ("id", "mode", "currentPosition", "updatedAt")
VALUES ('main', 'AUTO', 0, CURRENT_TIMESTAMP);

-- AddForeignKey
ALTER TABLE "PlayQueueItem" ADD CONSTRAINT "PlayQueueItem_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayQueueItem" ADD CONSTRAINT "PlayQueueItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "PlayQueueItem_stationId_position_key" ON "PlayQueueItem"("stationId", "position");

-- AlterEnum
ALTER TYPE "SchedulerActionType" ADD VALUE 'PLAY_AD_BREAK';

-- CreateTable
CREATE TABLE "AdSchedulerConfig" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pathPrefix" TEXT NOT NULL DEFAULT 'publicidad/',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "spotsPerBreak" INTEGER NOT NULL DEFAULT 2,
    "maxSpotsPerHour" INTEGER NOT NULL DEFAULT 8,
    "minGapMinutes" INTEGER NOT NULL DEFAULT 5,
    "rotationMode" TEXT NOT NULL DEFAULT 'random',
    "lastBreakAt" TIMESTAMP(3),
    "sequentialCursor" INTEGER NOT NULL DEFAULT 0,
    "hourWindowStart" TIMESTAMP(3),
    "spotsThisHour" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSchedulerConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdBreakLog" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "assetIds" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdBreakLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdBreakLog_stationId_createdAt_idx" ON "AdBreakLog"("stationId", "createdAt");

INSERT INTO "AdSchedulerConfig" ("id", "enabled", "pathPrefix", "intervalMinutes", "spotsPerBreak", "maxSpotsPerHour", "minGapMinutes", "rotationMode", "sequentialCursor", "spotsThisHour", "updatedAt")
VALUES ('main', false, 'publicidad/', 15, 2, 8, 5, 'random', 0, 0, CURRENT_TIMESTAMP);

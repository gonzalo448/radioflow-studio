-- CreateTable
CREATE TABLE "AdSchedulerConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'main',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pathPrefix" TEXT NOT NULL DEFAULT 'publicidad/',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "spotsPerBreak" INTEGER NOT NULL DEFAULT 2,
    "maxSpotsPerHour" INTEGER NOT NULL DEFAULT 8,
    "minGapMinutes" INTEGER NOT NULL DEFAULT 5,
    "rotationMode" TEXT NOT NULL DEFAULT 'random',
    "lastBreakAt" DATETIME,
    "sequentialCursor" INTEGER NOT NULL DEFAULT 0,
    "hourWindowStart" DATETIME,
    "spotsThisHour" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AdBreakLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "assetIds" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AdBreakLog_stationId_createdAt_idx" ON "AdBreakLog"("stationId", "createdAt");

INSERT INTO "AdSchedulerConfig" ("id", "enabled", "pathPrefix", "intervalMinutes", "spotsPerBreak", "maxSpotsPerHour", "minGapMinutes", "rotationMode", "sequentialCursor", "spotsThisHour", "updatedAt")
VALUES ('main', 0, 'publicidad/', 15, 2, 8, 5, 'random', 0, 0, CURRENT_TIMESTAMP);

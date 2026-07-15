-- Sincroniza SQLite embebido con campos ya presentes en el esquema standalone (RDS, DTMF, JSON).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "stationName" TEXT NOT NULL DEFAULT 'RadioFlow Studio',
    "tagline" TEXT,
    "primaryColor" TEXT DEFAULT '#38bdf8',
    "logoUrl" TEXT,
    "activeStreamingTargetId" TEXT,
    "extraStreamingTargetIds" TEXT,
    "rdsText" TEXT,
    "rdsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "songRequestArtistCooldownMin" INTEGER NOT NULL DEFAULT 0,
    "songRequestTitleCooldownMin" INTEGER NOT NULL DEFAULT 60,
    "autoIntroFolder" TEXT NOT NULL DEFAULT 'intros',
    "libraryCustomFieldLabels" TEXT NOT NULL DEFAULT '["Personalizado 1","Personalizado 2","Personalizado 3","Personalizado 4","Personalizado 5"]',
    "streamRecordingFolder" TEXT NOT NULL DEFAULT 'recordings',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("activeStreamingTargetId", "autoIntroFolder", "id", "libraryCustomFieldLabels", "logoUrl", "primaryColor", "songRequestArtistCooldownMin", "songRequestTitleCooldownMin", "stationName", "streamRecordingFolder", "tagline", "updatedAt")
SELECT "activeStreamingTargetId", "autoIntroFolder", "id", "libraryCustomFieldLabels", "logoUrl", "primaryColor", "songRequestArtistCooldownMin", "songRequestTitleCooldownMin", "stationName", "streamRecordingFolder", "tagline", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";

CREATE TABLE "new_JingleSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "pageKey" TEXT NOT NULL DEFAULT 'A',
    "slotKey" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "label" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JingleSlot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_JingleSlot" ("assetId", "id", "label", "slotKey", "stationId", "updatedAt")
SELECT "assetId", "id", "label", "slotKey", "stationId", "updatedAt" FROM "JingleSlot";
DROP TABLE "JingleSlot";
ALTER TABLE "new_JingleSlot" RENAME TO "JingleSlot";
CREATE INDEX "JingleSlot_stationId_idx" ON "JingleSlot"("stationId");
CREATE UNIQUE INDEX "JingleSlot_stationId_pageKey_slotKey_key" ON "JingleSlot"("stationId", "pageKey", "slotKey");

CREATE TABLE "new_LibraryProcessJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "progressCurrent" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "LibraryProcessJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LibraryProcessJob" ("createdAt", "createdByUserId", "error", "finishedAt", "id", "kind", "payload", "progressCurrent", "progressTotal", "result", "startedAt", "status")
SELECT "createdAt", "createdByUserId", "error", "finishedAt", "id", "kind", "payload", "progressCurrent", "progressTotal", "result", "startedAt", "status" FROM "LibraryProcessJob";
DROP TABLE "LibraryProcessJob";
ALTER TABLE "new_LibraryProcessJob" RENAME TO "LibraryProcessJob";
CREATE INDEX "LibraryProcessJob_status_createdAt_idx" ON "LibraryProcessJob"("status", "createdAt");

CREATE TABLE "new_PlayLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "action" TEXT NOT NULL,
    "assetId" TEXT,
    "details" JSONB,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlayLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlayLog" ("action", "assetId", "createdAt", "details", "id", "stationId", "userId")
SELECT "action", "assetId", "createdAt", "details", "id", "stationId", "userId" FROM "PlayLog";
DROP TABLE "PlayLog";
ALTER TABLE "new_PlayLog" RENAME TO "PlayLog";

CREATE TABLE "new_PlayQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "kind" TEXT NOT NULL DEFAULT 'track',
    "position" INTEGER NOT NULL,
    "assetId" TEXT,
    "label" TEXT,
    "pauseSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayQueueItem_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayQueueItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlayQueueItem" ("assetId", "createdAt", "id", "kind", "label", "pauseSec", "position", "stationId")
SELECT "assetId", "createdAt", "id", "kind", "label", "pauseSec", "position", "stationId" FROM "PlayQueueItem";
DROP TABLE "PlayQueueItem";
ALTER TABLE "new_PlayQueueItem" RENAME TO "PlayQueueItem";
CREATE UNIQUE INDEX "PlayQueueItem_stationId_position_key" ON "PlayQueueItem"("stationId", "position");

CREATE TABLE "new_PlaylistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'track',
    "assetId" TEXT,
    "label" TEXT,
    "pauseSec" INTEGER,
    "trackListSpec" JSONB,
    "position" INTEGER NOT NULL,
    CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlaylistItem" ("assetId", "id", "kind", "label", "pauseSec", "playlistId", "position", "trackListSpec")
SELECT "assetId", "id", "kind", "label", "pauseSec", "playlistId", "position", "trackListSpec" FROM "PlaylistItem";
DROP TABLE "PlaylistItem";
ALTER TABLE "new_PlaylistItem" RENAME TO "PlaylistItem";
CREATE UNIQUE INDEX "PlaylistItem_playlistId_position_key" ON "PlaylistItem"("playlistId", "position");

CREATE TABLE "new_SchedulerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "actionType" TEXT NOT NULL,
    "runAt" DATETIME,
    "nextRunAt" DATETIME,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SchedulerEvent" ("actionType", "createdAt", "enabled", "id", "name", "nextRunAt", "payload", "runAt", "updatedAt")
SELECT "actionType", "createdAt", "enabled", "id", "name", "nextRunAt", "payload", "runAt", "updatedAt" FROM "SchedulerEvent";
DROP TABLE "SchedulerEvent";
ALTER TABLE "new_SchedulerEvent" RENAME TO "SchedulerEvent";
CREATE INDEX "SchedulerEvent_enabled_nextRunAt_idx" ON "SchedulerEvent"("enabled", "nextRunAt");

CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'AUTO',
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "liveTitle" TEXT,
    "autoScheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastAppliedScheduleBlockId" TEXT,
    "cabCrossfadeSec" REAL NOT NULL DEFAULT 4,
    "cabReferenceGainDb" REAL NOT NULL DEFAULT 0,
    "cabWebAudioEngine" BOOLEAN NOT NULL DEFAULT true,
    "dtmfActionsJson" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Station" ("autoScheduleEnabled", "cabCrossfadeSec", "cabReferenceGainDb", "cabWebAudioEngine", "currentPosition", "id", "lastAppliedScheduleBlockId", "liveTitle", "mode", "updatedAt")
SELECT "autoScheduleEnabled", "cabCrossfadeSec", "cabReferenceGainDb", "cabWebAudioEngine", "currentPosition", "id", "lastAppliedScheduleBlockId", "liveTitle", "mode", "updatedAt" FROM "Station";
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

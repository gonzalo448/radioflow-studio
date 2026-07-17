-- Smart Crossfade Fase 1: fade in/out + umbral Gap Killer.
-- SQLite no permite cambiar DEFAULT con ALTER COLUMN; se recrea Station.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'AUTO',
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "liveTitle" TEXT,
    "autoScheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastAppliedScheduleBlockId" TEXT,
    "autoDjActivePlaylistId" TEXT,
    "autoDjPlaylistCursor" INTEGER NOT NULL DEFAULT 0,
    "cabCrossfadeSec" REAL NOT NULL DEFAULT 2,
    "cabFadeInSec" REAL NOT NULL DEFAULT 2,
    "cabFadeOutSec" REAL NOT NULL DEFAULT 2,
    "cabSilenceThresholdDb" REAL NOT NULL DEFAULT -40,
    "cabReferenceGainDb" REAL NOT NULL DEFAULT 0,
    "cabWebAudioEngine" BOOLEAN NOT NULL DEFAULT true,
    "dtmfActionsJson" TEXT,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_Station" (
    "id", "mode", "currentPosition", "liveTitle", "autoScheduleEnabled",
    "lastAppliedScheduleBlockId", "autoDjActivePlaylistId", "autoDjPlaylistCursor",
    "cabCrossfadeSec", "cabReferenceGainDb", "cabWebAudioEngine",
    "dtmfActionsJson", "updatedAt"
)
SELECT
    "id", "mode", "currentPosition", "liveTitle", "autoScheduleEnabled",
    "lastAppliedScheduleBlockId", "autoDjActivePlaylistId", "autoDjPlaylistCursor",
    CASE WHEN "cabCrossfadeSec" = 4 THEN 2 ELSE "cabCrossfadeSec" END,
    "cabReferenceGainDb", "cabWebAudioEngine", "dtmfActionsJson", "updatedAt"
FROM "Station";

DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

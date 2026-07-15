CREATE TABLE "PlaybackQueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "playQueueItemId" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("playQueueItemId") REFERENCES "PlayQueueItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlaybackQueueEntry_playQueueItemId_key" ON "PlaybackQueueEntry"("playQueueItemId");

CREATE INDEX "PlaybackQueueEntry_stationId_sortIndex_idx" ON "PlaybackQueueEntry"("stationId", "sortIndex");

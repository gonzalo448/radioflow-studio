-- CreateTable
CREATE TABLE "PlaybackQueueEntry" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "playQueueItemId" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,

    CONSTRAINT "PlaybackQueueEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaybackQueueEntry_playQueueItemId_key" ON "PlaybackQueueEntry"("playQueueItemId");

CREATE INDEX "PlaybackQueueEntry_stationId_sortIndex_idx" ON "PlaybackQueueEntry"("stationId", "sortIndex");

ALTER TABLE "PlaybackQueueEntry" ADD CONSTRAINT "PlaybackQueueEntry_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlaybackQueueEntry" ADD CONSTRAINT "PlaybackQueueEntry_playQueueItemId_fkey" FOREIGN KEY ("playQueueItemId") REFERENCES "PlayQueueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

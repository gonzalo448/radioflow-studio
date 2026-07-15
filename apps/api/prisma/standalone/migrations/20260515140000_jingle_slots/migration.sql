CREATE TABLE "JingleSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "slotKey" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "label" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JingleSlot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "JingleSlot_stationId_slotKey_key" ON "JingleSlot"("stationId", "slotKey");
CREATE INDEX "JingleSlot_stationId_idx" ON "JingleSlot"("stationId");

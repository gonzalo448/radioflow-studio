-- CreateTable
CREATE TABLE "JingleSlot" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL DEFAULT 'main',
    "slotKey" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "label" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JingleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JingleSlot_stationId_slotKey_key" ON "JingleSlot"("stationId", "slotKey");

-- CreateIndex
CREATE INDEX "JingleSlot_stationId_idx" ON "JingleSlot"("stationId");

-- AddForeignKey
ALTER TABLE "JingleSlot" ADD CONSTRAINT "JingleSlot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

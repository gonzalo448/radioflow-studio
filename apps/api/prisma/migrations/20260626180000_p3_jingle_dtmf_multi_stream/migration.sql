-- RB-083: páginas A/B/C en cart wall
ALTER TABLE "JingleSlot" ADD COLUMN "pageKey" TEXT NOT NULL DEFAULT 'A';

DROP INDEX IF EXISTS "JingleSlot_stationId_slotKey_key";

CREATE UNIQUE INDEX "JingleSlot_stationId_pageKey_slotKey_key" ON "JingleSlot"("stationId", "pageKey", "slotKey");

-- RB-118: mapa DTMF → acciones
ALTER TABLE "Station" ADD COLUMN "dtmfActionsJson" TEXT;

-- RB-135: destinos secundarios simultáneos
ALTER TABLE "AppSettings" ADD COLUMN "extraStreamingTargetIds" TEXT;

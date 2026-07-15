-- Intro de emisora (station ID): archivo/carpeta + intervalo automático
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "stationIntroSourceAbs" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "stationIntroIntervalMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "stationIntroLastSlotKey" TEXT;

ALTER TYPE "QueueEntryKind" ADD VALUE IF NOT EXISTS 'station_intro';

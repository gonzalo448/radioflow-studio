-- Intro de emisora (station ID): archivo/carpeta + intervalo automático
ALTER TABLE "AppSettings" ADD COLUMN "stationIntroSourceAbs" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "stationIntroIntervalMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "stationIntroLastSlotKey" TEXT;

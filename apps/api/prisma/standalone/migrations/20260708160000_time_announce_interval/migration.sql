-- Intervalo de locución automática: 0 = off, 15 | 30 | 60 minutos
ALTER TABLE "AppSettings" ADD COLUMN "timeAnnounceIntervalMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "timeAnnounceLastSlotKey" TEXT;

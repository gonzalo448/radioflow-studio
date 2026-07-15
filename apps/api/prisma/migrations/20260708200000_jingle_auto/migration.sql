-- Jingles automático tipo RadioBOSS: intervalo por minutos y/o por cantidad de canciones.
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "jingleAutoIntervalMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "jingleAutoEveryTracks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "jingleAutoPageKey" TEXT NOT NULL DEFAULT 'A';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "jingleAutoSlotKeysJson" TEXT NOT NULL DEFAULT '["1"]';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "jingleAutoLastSlotKey" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "jingleAutoLastAssetId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "jingleAutoTracksSinceLast" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "jingleAutoLastTimeSlotKey" TEXT;

ALTER TYPE "QueueEntryKind" ADD VALUE IF NOT EXISTS 'jingle_auto';

-- Jingles automático tipo RadioBOSS: intervalo por minutos y/o por cantidad de canciones.
ALTER TABLE "AppSettings" ADD COLUMN "jingleAutoIntervalMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "jingleAutoEveryTracks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "jingleAutoPageKey" TEXT NOT NULL DEFAULT 'A';
ALTER TABLE "AppSettings" ADD COLUMN "jingleAutoSlotKeysJson" TEXT NOT NULL DEFAULT '["1"]';
ALTER TABLE "AppSettings" ADD COLUMN "jingleAutoLastSlotKey" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "jingleAutoLastAssetId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "jingleAutoTracksSinceLast" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "jingleAutoLastTimeSlotKey" TEXT;

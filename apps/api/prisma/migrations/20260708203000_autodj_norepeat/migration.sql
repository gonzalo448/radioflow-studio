-- AutoDJ: protección anti repetición (0 = off).
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "autoDjNoRepeatArtistLastN" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "autoDjNoRepeatTrackLastN" INTEGER NOT NULL DEFAULT 0;

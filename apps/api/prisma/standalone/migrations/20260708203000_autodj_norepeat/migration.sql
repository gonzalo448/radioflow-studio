-- AutoDJ: protección anti repetición (0 = off).
ALTER TABLE "AppSettings" ADD COLUMN "autoDjNoRepeatArtistLastN" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "autoDjNoRepeatTrackLastN" INTEGER NOT NULL DEFAULT 0;

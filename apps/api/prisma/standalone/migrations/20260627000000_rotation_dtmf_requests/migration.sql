-- SQLite: recreate enum via new values in application; add columns
ALTER TABLE "AppSettings" ADD COLUMN "songRequestArtistCooldownMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "songRequestTitleCooldownMin" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Playlist" ADD COLUMN "rotationResetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

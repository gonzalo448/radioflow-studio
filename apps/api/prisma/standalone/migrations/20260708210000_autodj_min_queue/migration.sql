-- AutoDJ: mantener cola con N canciones futuras.
ALTER TABLE "AppSettings" ADD COLUMN "autoDjMinUpcomingTracks" INTEGER NOT NULL DEFAULT 0;
-- Cursor AutoDJ para rellenar sin duplicar infinito.
ALTER TABLE "Station" ADD COLUMN "autoDjActivePlaylistId" TEXT;
ALTER TABLE "Station" ADD COLUMN "autoDjPlaylistCursor" INTEGER NOT NULL DEFAULT 0;

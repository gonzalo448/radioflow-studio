-- AutoDJ: mantener cola con N canciones futuras.
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "autoDjMinUpcomingTracks" INTEGER NOT NULL DEFAULT 0;
-- Cursor AutoDJ para rellenar sin duplicar infinito.
ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "autoDjActivePlaylistId" TEXT;
ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "autoDjPlaylistCursor" INTEGER NOT NULL DEFAULT 0;

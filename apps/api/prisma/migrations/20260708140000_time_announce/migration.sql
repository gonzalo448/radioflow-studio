-- Locución horaria: carpeta absoluta de voces + acción de scheduler TIME_ANNOUNCE
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "timeAnnounceFolderAbs" TEXT;

DO $$ BEGIN
  ALTER TYPE "SchedulerActionType" ADD VALUE IF NOT EXISTS 'TIME_ANNOUNCE';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

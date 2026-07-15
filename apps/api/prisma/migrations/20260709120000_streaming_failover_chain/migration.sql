ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "streamingFailoverBackupTargetIdsJson" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "streamingFailoverActiveBackupIndex" INTEGER NOT NULL DEFAULT -1;

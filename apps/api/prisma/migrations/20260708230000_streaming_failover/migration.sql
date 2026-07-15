ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "streamingFailoverEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "streamingFailoverBackupTargetId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "streamingFailoverPrimaryTargetId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "streamingFailoverAutoRevert" BOOLEAN NOT NULL DEFAULT true;

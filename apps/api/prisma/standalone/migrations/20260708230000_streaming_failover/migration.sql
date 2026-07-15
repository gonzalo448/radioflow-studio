ALTER TABLE "AppSettings" ADD COLUMN "streamingFailoverEnabled" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "streamingFailoverBackupTargetId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "streamingFailoverPrimaryTargetId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "streamingFailoverAutoRevert" INTEGER NOT NULL DEFAULT 1;

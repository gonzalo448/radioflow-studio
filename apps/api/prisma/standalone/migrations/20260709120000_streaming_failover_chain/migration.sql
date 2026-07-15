ALTER TABLE "AppSettings" ADD COLUMN "streamingFailoverBackupTargetIdsJson" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "streamingFailoverActiveBackupIndex" INTEGER NOT NULL DEFAULT -1;

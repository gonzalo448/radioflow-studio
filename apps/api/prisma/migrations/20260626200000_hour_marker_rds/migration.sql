-- hour_marker en playlist + RDS en settings
ALTER TYPE "QueueEntryKind" ADD VALUE IF NOT EXISTS 'hour_marker';

ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "rdsText" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "rdsEnabled" BOOLEAN NOT NULL DEFAULT false;

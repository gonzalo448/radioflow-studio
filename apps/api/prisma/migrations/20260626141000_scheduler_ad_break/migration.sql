-- PLAY_AD_BREAK ya puede existir (20260626140000_ad_scheduler); idempotente para migrate deploy.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'SchedulerActionType' AND e.enumlabel = 'PLAY_AD_BREAK'
  ) THEN
    ALTER TYPE "SchedulerActionType" ADD VALUE 'PLAY_AD_BREAK';
  END IF;
END $$;

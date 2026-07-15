-- Scheduler recurrente: 0 = una sola vez; >0 = repetir cada N minutos
ALTER TABLE "SchedulerEvent" ADD COLUMN IF NOT EXISTS "repeatIntervalMin" INTEGER NOT NULL DEFAULT 0;

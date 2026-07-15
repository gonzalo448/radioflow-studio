-- SQLite standalone: repetir cada N minutos
ALTER TABLE "SchedulerEvent" ADD COLUMN "repeatIntervalMin" INTEGER NOT NULL DEFAULT 0;

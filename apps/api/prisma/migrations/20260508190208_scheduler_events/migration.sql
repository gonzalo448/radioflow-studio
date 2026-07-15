-- CreateEnum
CREATE TYPE "SchedulerActionType" AS ENUM ('PLAY_PLAYLIST', 'PLAY_ASSET', 'RUN_COMMAND');

-- CreateEnum
CREATE TYPE "SchedulerRunStatus" AS ENUM ('success', 'error');

-- CreateTable
CREATE TABLE "SchedulerEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "actionType" "SchedulerActionType" NOT NULL,
    "runAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerRun" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "SchedulerRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "SchedulerRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchedulerEvent_enabled_nextRunAt_idx" ON "SchedulerEvent"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "SchedulerRun_eventId_startedAt_idx" ON "SchedulerRun"("eventId", "startedAt");

-- AddForeignKey
ALTER TABLE "SchedulerRun" ADD CONSTRAINT "SchedulerRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchedulerEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

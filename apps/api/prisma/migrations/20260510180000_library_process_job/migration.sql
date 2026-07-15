-- CreateEnum
CREATE TYPE "LibraryProcessJobStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "LibraryProcessJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "LibraryProcessJobStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "progressCurrent" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LibraryProcessJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryProcessJob_status_createdAt_idx" ON "LibraryProcessJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "LibraryProcessJob" ADD CONSTRAINT "LibraryProcessJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

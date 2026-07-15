-- CreateTable
CREATE TABLE "ListenerSample" (
    "id" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listeners" INTEGER,
    "streamTitle" TEXT,
    "sourceConnected" BOOLEAN,
    "streamingTargetId" TEXT,
    "targetName" TEXT,

    CONSTRAINT "ListenerSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListenerSample_recordedAt_idx" ON "ListenerSample"("recordedAt");

-- CreateTable
CREATE TABLE "ListenerSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listeners" INTEGER,
    "streamTitle" TEXT,
    "sourceConnected" BOOLEAN,
    "streamingTargetId" TEXT,
    "targetName" TEXT
);

CREATE INDEX "ListenerSample_recordedAt_idx" ON "ListenerSample"("recordedAt");

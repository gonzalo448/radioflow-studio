-- CreateTable
CREATE TABLE "SongRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listenerName" TEXT,
    "listenerContact" TEXT,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assetId" TEXT,
    "reviewedAt" DATETIME,
    "reviewedByUserId" TEXT,
    "enqueuedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SongRequest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SongRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "SongRequest_status_createdAt_idx" ON "SongRequest"("status", "createdAt");

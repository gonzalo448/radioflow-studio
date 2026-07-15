-- CreateEnum
CREATE TYPE "SongRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'played');

-- CreateTable
CREATE TABLE "SongRequest" (
    "id" TEXT NOT NULL,
    "listenerName" TEXT,
    "listenerContact" TEXT,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "message" TEXT,
    "status" "SongRequestStatus" NOT NULL DEFAULT 'pending',
    "assetId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "enqueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SongRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SongRequest_status_createdAt_idx" ON "SongRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SongRequest" ADD CONSTRAINT "SongRequest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongRequest" ADD CONSTRAINT "SongRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

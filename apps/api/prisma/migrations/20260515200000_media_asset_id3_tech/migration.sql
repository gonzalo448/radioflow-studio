-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "releaseYear" INTEGER,
ADD COLUMN "id3Comment" TEXT,
ADD COLUMN "audioBitrateKbps" INTEGER,
ADD COLUMN "audioSampleRateHz" INTEGER,
ADD COLUMN "audioChannels" INTEGER;

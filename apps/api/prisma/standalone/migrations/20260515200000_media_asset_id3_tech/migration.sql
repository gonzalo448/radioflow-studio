-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "releaseYear" INTEGER;
ALTER TABLE "MediaAsset" ADD COLUMN "id3Comment" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "audioBitrateKbps" INTEGER;
ALTER TABLE "MediaAsset" ADD COLUMN "audioSampleRateHz" INTEGER;
ALTER TABLE "MediaAsset" ADD COLUMN "audioChannels" INTEGER;

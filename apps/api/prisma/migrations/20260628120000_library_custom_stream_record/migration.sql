-- AlterTable AppSettings
ALTER TABLE "AppSettings" ADD COLUMN "libraryCustomFieldLabels" TEXT NOT NULL DEFAULT '["Personalizado 1","Personalizado 2","Personalizado 3","Personalizado 4","Personalizado 5"]';
ALTER TABLE "AppSettings" ADD COLUMN "streamRecordingFolder" TEXT NOT NULL DEFAULT 'recordings';

-- AlterTable MediaAsset
ALTER TABLE "MediaAsset" ADD COLUMN "customField1" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "customField2" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "customField3" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "customField4" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "customField5" TEXT;

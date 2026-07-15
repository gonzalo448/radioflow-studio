-- Cue points estilo RadioBOSS (Start / End): omiten silencios de cabeza/cola sin reescribir el archivo.
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "cueStartSec" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "cueEndSec" DOUBLE PRECISION;

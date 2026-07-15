-- Cue points estilo RadioBOSS (Start / End): omiten silencios de cabeza/cola sin reescribir el archivo.
ALTER TABLE "MediaAsset" ADD COLUMN "cueStartSec" REAL;
ALTER TABLE "MediaAsset" ADD COLUMN "cueEndSec" REAL;

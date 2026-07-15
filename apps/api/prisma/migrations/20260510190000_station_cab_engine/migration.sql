-- Motor referencia cabina (crossfade / nivelación alineados a estado de estación)
ALTER TABLE "Station" ADD COLUMN "cabCrossfadeSec" DOUBLE PRECISION NOT NULL DEFAULT 4;
ALTER TABLE "Station" ADD COLUMN "cabReferenceGainDb" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Station" ADD COLUMN "cabWebAudioEngine" BOOLEAN NOT NULL DEFAULT true;

-- Nivelación por ítem (Web Audio): ajuste fino en dB, editable vía API librería
ALTER TABLE "MediaAsset" ADD COLUMN "playbackGainDb" DOUBLE PRECISION NOT NULL DEFAULT 0;

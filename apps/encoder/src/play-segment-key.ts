type SegmentKeyInput = {
  cueStartSec: number;
  cueEndSec: number | null;
  cabCrossfadeSec: number;
  cabFadeInSec?: number;
  cabFadeOutSec?: number;
  playbackGainDb: number;
  cabReferenceGainDb: number;
};

type OverlayKeyInput = {
  voiceTrackAssetId?: string | null;
  overlayAtSec?: number | null;
};

/** Identidad de configuración que obliga a reiniciar FFmpeg para la pista actual. */
export function playSegmentKey(
  segment: SegmentKeyInput | null | undefined,
  overlay: OverlayKeyInput | null | undefined,
): string {
  if (!segment) return "";
  return [
    segment.cueStartSec,
    segment.cueEndSec,
    segment.cabCrossfadeSec,
    segment.cabFadeInSec ?? "",
    segment.cabFadeOutSec ?? "",
    segment.playbackGainDb,
    segment.cabReferenceGainDb,
    overlay?.voiceTrackAssetId ?? "",
    overlay?.overlayAtSec ?? "",
  ].join("|");
}

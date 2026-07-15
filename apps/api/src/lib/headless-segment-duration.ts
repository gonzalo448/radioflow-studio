import { playSegmentCrossfadeOverlapSec } from "@radioflow/shared";

/**
 * A3/B4: sin cues/duration/probe no inventamos 240 s — gracia corta y skip.
 */
export const UNKNOWN_DURATION_GRACE_SEC = 2.5;

/** Ventana cueStart→cueEnd o durationSec bruto; null si falta dato. */
export function playableDurationFromMeta(
  assetDurationSec: number | null | undefined,
  cueStartSec: number | null | undefined,
  cueEndSec: number | null | undefined,
): number | null {
  const start =
    cueStartSec != null && Number.isFinite(cueStartSec) && cueStartSec >= 0 ? cueStartSec : 0;
  if (cueEndSec != null && Number.isFinite(cueEndSec) && cueEndSec > start + 0.4) {
    return cueEndSec - start;
  }
  if (assetDurationSec != null && Number.isFinite(assetDurationSec) && assetDurationSec > 0) {
    return Math.max(0.5, assetDurationSec - start);
  }
  return null;
}

export function applyCrossfadeToSegmentNeed(
  durSec: number,
  crossfadeSec: number,
  nextIsSpot: boolean,
): number {
  if (nextIsSpot || crossfadeSec <= 0.05) return Math.max(0.5, durSec);
  const overlap = playSegmentCrossfadeOverlapSec(0, durSec, durSec, crossfadeSec);
  return Math.max(0.5, durSec - overlap);
}

import { playSegmentCrossfadeOverlapSec } from "@radioflow/shared";

/** Cue points de reproducción en el cliente (alineados con ApiStationAsset / PlaySegmentSpec). */
export type ClientTrackCues = {
  cueStartSec: number;
  cueEndSec: number;
};

export function normalizeClientCues(
  durationSec: number | null | undefined,
  cueStartSec: number | null | undefined,
  cueEndSec: number | null | undefined,
): ClientTrackCues | null {
  const dur =
    durationSec != null && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null;
  const start =
    cueStartSec != null && Number.isFinite(cueStartSec) ? Math.max(0, cueStartSec) : 0;
  let end =
    cueEndSec != null && Number.isFinite(cueEndSec) && cueEndSec > start + 0.2
      ? cueEndSec
      : dur;
  if (end == null) {
    if (cueStartSec == null && cueEndSec == null) return null;
    return { cueStartSec: start, cueEndSec: start + 1 };
  }
  if (dur != null) end = Math.min(end, dur);
  if (end - start < 0.4) return dur != null ? { cueStartSec: 0, cueEndSec: dur } : null;
  return {
    cueStartSec: Math.round(start * 1000) / 1000,
    cueEndSec: Math.round(end * 1000) / 1000,
  };
}

/** Ajusta cues a la duración real del archivo (el elemento <audio>), nunca más allá. */
export function clampCuesToFileDuration(
  cues: ClientTrackCues,
  fileDur: number,
): ClientTrackCues {
  if (!(fileDur > 0.25) || !Number.isFinite(fileDur)) return cues;
  const start = Math.min(Math.max(0, cues.cueStartSec), Math.max(0, fileDur - 0.2));
  const end = Math.min(Math.max(start + 0.15, cues.cueEndSec), fileDur);
  if (end - start < 0.2) return { cueStartSec: 0, cueEndSec: fileDur };
  return {
    cueStartSec: Math.round(start * 1000) / 1000,
    cueEndSec: Math.round(end * 1000) / 1000,
  };
}

/**
 * Instantánea donde debe empezar el mix.
 * `overlapSec` debe ser el resultado de `crossfadeOverlapSec` (contrato A1).
 */
export function mixTriggerAt(
  cueEndSec: number,
  cueStartSec: number,
  overlapSec: number,
): number {
  return Math.max(cueStartSec + 0.05, cueEndSec - Math.max(0.35, overlapSec));
}

/** Duración de fundido — misma función que encoder / API (`playSegmentCrossfadeOverlapSec`). */
export function crossfadeOverlapSec(
  cueEndSec: number,
  cueStartSec: number,
  configuredSec: number,
): number {
  return playSegmentCrossfadeOverlapSec(cueStartSec, cueEndSec, null, configuredSec);
}

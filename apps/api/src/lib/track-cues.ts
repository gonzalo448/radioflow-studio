/** Cue points de reproducción (RadioBOSS Start / End). Tiempos absolutos en el archivo. */
export type TrackCuePoints = {
  cueStartSec: number;
  cueEndSec: number;
};

export type SilenceSpan = { startSec: number; endSec: number };

/**
 * Deriva Start/End a partir de silencedetect de ffmpeg.
 * - Start: fin del silencio inicial (si arranca cerca de 0).
 * - End: inicio del silencio final (si llega casi al final del archivo).
 */
export function cuePointsFromSilences(
  durationSec: number,
  silences: SilenceSpan[],
  opts?: { headGraceSec?: number; tailGraceSec?: number; maxLeadFrac?: number },
): TrackCuePoints | null {
  if (!Number.isFinite(durationSec) || durationSec < 1.5) return null;
  const headGrace = opts?.headGraceSec ?? 0.18;
  const tailGrace = opts?.tailGraceSec ?? 0.35;
  const maxLeadFrac = opts?.maxLeadFrac ?? 0.22;

  let cueStart = 0;
  let cueEnd = durationSec;

  const sorted = [...silences]
    .filter((s) => Number.isFinite(s.startSec) && Number.isFinite(s.endSec) && s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const lead = sorted.find((s) => s.startSec <= headGrace);
  if (lead) {
    cueStart = Math.min(lead.endSec, durationSec * maxLeadFrac);
  }

  const trail = [...sorted].reverse().find((s) => s.endSec >= durationSec - tailGrace);
  if (trail && trail.startSec > cueStart + 1.2) {
    cueEnd = trail.startSec;
  }

  if (cueEnd - cueStart < 1.2) {
    cueStart = 0;
    cueEnd = durationSec;
  }

  return {
    cueStartSec: roundCue(cueStart),
    cueEndSec: roundCue(cueEnd),
  };
}

export function roundCue(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

/** Instantánea de mezcla: Mix point = cueEnd − overlapSec (mín. overlap garantizado). */
export function mixTriggerAt(cueEndSec: number, cueStartSec: number, overlapSec: number): number {
  const usable = Math.max(0.2, cueEndSec - cueStartSec);
  const overlap = Math.min(Math.max(0.15, overlapSec), Math.max(0.15, usable * 0.45));
  return Math.max(cueStartSec + 0.05, cueEndSec - overlap);
}

export function normalizeCueWindow(
  durationSec: number | null | undefined,
  cueStartSec: number | null | undefined,
  cueEndSec: number | null | undefined,
): TrackCuePoints | null {
  const dur = durationSec != null && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null;
  const start = cueStartSec != null && Number.isFinite(cueStartSec) ? Math.max(0, cueStartSec) : 0;
  let end =
    cueEndSec != null && Number.isFinite(cueEndSec) && cueEndSec > start + 0.2
      ? cueEndSec
      : dur;
  if (end == null) return cueStartSec != null || cueEndSec != null ? { cueStartSec: start, cueEndSec: start + 1 } : null;
  if (dur != null) end = Math.min(end, dur);
  if (end - start < 0.4) return dur != null ? { cueStartSec: 0, cueEndSec: dur } : null;
  return { cueStartSec: roundCue(start), cueEndSec: roundCue(end) };
}

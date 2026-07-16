import { playSegmentFadeDurationSec, resolvePlaySegmentFades } from "@radioflow/shared";
import type { ApiVoiceTrackOverlaySpec } from "@radioflow/shared";

export type PlaySegmentForFilter = {
  cueStartSec: number;
  cueEndSec: number | null;
  durationSec: number | null;
  playbackGainDb: number;
  cabCrossfadeSec: number;
  cabFadeInSec?: number;
  cabFadeOutSec?: number;
  cabReferenceGainDb: number;
};

/**
 * filter_complex: música [0] + VT [1] con delay + duck en outro.
 * `duration=first` = longitud del segmento musical (VT puede truncarse al EOF de A).
 */
export function buildVoiceTrackOverlayFilterComplex(
  seg: PlaySegmentForFilter,
  overlay: Pick<ApiVoiceTrackOverlaySpec, "overlayAtSec" | "duckDb" | "voiceTrackGainDb">,
): string {
  const start = Math.max(0, seg.cueStartSec ?? 0);
  const end =
    seg.cueEndSec != null && Number.isFinite(seg.cueEndSec) && seg.cueEndSec > start + 0.2
      ? seg.cueEndSec
      : seg.durationSec != null && seg.durationSec > start + 0.2
        ? seg.durationSec
        : start + 30;
  const fades = resolvePlaySegmentFades(seg);
  const fadeIn = playSegmentFadeDurationSec(start, end, seg.durationSec, fades.fadeInSec);
  const fadeOut = playSegmentFadeDurationSec(start, end, seg.durationSec, fades.fadeOutSec);
  const musicGainDb = (seg.cabReferenceGainDb ?? 0) + (seg.playbackGainDb ?? 0);
  const vtGainDb = (seg.cabReferenceGainDb ?? 0) + (overlay.voiceTrackGainDb ?? 0);
  const duckLin = Math.pow(10, -Math.abs(overlay.duckDb) / 20);
  const overlayAt = Math.max(0.05, overlay.overlayAtSec);
  const delayMs = Math.round(overlayAt * 1000);
  const dur = end - start;

  const musicChain = [
    `atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)}`,
    "asetpts=PTS-STARTPTS",
  ];
  if (fadeIn > 0.001) {
    musicChain.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  }
  if (fadeOut > 0.001 && dur > fadeIn + fadeOut + 0.1) {
    musicChain.push(`afade=t=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }
  if (Math.abs(musicGainDb) > 0.05) {
    musicChain.push(`volume=${musicGainDb.toFixed(2)}dB`);
  }
  musicChain.push(`volume=${duckLin.toFixed(4)}:enable='gte(t\\,${overlayAt.toFixed(3)})'`);

  const vtChain = [
    "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo",
    `adelay=${delayMs}|${delayMs}`,
  ];
  if (Math.abs(vtGainDb) > 0.05) {
    vtChain.push(`volume=${vtGainDb.toFixed(2)}dB`);
  }

  return `[0:a]${musicChain.join(",")}[a];[1:a]${vtChain.join(",")}[vt];[a][vt]amix=inputs=2:duration=first:dropout_transition=0[mix]`;
}

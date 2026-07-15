/**
 * Re-export del plan shared (C2) + thin wrappers tipados para cola API de Cabina.
 */
import {
  DEFAULT_SONG_INTRO_SEC,
  DEFAULT_SONG_OUTRO_SEC,
  DEFAULT_VOICE_TRACK_DUCK_DB,
  estimateIntroWindowSec,
  estimateOutroWindowSec,
  planVoiceTrackBridge as planVoiceTrackBridgeShared,
  voiceTrackOverlayTriggerAt,
  type ApiStationQueueItem,
} from "@radioflow/shared";
import type { ClientTrackCues } from "./track-cues";

export {
  DEFAULT_SONG_INTRO_SEC,
  DEFAULT_SONG_OUTRO_SEC,
  voiceTrackOverlayTriggerAt,
  estimateIntroWindowSec,
  estimateOutroWindowSec,
};

export type VoiceTrackBridgePlan = {
  voiceTrackAssetId: string;
  voiceTrackGainDb: number;
  nextMusicAssetId: string;
  nextMusicGainDb: number;
  nextMusicCueStartSec: number | null;
  nextMusicCueEndSec: number | null;
  nextMusicDurationSec: number | null;
  outroWindowSec: number;
  introWindowSec: number;
  /** dB relativos al bus (negativo = duck). */
  duckDb: number;
};

/**
 * Si lo siguiente es un voicetrack y después hay música, plan de solape
 * VT sobre outro de la actual + intro de la siguiente.
 */
export function planVoiceTrackBridge(
  queue: ApiStationQueueItem[],
  curPos: number,
  crossfadeSec: number,
  currentCues: ClientTrackCues | null,
  duckDbPositive = DEFAULT_VOICE_TRACK_DUCK_DB,
): VoiceTrackBridgePlan | null {
  const plan = planVoiceTrackBridgeShared(
    queue.map((q) => ({
      kind: q.kind,
      asset: q.asset
        ? {
            id: q.asset.id,
            path: q.asset.path,
            playbackGainDb: q.asset.playbackGainDb,
            cueStartSec: q.asset.cueStartSec,
            cueEndSec: q.asset.cueEndSec,
            durationSec: q.asset.durationSec,
          }
        : null,
    })),
    curPos,
    crossfadeSec,
    currentCues,
    { duckDb: duckDbPositive },
  );
  if (!plan) return null;
  return {
    voiceTrackAssetId: plan.voiceTrackAssetId,
    voiceTrackGainDb: plan.voiceTrackGainDb,
    nextMusicAssetId: plan.nextMusicAssetId,
    nextMusicGainDb: plan.nextMusicGainDb,
    nextMusicCueStartSec: plan.nextMusicCueStartSec,
    nextMusicCueEndSec: plan.nextMusicCueEndSec,
    nextMusicDurationSec: plan.nextMusicDurationSec,
    outroWindowSec: plan.outroWindowSec,
    introWindowSec: plan.introWindowSec,
    duckDb: -plan.duckDb,
  };
}

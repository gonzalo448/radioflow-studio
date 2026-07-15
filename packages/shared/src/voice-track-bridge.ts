/**
 * Voicetrack bridge (C2): plan track A → VT → track B para el aire (encoder)
 * y la misma regla de planning que Cabina.
 */

export const DEFAULT_SONG_OUTRO_SEC = 7;
export const DEFAULT_SONG_INTRO_SEC = 7;
export const DEFAULT_VOICE_TRACK_DUCK_DB = 12;
export const VOICE_TRACK_DUCK_DB_MIN = 6;
export const VOICE_TRACK_DUCK_DB_MAX = 24;

export type VoiceTrackBridgeAsset = {
  id: string;
  path: string;
  playbackGainDb?: number | null;
  cueStartSec?: number | null;
  cueEndSec?: number | null;
  durationSec?: number | null;
};

export type VoiceTrackBridgeQueueItem = {
  kind: string;
  asset: VoiceTrackBridgeAsset | null | undefined;
};

/** Spec enviado en station/WS para que el encoder mezcle VT sobre el outro. */
export interface ApiVoiceTrackOverlaySpec {
  voiceTrackAssetId: string;
  voiceTrackPath: string;
  voiceTrackGainDb: number;
  nextMusicAssetId: string;
  outroWindowSec: number;
  introWindowSec: number;
  /** Atenuación positiva de la cama (dB). 12 → volumen × 10^(-12/20). */
  duckDb: number;
  /**
   * Segundos desde el inicio del segmento recortado (tras cueStart)
   * hasta arrancar el VT.
   */
  overlayAtSec: number;
  /** Skips tras EOF del mix A+VT para aterrizar en B (A + VT). */
  skipCountOnEnd: 2;
}

export type ClientTrackCuesLike = {
  cueStartSec: number;
  cueEndSec: number;
};

export function estimateOutroWindowSec(
  cues: ClientTrackCuesLike | null,
  crossfadeSec: number,
): number {
  if (!cues) return Math.max(DEFAULT_SONG_OUTRO_SEC, crossfadeSec);
  const usable = Math.max(0.5, cues.cueEndSec - cues.cueStartSec);
  const fromUsable = usable * 0.14;
  return Math.min(14, Math.max(crossfadeSec, Math.min(DEFAULT_SONG_OUTRO_SEC, fromUsable)));
}

export function estimateIntroWindowSec(
  cues: ClientTrackCuesLike | null,
  crossfadeSec: number,
): number {
  if (!cues) return Math.max(DEFAULT_SONG_INTRO_SEC, crossfadeSec);
  const usable = Math.max(0.5, cues.cueEndSec - cues.cueStartSec);
  const fromUsable = usable * 0.12;
  return Math.min(14, Math.max(crossfadeSec, Math.min(DEFAULT_SONG_INTRO_SEC, fromUsable)));
}

export function voiceTrackOverlayTriggerAt(
  cues: ClientTrackCuesLike,
  outroWindowSec: number,
): number {
  const usable = Math.max(0.2, cues.cueEndSec - cues.cueStartSec);
  const win = Math.min(Math.max(0.4, outroWindowSec), usable * 0.5);
  return Math.max(cues.cueStartSec + 0.1, cues.cueEndSec - win);
}

function gainOf(row: VoiceTrackBridgeQueueItem | undefined): number {
  return row?.asset?.playbackGainDb ?? 0;
}

function cuesOf(row: VoiceTrackBridgeQueueItem | undefined) {
  const a = row?.asset;
  return {
    cueStartSec: a?.cueStartSec ?? null,
    cueEndSec: a?.cueEndSec ?? null,
    durationSec: a?.durationSec ?? null,
  };
}

/**
 * Si lo siguiente es un voicetrack y después hay música, plan de solape
 * VT sobre outro de la actual (+ intro de la siguiente).
 */
export function planVoiceTrackBridge(
  queue: VoiceTrackBridgeQueueItem[],
  curPos: number,
  crossfadeSec: number,
  currentCues: ClientTrackCuesLike | null,
  opts?: { duckDb?: number },
): {
  voiceTrackAssetId: string;
  voiceTrackPath: string;
  voiceTrackGainDb: number;
  nextMusicAssetId: string;
  nextMusicPath: string;
  nextMusicGainDb: number;
  nextMusicCueStartSec: number | null;
  nextMusicCueEndSec: number | null;
  nextMusicDurationSec: number | null;
  outroWindowSec: number;
  introWindowSec: number;
  duckDb: number;
} | null {
  const vtRow = queue[curPos + 1];
  if (!vtRow || vtRow.kind !== "voicetrack" || !vtRow.asset?.path) return null;

  let musicRow: VoiceTrackBridgeQueueItem | undefined;
  for (let i = curPos + 2; i < queue.length; i++) {
    const r = queue[i]!;
    if (r.kind === "voicetrack") continue;
    if (r.kind === "track" && r.asset?.path) {
      musicRow = r;
      break;
    }
    if (r.kind === "pause" || r.kind === "marker" || r.kind === "note" || r.kind === "cmd") continue;
    if (
      r.kind === "time_announce" ||
      r.kind === "station_intro" ||
      r.kind === "jingle_auto" ||
      r.kind === "hour_marker" ||
      r.kind === "dtmf"
    ) {
      return null;
    }
  }
  if (!musicRow?.asset?.path) return null;

  const nextCuesRaw = cuesOf(musicRow);
  const nextCues =
    nextCuesRaw.durationSec != null || nextCuesRaw.cueStartSec != null
      ? {
          cueStartSec: nextCuesRaw.cueStartSec ?? 0,
          cueEndSec:
            nextCuesRaw.cueEndSec ??
            (nextCuesRaw.durationSec != null ? nextCuesRaw.durationSec : 0),
        }
      : null;

  const duckRaw = opts?.duckDb ?? DEFAULT_VOICE_TRACK_DUCK_DB;
  const duckDb = Math.min(
    VOICE_TRACK_DUCK_DB_MAX,
    Math.max(VOICE_TRACK_DUCK_DB_MIN, Math.abs(duckRaw)),
  );

  return {
    voiceTrackAssetId: vtRow.asset.id,
    voiceTrackPath: vtRow.asset.path,
    voiceTrackGainDb: gainOf(vtRow),
    nextMusicAssetId: musicRow.asset.id,
    nextMusicPath: musicRow.asset.path,
    nextMusicGainDb: gainOf(musicRow),
    nextMusicCueStartSec: nextCuesRaw.cueStartSec,
    nextMusicCueEndSec: nextCuesRaw.cueEndSec,
    nextMusicDurationSec: nextCuesRaw.durationSec,
    outroWindowSec: estimateOutroWindowSec(currentCues, crossfadeSec),
    introWindowSec: estimateIntroWindowSec(
      nextCues && nextCues.cueEndSec > nextCues.cueStartSec ? nextCues : null,
      crossfadeSec,
    ),
    duckDb,
  };
}

/** Overlay listo para encoder (requiere pista al aire = track con path). */
export function buildVoiceTrackOverlaySpec(
  queue: VoiceTrackBridgeQueueItem[],
  curPos: number,
  crossfadeSec: number,
  opts?: { duckDb?: number; enabled?: boolean },
): ApiVoiceTrackOverlaySpec | null {
  if (opts?.enabled === false) return null;
  const current = queue[curPos];
  if (!current || current.kind !== "track" || !current.asset?.path) return null;

  const cueStart =
    current.asset.cueStartSec != null && Number.isFinite(current.asset.cueStartSec)
      ? Math.max(0, current.asset.cueStartSec)
      : 0;
  let cueEnd =
    current.asset.cueEndSec != null &&
    Number.isFinite(current.asset.cueEndSec) &&
    current.asset.cueEndSec > cueStart + 0.2
      ? current.asset.cueEndSec
      : null;
  if (
    cueEnd == null &&
    current.asset.durationSec != null &&
    current.asset.durationSec > cueStart + 0.2
  ) {
    cueEnd = current.asset.durationSec;
  }
  if (cueEnd == null) return null;

  const currentCues = { cueStartSec: cueStart, cueEndSec: cueEnd };
  const plan = planVoiceTrackBridge(queue, curPos, crossfadeSec, currentCues, opts);
  if (!plan) return null;

  const triggerAbs = voiceTrackOverlayTriggerAt(currentCues, plan.outroWindowSec);
  const overlayAtSec = Math.max(0.05, triggerAbs - cueStart);

  return {
    voiceTrackAssetId: plan.voiceTrackAssetId,
    voiceTrackPath: plan.voiceTrackPath,
    voiceTrackGainDb: plan.voiceTrackGainDb,
    nextMusicAssetId: plan.nextMusicAssetId,
    outroWindowSec: plan.outroWindowSec,
    introWindowSec: plan.introWindowSec,
    duckDb: plan.duckDb,
    overlayAtSec: Math.round(overlayAtSec * 1000) / 1000,
    skipCountOnEnd: 2,
  };
}

import {
  DEFAULT_VOICETRACK_DUCK_DB,
  VOICETRACK_DUCK_DB_MAX,
  VOICETRACK_DUCK_DB_MIN,
} from "../station/reference-duck";

const STORAGE_KEY = "radioflow.cabVoiceTrack.v1";

export type CabVoiceTrackSettings = {
  /** Si false, el VT se reproduce como pista normal (sin solape). */
  bridgeEnabled: boolean;
  /** Atenuación de la cama musical mientras suena el VT (dB positivos = más duck). */
  duckDb: number;
};

const DEFAULTS: CabVoiceTrackSettings = {
  bridgeEnabled: true,
  duckDb: DEFAULT_VOICETRACK_DUCK_DB,
};

export function loadCabVoiceTrackSettings(): CabVoiceTrackSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<CabVoiceTrackSettings>;
    const duck = Number(parsed.duckDb);
    return {
      bridgeEnabled: parsed.bridgeEnabled !== false,
      duckDb: Number.isFinite(duck)
        ? Math.min(VOICETRACK_DUCK_DB_MAX, Math.max(VOICETRACK_DUCK_DB_MIN, duck))
        : DEFAULTS.duckDb,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveCabVoiceTrackSettings(next: CabVoiceTrackSettings): void {
  const duck = Math.min(
    VOICETRACK_DUCK_DB_MAX,
    Math.max(VOICETRACK_DUCK_DB_MIN, next.duckDb),
  );
  const cleaned: CabVoiceTrackSettings = {
    bridgeEnabled: next.bridgeEnabled !== false,
    duckDb: duck,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  window.dispatchEvent(new CustomEvent(CAB_VOICE_TRACK_EVENT));
}

export const CAB_VOICE_TRACK_EVENT = "radioflow:cab-voice-track";

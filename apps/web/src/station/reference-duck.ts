/** Atenuación típica de la cama musical mientras se graba voicetrack (RadioFlow-style). */
export const DEFAULT_VOICETRACK_DUCK_DB = 12;

export const VOICETRACK_DUCK_DB_MIN = 6;
export const VOICETRACK_DUCK_DB_MAX = 24;

/** Rampa al entrar en ducking (s). */
export const DEFAULT_DUCK_ATTACK_RAMP_SEC = 0.35;
/** Rampa al salir de ducking (s). */
export const DEFAULT_DUCK_RELEASE_RAMP_SEC = 0.5;

export const DEFAULT_MIC_MONITOR_GAIN_DB = 0;
export const MIC_MONITOR_GAIN_DB_MIN = -12;
export const MIC_MONITOR_GAIN_DB_MAX = 12;

export function dbToLinear(db: number): number {
 return Math.pow(10, db / 20);
}

export function lerpDb(fromDb: number, toDb: number, t: number): number {
 return fromDb + (toDb - fromDb) * t;
}

import { writePlayLog } from "./play-log.js";

export type AutomationKind =
  | "autodj_refill"
  | "jingle_auto_scheduled"
  | "jingle_auto_resolved"
  | "time_announce"
  | "station_intro"
  | "scheduler_event"
  | "voicetrack_recorded"
  | "air_silence"
  | "air_clipping"
  | "streaming_failover"
  | "headless_playout"
  | "icecast_source_down"
  | "icecast_source_recovered";

/** Registra un evento de automatización en el play-log (auditoría al aire). */
export function logAutomation(
  kind: AutomationKind,
  details?: Record<string, unknown>,
  assetId?: string | null,
): void {
  void writePlayLog({
    action: "AUTOMATION",
    assetId: assetId ?? null,
    details: { kind, ...(details ?? {}) },
  });
}

/** Registra que una pista entró al aire (una vez por assetId hasta el siguiente cambio). */
export function logTrackPlayed(
  assetId: string,
  details?: Record<string, unknown>,
): void {
  void writePlayLog({
    action: "TRACK_PLAYED",
    assetId,
    details,
  });
}

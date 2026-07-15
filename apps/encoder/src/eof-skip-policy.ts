/**
 * Política fin de archivo (B4): exit 0 → no reemitir; pedir skip si la cola no avanzó.
 */

export type EofSkipDecision = "request_skip" | "already_advanced" | "idle";

export function isNaturalFfmpegEnd(cause: string): boolean {
  return cause === "exit:0";
}

/**
 * Tras fin natural: ¿pedir `POST /api/station/skip`?
 * - already_advanced: Cabina/headless ya cambió nowPlaying
 * - idle: no hay pista al aire
 * - request_skip: encoder debe avanzar la cola
 */
export function decideSkipAfterNaturalEnd(opts: {
  finishedAbsNormalized: string;
  nowPlayingAbsNormalized: string | null;
  hasNowPlaying: boolean;
}): EofSkipDecision {
  const { finishedAbsNormalized, nowPlayingAbsNormalized, hasNowPlaying } = opts;
  if (nowPlayingAbsNormalized && nowPlayingAbsNormalized !== finishedAbsNormalized) {
    return "already_advanced";
  }
  if (!nowPlayingAbsNormalized && !hasNowPlaying) {
    return "idle";
  }
  return "request_skip";
}

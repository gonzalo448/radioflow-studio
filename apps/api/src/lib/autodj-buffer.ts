/** Helpers puros AutoDJ (buffer / no-repeat). Unit-tested en B4. */

export function normalizeArtistForAutodj(artist: string | null | undefined): string {
  return (artist ?? "").trim().toLowerCase() || "__unknown__";
}

/**
 * `autoDjMinUpcomingTracks === 0` → buffer por defecto 4
 * (lista corta no debe agotarse tras 1–2 canciones).
 */
export function resolveAutoDjMinUpcoming(configuredMin: number | null | undefined): number {
  const configured = Math.max(0, Math.min(200, configuredMin ?? 0));
  return configured > 0 ? configured : 4;
}

export function countUpcomingPlayable(
  queue: { position: number; kind: string }[],
  curPos: number,
): number {
  let n = 0;
  for (const r of queue) {
    if (r.position <= curPos) continue;
    if (r.kind === "track" || r.kind === "voicetrack") n += 1;
  }
  return n;
}

/** Cuántas pistas hay que añadir para alcanzar el mínimo. 0 = no refill. */
export function autoDjTracksNeeded(upcoming: number, minUpcoming: number): number {
  if (upcoming >= minUpcoming) return 0;
  return Math.max(1, minUpcoming - upcoming);
}

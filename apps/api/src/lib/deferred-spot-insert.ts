/** Kinds diferidos: se insertan tras la canción al aire y se expanden al llegar. */
export const DEFERRED_SPOT_KINDS = ["station_intro", "time_announce", "jingle_auto"] as const;

export type DeferredSpotKind = (typeof DEFERRED_SPOT_KINDS)[number];

export function isDeferredSpotKind(kind: string): kind is DeferredSpotKind {
  return (DEFERRED_SPOT_KINDS as readonly string[]).includes(kind);
}

/**
 * Posición de inserción tras la canción al aire, apilando detrás de otros spots
 * diferidos ya encolados (intro → locución → jingle).
 */
export function deferredSpotInsertAt(
  currentPosition: number,
  rows: Array<{ position: number; kind: string }>,
): number {
  const count = rows.length;
  let insertAt = 0;
  if (count > 0) {
    insertAt = Math.min(Math.max(0, currentPosition), count - 1) + 1;
  }
  while (insertAt < count && isDeferredSpotKind(rows[insertAt]!.kind)) {
    insertAt += 1;
  }
  return insertAt;
}

/**
 * Posición a podar tras skip (incluido el ítem al aire).
 * Si no hay ítem en `from`, trata like "ya pasado de largo".
 */
export function finishedPositionAfterSkip(from: number, hasCurrentItem: boolean): number {
  return hasCurrentItem ? from : Math.max(0, from) - 1;
}

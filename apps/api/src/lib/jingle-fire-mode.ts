/**
 * Política de disparo del cart wall (C5).
 * - playNow: inserta como siguiente y (si hay algo al aire) hace skip → jingle al aire ya.
 * - playNext (default histórico): queda tras lo al aire, sin cortar.
 * - append: al final de la cola.
 */
export function resolveJingleFireMode(input: {
  playNext?: boolean;
  playNow?: boolean;
}): { playNext: boolean; playNow: boolean } {
  if (input.playNow === true) {
    return { playNext: true, playNow: true };
  }
  if (input.playNext === false) {
    return { playNext: false, playNow: false };
  }
  return { playNext: true, playNow: false };
}

/** Solo tiene sentido skip tras insertar si ya había una pista «al aire». */
export function shouldSkipAfterCartInsert(playNow: boolean, hadOnAir: boolean): boolean {
  return playNow && hadOnAir;
}

export function normalizeJinglePageKey(raw: string | undefined): "A" | "B" | "C" {
  const p = (raw ?? "A").trim().toUpperCase();
  if (p === "B") return "B";
  if (p === "C") return "C";
  return "A";
}

export const JINGLE_SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export function isJingleSlotKey(key: string): boolean {
  return (JINGLE_SLOT_KEYS as readonly string[]).includes(key);
}

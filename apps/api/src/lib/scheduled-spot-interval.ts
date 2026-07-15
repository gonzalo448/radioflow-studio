/** Intervalos compartidos: locución horaria, intro de emisora, etc. */
export const SCHEDULED_SPOT_INTERVALS = [0, 15, 30, 60] as const;
export type ScheduledSpotIntervalMin = (typeof SCHEDULED_SPOT_INTERVALS)[number];

export function isScheduledSpotInterval(n: unknown): n is ScheduledSpotIntervalMin {
  return n === 0 || n === 15 || n === 30 || n === 60;
}

/** Clave del slot horario local, p. ej. 2026-07-08T10:15 */
export function scheduledSpotSlotKey(now: Date, intervalMin: Exclude<ScheduledSpotIntervalMin, 0>): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const m = now.getMinutes();
  const slotMin = Math.floor(m / intervalMin) * intervalMin;
  return `${y}-${mo}-${d}T${h}:${String(slotMin).padStart(2, "0")}`;
}

/** Clave con el minuto exacto del reloj (disparo manual). */
export function exactMinuteSlotKey(now: Date): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${m}`;
}

const SLOT_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseScheduledSpotSlotKey(slotKey: string): Date | null {
  const m = SLOT_KEY_RE.exec(slotKey.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const min = Number(m[5]);
  if (
    !Number.isFinite(y) ||
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > 31 ||
    h < 0 ||
    h > 23 ||
    min < 0 ||
    min > 59
  ) {
    return null;
  }
  const dt = new Date(y, mo - 1, d, h, min, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/**
 * Solo el primer tramo del minuto límite (evita encolar tarde en :00/:15/…).
 * El poll de spots suele ser ≥5 s; 25 s da margen a varios ticks.
 */
export function isOnScheduledSpotBoundary(
  now: Date,
  intervalMin: Exclude<ScheduledSpotIntervalMin, 0>,
  opts?: { maxSecondsIntoMinute?: number },
): boolean {
  if (now.getMinutes() % intervalMin !== 0) return false;
  const maxSec = opts?.maxSecondsIntoMinute ?? 25;
  return now.getSeconds() <= maxSec;
}

/** Minutos máximos de retraso tras el slot antes de descartar la locución. */
export function timeAnnounceMaxLatenessMin(intervalMin: Exclude<ScheduledSpotIntervalMin, 0> | 0): number {
  if (intervalMin === 60) return 10;
  if (intervalMin === 30) return 7;
  if (intervalMin === 15) return 4;
  return 5;
}

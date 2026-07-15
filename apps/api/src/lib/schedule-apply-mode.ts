/**
 * C3: un solo aplicador de parrilla (`ScheduleBlock` → cola).
 * Evita carrera internal poll ↔ schedule-worker.
 */

export type ScheduleApplyMode = "auto" | "internal" | "worker" | "off";

export type ResolvedScheduleApply = {
  /** Modo efectivo de producto (sin `auto`). */
  mode: "internal" | "worker" | "manual" | "off";
  /** Poll ms usado por la API para tick interno (0 = no tick). */
  effectiveInternalPollMs: number;
  /** true si se forzó apagar el poll interno por modo worker/off/conflicto. */
  conflictResolved: boolean;
  warn?: string;
};

/**
 * Resuelve el modo de aplicación de parrilla.
 * - `auto`: internal si poll>0, si no manual (worker externo no se detecta aquí).
 * - `internal`: usa poll configurado (aunque sea 0 → off de facto).
 * - `worker`: fuerza poll efectivo 0 (API no aplica bloques).
 * - `off`: ni internal ni expectativa de worker.
 */
export function resolveScheduleApplyMode(input: {
  scheduleApplyMode: ScheduleApplyMode;
  internalSchedulePollMs: number;
  /** true si el despliegue declara schedule-worker (Compose / env). */
  scheduleWorkerExpected?: boolean;
}): ResolvedScheduleApply {
  const configuredPoll = Math.max(0, input.internalSchedulePollMs);
  const workerExpected = input.scheduleWorkerExpected === true;
  let mode = input.scheduleApplyMode;

  if (mode === "auto") {
    if (workerExpected) mode = "worker";
    else if (configuredPoll > 0) mode = "internal";
    else mode = "off";
  }

  if (mode === "worker") {
    return {
      mode: "worker",
      effectiveInternalPollMs: 0,
      conflictResolved: configuredPoll > 0,
      warn:
        configuredPoll > 0
          ? "SCHEDULE_APPLY_MODE=worker (o SCHEDULE_WORKER_EXPECTED=1): INTERNAL_SCHEDULE_POLL_MS ignorado (era >0)."
          : undefined,
    };
  }

  if (mode === "off") {
    return {
      mode: "off",
      effectiveInternalPollMs: 0,
      conflictResolved: configuredPoll > 0,
      warn:
        configuredPoll > 0
          ? "SCHEDULE_APPLY_MODE=off: INTERNAL_SCHEDULE_POLL_MS ignorado."
          : undefined,
    };
  }

  // internal
  if (workerExpected && configuredPoll > 0) {
    return {
      mode: "worker",
      effectiveInternalPollMs: 0,
      conflictResolved: true,
      warn:
        "Conflicto C3: SCHEDULE_WORKER_EXPECTED=1 con INTERNAL_SCHEDULE_POLL_MS>0 → gana worker; poll interno apagado.",
    };
  }

  if (configuredPoll <= 0) {
    return {
      mode: "manual",
      effectiveInternalPollMs: 0,
      conflictResolved: false,
      warn:
        mode === "internal"
          ? "SCHEDULE_APPLY_MODE=internal pero INTERNAL_SCHEDULE_POLL_MS=0 (solo apply-active manual)."
          : undefined,
    };
  }

  return {
    mode: "internal",
    effectiveInternalPollMs: configuredPoll,
    conflictResolved: false,
  };
}

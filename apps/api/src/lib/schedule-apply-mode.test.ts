import { describe, expect, it } from "vitest";
import { resolveScheduleApplyMode } from "./schedule-apply-mode.js";

describe("resolveScheduleApplyMode (C3)", () => {
  it("auto + poll>0 → internal", () => {
    const r = resolveScheduleApplyMode({
      scheduleApplyMode: "auto",
      internalSchedulePollMs: 20_000,
    });
    expect(r.mode).toBe("internal");
    expect(r.effectiveInternalPollMs).toBe(20_000);
    expect(r.conflictResolved).toBe(false);
  });

  it("auto + poll=0 → off", () => {
    const r = resolveScheduleApplyMode({
      scheduleApplyMode: "auto",
      internalSchedulePollMs: 0,
    });
    expect(r.mode).toBe("off");
    expect(r.effectiveInternalPollMs).toBe(0);
  });

  it("worker fuerza poll efectivo 0 aunque esté configurado", () => {
    const r = resolveScheduleApplyMode({
      scheduleApplyMode: "worker",
      internalSchedulePollMs: 30_000,
    });
    expect(r.mode).toBe("worker");
    expect(r.effectiveInternalPollMs).toBe(0);
    expect(r.conflictResolved).toBe(true);
    expect(r.warn).toBeTruthy();
  });

  it("SCHEDULE_WORKER_EXPECTED gana sobre poll interno", () => {
    const r = resolveScheduleApplyMode({
      scheduleApplyMode: "auto",
      internalSchedulePollMs: 15_000,
      scheduleWorkerExpected: true,
    });
    expect(r.mode).toBe("worker");
    expect(r.effectiveInternalPollMs).toBe(0);
    expect(r.conflictResolved).toBe(true);
  });

  it("internal + poll=0 → manual", () => {
    const r = resolveScheduleApplyMode({
      scheduleApplyMode: "internal",
      internalSchedulePollMs: 0,
    });
    expect(r.mode).toBe("manual");
    expect(r.effectiveInternalPollMs).toBe(0);
  });

  it("off ignora poll", () => {
    const r = resolveScheduleApplyMode({
      scheduleApplyMode: "off",
      internalSchedulePollMs: 10_000,
    });
    expect(r.mode).toBe("off");
    expect(r.effectiveInternalPollMs).toBe(0);
    expect(r.conflictResolved).toBe(true);
  });
});

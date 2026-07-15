import { describe, expect, it } from "vitest";
import {
  UNKNOWN_DURATION_GRACE_SEC,
  applyCrossfadeToSegmentNeed,
  playableDurationFromMeta,
} from "./headless-segment-duration.js";

describe("UNKNOWN_DURATION_GRACE_SEC", () => {
  it("es gracia corta (no 240 s)", () => {
    expect(UNKNOWN_DURATION_GRACE_SEC).toBe(2.5);
    expect(UNKNOWN_DURATION_GRACE_SEC).toBeLessThan(10);
  });
});

describe("playableDurationFromMeta", () => {
  it("prioriza ventana de cues", () => {
    expect(playableDurationFromMeta(180, 10, 40)).toBe(30);
  });

  it("usa durationSec menos cueStart", () => {
    expect(playableDurationFromMeta(100, 20, null)).toBe(80);
  });

  it("devuelve null sin duración usable", () => {
    expect(playableDurationFromMeta(null, null, null)).toBeNull();
    expect(playableDurationFromMeta(0, 0, null)).toBeNull();
  });
});

describe("applyCrossfadeToSegmentNeed", () => {
  it("no recorta en spots o sin crossfade", () => {
    expect(applyCrossfadeToSegmentNeed(60, 3, true)).toBe(60);
    expect(applyCrossfadeToSegmentNeed(60, 0, false)).toBe(60);
  });

  it("recorta overlap con crossfade real", () => {
    const need = applyCrossfadeToSegmentNeed(60, 4, false);
    expect(need).toBeLessThan(60);
    expect(need).toBeGreaterThanOrEqual(0.5);
  });
});

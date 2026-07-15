import { describe, expect, it } from "vitest";
import { finishedPositionAfterSkip } from "./station-skip-math.js";

describe("finishedPositionAfterSkip", () => {
  it("poda la posición actual si hay ítem al aire", () => {
    expect(finishedPositionAfterSkip(0, true)).toBe(0);
    expect(finishedPositionAfterSkip(3, true)).toBe(3);
  });

  it("retrocede uno si currentPosition apunta fuera / vacío", () => {
    expect(finishedPositionAfterSkip(0, false)).toBe(-1);
    expect(finishedPositionAfterSkip(2, false)).toBe(1);
  });
});

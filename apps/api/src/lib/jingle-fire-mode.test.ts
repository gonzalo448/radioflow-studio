import { describe, expect, it } from "vitest";
import {
  isJingleSlotKey,
  normalizeJinglePageKey,
  resolveJingleFireMode,
  shouldSkipAfterCartInsert,
} from "./jingle-fire-mode.js";

describe("jingle-fire-mode (C5)", () => {
  it("playNow fuerza insert playNext", () => {
    expect(resolveJingleFireMode({ playNow: true })).toEqual({ playNext: true, playNow: true });
    expect(resolveJingleFireMode({ playNow: true, playNext: false })).toEqual({
      playNext: true,
      playNow: true,
    });
  });

  it("playNext false → append sin skip", () => {
    expect(resolveJingleFireMode({ playNext: false })).toEqual({ playNext: false, playNow: false });
  });

  it("default histórico = playNext sin cortar", () => {
    expect(resolveJingleFireMode({})).toEqual({ playNext: true, playNow: false });
  });

  it("skip solo si playNow y había aire", () => {
    expect(shouldSkipAfterCartInsert(true, true)).toBe(true);
    expect(shouldSkipAfterCartInsert(true, false)).toBe(false);
    expect(shouldSkipAfterCartInsert(false, true)).toBe(false);
  });

  it("normaliza página y teclas", () => {
    expect(normalizeJinglePageKey("b")).toBe("B");
    expect(normalizeJinglePageKey("x")).toBe("A");
    expect(isJingleSlotKey("0")).toBe(true);
    expect(isJingleSlotKey("a")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  autoDjTracksNeeded,
  countUpcomingPlayable,
  normalizeArtistForAutodj,
  resolveAutoDjMinUpcoming,
} from "./autodj-buffer.js";

describe("resolveAutoDjMinUpcoming", () => {
  it("usa 4 cuando no está configurado (0)", () => {
    expect(resolveAutoDjMinUpcoming(0)).toBe(4);
    expect(resolveAutoDjMinUpcoming(null)).toBe(4);
    expect(resolveAutoDjMinUpcoming(undefined)).toBe(4);
  });

  it("respeta un mínimo explícito", () => {
    expect(resolveAutoDjMinUpcoming(8)).toBe(8);
  });

  it("acota a 200", () => {
    expect(resolveAutoDjMinUpcoming(999)).toBe(200);
  });
});

describe("countUpcomingPlayable", () => {
  const queue = [
    { position: 0, kind: "track" },
    { position: 1, kind: "track" },
    { position: 2, kind: "pause" },
    { position: 3, kind: "voicetrack" },
    { position: 4, kind: "track" },
  ];

  it("cuenta solo track/voicetrack después de current", () => {
    expect(countUpcomingPlayable(queue, 0)).toBe(3);
    expect(countUpcomingPlayable(queue, 1)).toBe(2);
  });

  it("ignora lo ya al aire y anteriores", () => {
    expect(countUpcomingPlayable(queue, 3)).toBe(1);
    expect(countUpcomingPlayable(queue, 4)).toBe(0);
  });
});

describe("autoDjTracksNeeded", () => {
  it("no pide nada si ya hay buffer", () => {
    expect(autoDjTracksNeeded(4, 4)).toBe(0);
    expect(autoDjTracksNeeded(10, 4)).toBe(0);
  });

  it("pide al menos 1 cuando falta", () => {
    expect(autoDjTracksNeeded(0, 4)).toBe(4);
    expect(autoDjTracksNeeded(3, 4)).toBe(1);
  });
});

describe("normalizeArtistForAutodj", () => {
  it("normaliza y usa sentinel si vacío", () => {
    expect(normalizeArtistForAutodj("  ABBA  ")).toBe("abba");
    expect(normalizeArtistForAutodj("")).toBe("__unknown__");
    expect(normalizeArtistForAutodj(null)).toBe("__unknown__");
  });
});

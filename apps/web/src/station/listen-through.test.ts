import { describe, expect, it } from "vitest";
import { cabinaMayAutoSkip, isListenThroughEligible } from "@radioflow/shared";
import { listenThroughFromBroadcastStatus, resolveCabinaListenUrl } from "./listen-through";

describe("isListenThroughEligible", () => {
  const encoderLive = { stale: false, ffmpegActive: true };

  it("requiere broadcast + url + encoder vivo", () => {
    expect(
      isListenThroughEligible({
        broadcastEnabled: true,
        publicListenUrl: "http://127.0.0.1:8000/stream",
        encoder: encoderLive,
      }),
    ).toBe(true);
  });

  it("falla sin emisión, sin url, encoder stale o ffmpeg off", () => {
    expect(
      isListenThroughEligible({
        broadcastEnabled: false,
        publicListenUrl: "http://127.0.0.1:8000/stream",
        encoder: encoderLive,
      }),
    ).toBe(false);
    expect(
      isListenThroughEligible({
        broadcastEnabled: true,
        publicListenUrl: null,
        encoder: encoderLive,
      }),
    ).toBe(false);
    expect(
      isListenThroughEligible({
        broadcastEnabled: true,
        publicListenUrl: "http://127.0.0.1:8000/stream",
        encoder: { stale: true, ffmpegActive: true },
      }),
    ).toBe(false);
    expect(
      isListenThroughEligible({
        broadcastEnabled: true,
        publicListenUrl: "http://127.0.0.1:8000/stream",
        encoder: { stale: false, ffmpegActive: false },
      }),
    ).toBe(false);
  });

  it("respeta preferLocalMonitor", () => {
    expect(
      isListenThroughEligible({
        broadcastEnabled: true,
        publicListenUrl: "http://127.0.0.1:8000/stream",
        encoder: encoderLive,
        preferLocalMonitor: true,
      }),
    ).toBe(false);
  });
});

describe("cabinaMayAutoSkip", () => {
  it("bloquea auto-skip en listen-through", () => {
    expect(cabinaMayAutoSkip(true)).toBe(false);
    expect(cabinaMayAutoSkip(false)).toBe(true);
  });
});

describe("listenThroughFromBroadcastStatus", () => {
  it("lee campos C1 del status", () => {
    expect(
      listenThroughFromBroadcastStatus(
        {
          broadcastEnabled: true,
          publicListenUrl: "http://127.0.0.1:8000/stream",
          encoder: { stale: false, ffmpegActive: true } as never,
        },
        false,
      ),
    ).toBe(true);
    expect(listenThroughFromBroadcastStatus(null, false)).toBe(false);
  });
});

describe("resolveCabinaListenUrl", () => {
  it("en local deja localhost Icecast tal cual", () => {
    expect(resolveCabinaListenUrl("http://127.0.0.1:8000/stream", { isLocalDev: true })).toBe(
      "http://127.0.0.1:8000/stream",
    );
  });
});

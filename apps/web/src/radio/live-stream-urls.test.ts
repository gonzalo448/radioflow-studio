import { describe, expect, it } from "vitest";
import {
  radioFlowNowPlayingUrls,
  resolveStreamUrl,
  shouldReconnectOnMediaError,
  streamCandidates,
} from "./live-stream-urls";

const local = { isLocalDev: true };
const prod = { isLocalDev: false };

describe("resolveStreamUrl", () => {
  it("usa Icecast LAN en local sin override", () => {
    expect(resolveStreamUrl("", local)).toBe("/icecast-lan/radio.mp3");
  });

  it("usa URL pública en producción", () => {
    expect(resolveStreamUrl("", prod)).toMatch(/^https:\/\/azura\.radioritmonline\.com\/listen\//);
  });

  it("proxifica override LAN en local", () => {
    expect(resolveStreamUrl("http://192.168.1.26:8150/radio.mp3", local)).toBe("/icecast-lan/radio.mp3");
  });
});

describe("streamCandidates", () => {
  it("en local incluye proxies same-origin y no solo la pública", () => {
    const urls = streamCandidates("", local);
    expect(urls[0]).toBe("/icecast-lan/radio.mp3");
    expect(urls).toContain("/azura-proxy/listen/radioflow_studio/radio.mp3");
    expect(urls.some((u) => u.startsWith("https://"))).toBe(true);
  });
});

describe("radioFlowNowPlayingUrls", () => {
  it("en local solo same-origin (sin CORS a :4000)", () => {
    expect(radioFlowNowPlayingUrls(local, "http://127.0.0.1:4000/api/public/now-playing")).toEqual([
      "/api/public/now-playing",
    ]);
  });

  it("en prod permite URL absoluta del API", () => {
    const abs = "https://api.example.com/api/public/now-playing";
    expect(radioFlowNowPlayingUrls(prod, abs)).toEqual(["/api/public/now-playing", abs]);
  });
});

describe("shouldReconnectOnMediaError", () => {
  it("no reconecta si el usuario no quiere play", () => {
    expect(
      shouldReconnectOnMediaError({ wantPlay: false, paused: true, readyState: 0 }),
    ).toBe(false);
  });

  it("no reconecta si sigue reproduciendo con datos", () => {
    expect(
      shouldReconnectOnMediaError({ wantPlay: true, paused: false, readyState: 3 }),
    ).toBe(false);
  });

  it("reconecta si wantPlay y el audio está parado", () => {
    expect(
      shouldReconnectOnMediaError({ wantPlay: true, paused: true, readyState: 0 }),
    ).toBe(true);
  });
});

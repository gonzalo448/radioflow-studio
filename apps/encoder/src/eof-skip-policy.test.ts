import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideSkipAfterNaturalEnd, isNaturalFfmpegEnd } from "./eof-skip-policy.js";

describe("isNaturalFfmpegEnd", () => {
  it("solo exit:0 cuenta como fin natural", () => {
    assert.equal(isNaturalFfmpegEnd("exit:0"), true);
    assert.equal(isNaturalFfmpegEnd("exit:1"), false);
    assert.equal(isNaturalFfmpegEnd("spawn/child error"), false);
  });
});

describe("decideSkipAfterNaturalEnd", () => {
  it("omite skip si Cabina/headless ya avanzó", () => {
    assert.equal(
      decideSkipAfterNaturalEnd({
        finishedAbsNormalized: "C:\\media\\a.mp3",
        nowPlayingAbsNormalized: "C:\\media\\b.mp3",
        hasNowPlaying: true,
      }),
      "already_advanced",
    );
  });

  it("idle sin nowPlaying", () => {
    assert.equal(
      decideSkipAfterNaturalEnd({
        finishedAbsNormalized: "C:\\media\\a.mp3",
        nowPlayingAbsNormalized: null,
        hasNowPlaying: false,
      }),
      "idle",
    );
  });

  it("pide skip si sigue la misma pista", () => {
    assert.equal(
      decideSkipAfterNaturalEnd({
        finishedAbsNormalized: "C:\\media\\a.mp3",
        nowPlayingAbsNormalized: "C:\\media\\a.mp3",
        hasNowPlaying: true,
      }),
      "request_skip",
    );
    assert.equal(
      decideSkipAfterNaturalEnd({
        finishedAbsNormalized: "C:\\media\\a.mp3",
        nowPlayingAbsNormalized: null,
        hasNowPlaying: true,
      }),
      "request_skip",
    );
  });
});

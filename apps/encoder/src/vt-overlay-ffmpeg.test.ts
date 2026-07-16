import { playSegmentFadeDurationSec, type ApiVoiceTrackOverlaySpec } from "@radioflow/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVoiceTrackOverlayFilterComplex } from "./vt-overlay-ffmpeg.js";

describe("buildVoiceTrackOverlayFilterComplex", () => {
  it("incluye amix, adelay y duck enable", () => {
    const fc = buildVoiceTrackOverlayFilterComplex(
      {
        cueStartSec: 0,
        cueEndSec: 30,
        durationSec: 30,
        playbackGainDb: 0,
        cabCrossfadeSec: 4,
        cabReferenceGainDb: 0,
      },
      { overlayAtSec: 23, duckDb: 12, voiceTrackGainDb: 0 },
    );
    assert.match(fc, /amix=inputs=2:duration=first/);
    assert.match(fc, /adelay=23000\|23000/);
    assert.match(fc, /volume=0\.2512:enable=/);
    assert.match(fc, /\[0:a]/);
    assert.match(fc, /\[1:a]/);
  });

  it("solape de fade coincide con shared", () => {
    const fade = playSegmentFadeDurationSec(0, 30, 30, 4);
    const fc = buildVoiceTrackOverlayFilterComplex(
      {
        cueStartSec: 0,
        cueEndSec: 30,
        durationSec: 30,
        playbackGainDb: 0,
        cabCrossfadeSec: 4,
        cabFadeInSec: 4,
        cabFadeOutSec: 4,
        cabReferenceGainDb: 0,
      },
      { overlayAtSec: 20, duckDb: 12, voiceTrackGainDb: 0 },
    );
    assert.match(fc, new RegExp(`afade=t=in:st=0:d=${fade.toFixed(3)}`));
  });
});

import {
  buildPlaySegmentSpec,
  playSegmentCrossfadeOverlapSec,
  playSegmentFadeDurationSec,
  resolvePlaySegmentFades,
} from "@radioflow/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playSegmentKey } from "./play-segment-key.js";
import { buildVoiceTrackOverlayFilterComplex } from "./vt-overlay-ffmpeg.js";

describe("Smart Crossfade", () => {
  it("mantiene compatibilidad legacy y permite fades asimétricos", () => {
    assert.deepEqual(resolvePlaySegmentFades({ cabCrossfadeSec: 4 }), {
      fadeInSec: 4,
      fadeOutSec: 4,
      overlapSec: 4,
    });
    assert.deepEqual(
      resolvePlaySegmentFades({
        cabCrossfadeSec: 2,
        cabFadeInSec: 0,
        cabFadeOutSec: 3,
      }),
      { fadeInSec: 0, fadeOutSec: 3, overlapSec: 3 },
    );
  });

  it("respeta cero como desactivado y acota pistas cortas", () => {
    assert.equal(playSegmentCrossfadeOverlapSec(0, 30, 30, 0), 0);
    assert.equal(playSegmentFadeDurationSec(0, 30, 30, 0), 0);
    assert.equal(playSegmentCrossfadeOverlapSec(0, 0.5, 0.5, 2), 0.225);
  });

  it("propaga mix y fades independientes al contrato del encoder", () => {
    const segment = buildPlaySegmentSpec(
      {
        id: "asset-1",
        path: "music/track.mp3",
        cueStartSec: 1,
        cueEndSec: 11,
        durationSec: 12,
        playbackGainDb: -1.5,
      },
      {
        cabCrossfadeSec: 2,
        cabFadeInSec: 0,
        cabFadeOutSec: 3,
        cabReferenceGainDb: -2,
      },
    );

    assert.equal(segment.cabCrossfadeSec, 3);
    assert.equal(segment.cabFadeInSec, 0);
    assert.equal(segment.cabFadeOutSec, 3);
  });

  it("usa exactamente la misma clave para el segmento nuevo y el vigente", () => {
    const segment = {
      cueStartSec: 1,
      cueEndSec: 11,
      cabCrossfadeSec: 3,
      cabFadeInSec: 0,
      cabFadeOutSec: 3,
      playbackGainDb: -1.5,
      cabReferenceGainDb: -2,
    };
    const overlay = { voiceTrackAssetId: "vt-1", overlayAtSec: 8 };
    assert.equal(playSegmentKey(segment, overlay), playSegmentKey({ ...segment }, { ...overlay }));
    assert.notEqual(playSegmentKey(segment, overlay), playSegmentKey({ ...segment, cabFadeInSec: 1 }, overlay));
  });

  it("no genera filtros afade con duración cero", () => {
    const filter = buildVoiceTrackOverlayFilterComplex(
      {
        cueStartSec: 0,
        cueEndSec: 30,
        durationSec: 30,
        playbackGainDb: 0,
        cabCrossfadeSec: 2,
        cabFadeInSec: 0,
        cabFadeOutSec: 0,
        cabReferenceGainDb: 0,
      },
      { overlayAtSec: 20, duckDb: 12, voiceTrackGainDb: 0 },
    );
    assert.doesNotMatch(filter, /afade=/);
  });
});

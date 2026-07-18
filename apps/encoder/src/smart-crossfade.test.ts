import {
  buildPlaySegmentSpec,
  isSpotLikeAsset,
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
        cueEndSec: 191,
        durationSec: 192,
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

  it("detecta spots por género o ruta, no solo por duración corta", () => {
    assert.equal(isSpotLikeAsset({ genre: "Jingle Salsa", durationSec: 4 }), true);
    assert.equal(isSpotLikeAsset({ genre: "Jingles Salsa", durationSec: 3 }), true);
    assert.equal(isSpotLikeAsset({ genre: "time-announce", durationSec: null }), true);
    assert.equal(
      isSpotLikeAsset({ genre: null, path: "uploads/Jingles Salsa/id.mp3", durationSec: 4 }),
      true,
    );
    assert.equal(isSpotLikeAsset({ genre: "Salsa", durationSec: 12 }), false);
    assert.equal(isSpotLikeAsset({ genre: "Salsa", durationSec: 240 }), false);
    assert.equal(isSpotLikeAsset({ genre: "Salsa", durationSec: null }), false);
    assert.equal(isSpotLikeAsset(null), false);
  });

  it("los spots salen completos: sin mix ni fades en el contrato", () => {
    const segment = buildPlaySegmentSpec(
      {
        id: "jingle-1",
        path: "uploads/Jingles Salsa/jingle.mp3",
        genre: "Jingle Salsa",
        cueStartSec: 0,
        cueEndSec: 4,
        durationSec: 4,
        playbackGainDb: 0,
      },
      { cabCrossfadeSec: 2, cabFadeInSec: 2, cabFadeOutSec: 2, cabReferenceGainDb: 0 },
    );
    assert.equal(segment.cabCrossfadeSec, 0);
    assert.equal(segment.cabFadeInSec, 0);
    assert.equal(segment.cabFadeOutSec, 0);
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

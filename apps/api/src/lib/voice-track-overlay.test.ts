import { describe, expect, it } from "vitest";
import {
  buildVoiceTrackOverlaySpec,
  planVoiceTrackBridge,
  voiceTrackOverlayTriggerAt,
} from "@radioflow/shared";

const track = (id: string, path: string, dur = 60) => ({
  kind: "track",
  asset: {
    id,
    path,
    durationSec: dur,
    cueStartSec: 0,
    cueEndSec: dur,
    playbackGainDb: 0,
  },
});

const vt = (id: string, path: string) => ({
  kind: "voicetrack",
  asset: {
    id,
    path,
    durationSec: 8,
    cueStartSec: 0,
    cueEndSec: 8,
    playbackGainDb: 0,
  },
});

describe("C2 buildVoiceTrackOverlaySpec", () => {
  it("arma overlay track→VT→track", () => {
    const queue = [track("a", "a.mp3", 40), vt("v", "v.mp3"), track("b", "b.mp3", 50)];
    const overlay = buildVoiceTrackOverlaySpec(queue, 0, 4, { duckDb: 12 });
    expect(overlay).not.toBeNull();
    expect(overlay!.voiceTrackAssetId).toBe("v");
    expect(overlay!.nextMusicAssetId).toBe("b");
    expect(overlay!.skipCountOnEnd).toBe(2);
    expect(overlay!.overlayAtSec).toBeGreaterThan(0);
    expect(overlay!.duckDb).toBe(12);
  });

  it("no arma sin música después del VT", () => {
    const queue = [track("a", "a.mp3"), vt("v", "v.mp3")];
    expect(buildVoiceTrackOverlaySpec(queue, 0, 4)).toBeNull();
  });

  it("respeta enabled=false", () => {
    const queue = [track("a", "a.mp3"), vt("v", "v.mp3"), track("b", "b.mp3")];
    expect(buildVoiceTrackOverlaySpec(queue, 0, 4, { enabled: false })).toBeNull();
  });

  it("overlayAt coincide con trigger − cueStart", () => {
    const cues = { cueStartSec: 2, cueEndSec: 32 };
    const queue = [
      {
        kind: "track",
        asset: {
          id: "a",
          path: "a.mp3",
          cueStartSec: 2,
          cueEndSec: 32,
          durationSec: 32,
        },
      },
      vt("v", "v.mp3"),
      track("b", "b.mp3"),
    ];
    const plan = planVoiceTrackBridge(queue, 0, 4, cues);
    expect(plan).not.toBeNull();
    const trigger = voiceTrackOverlayTriggerAt(cues, plan!.outroWindowSec);
    const overlay = buildVoiceTrackOverlaySpec(queue, 0, 4);
    expect(overlay!.overlayAtSec).toBeCloseTo(trigger - 2, 2);
  });
});
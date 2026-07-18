import { describe, expect, it } from "vitest";
import type { ApiStationQueueItem } from "@radioflow/shared";
import {
  hasDeferredSpotBeforeNextTrack,
  isAnnounceOrDeferredQueueRow,
  logicalNextPlayableQueueRow,
} from "./playback-upcoming-order";

function trackRow(
  id: string,
  asset: { genre?: string | null; durationSec?: number | null },
): ApiStationQueueItem {
  return {
    id,
    position: 0,
    kind: "track",
    label: null,
    pauseSec: null,
    asset: {
      id: `a-${id}`,
      title: id,
      artist: null,
      path: `uploads/${id}.mp3`,
      ...asset,
    },
  } as ApiStationQueueItem;
}

describe("jingles de playlist como spots", () => {
  const song = trackRow("song", { genre: "Salsa", durationSec: 240 });
  const jingle = trackRow("jingle", { genre: "Jingle Salsa", durationSec: 4 });
  const shortId = trackRow("id-corto", { genre: "Jingle", durationSec: 8 });

  it("una pista corta o con género Jingle es spot", () => {
    expect(isAnnounceOrDeferredQueueRow(jingle)).toBe(true);
    expect(isAnnounceOrDeferredQueueRow(shortId)).toBe(true);
    expect(isAnnounceOrDeferredQueueRow(song)).toBe(false);
  });

  it("con jingle a continuación no hay prefetch (corte limpio, sin mezclar)", () => {
    const queue = [song, jingle, trackRow("song2", { genre: "Salsa", durationSec: 200 })];
    expect(hasDeferredSpotBeforeNextTrack(queue, 0)).toBe(true);
    expect(logicalNextPlayableQueueRow(queue, 0, [])).toBeUndefined();
  });

  it("entre canciones normales el crossfade sigue activo", () => {
    const queue = [song, trackRow("song2", { genre: "Salsa", durationSec: 200 })];
    expect(hasDeferredSpotBeforeNextTrack(queue, 0)).toBe(false);
    expect(logicalNextPlayableQueueRow(queue, 0, [])?.id).toBe("song2");
  });
});

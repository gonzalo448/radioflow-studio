import type { ApiPlaylistDetail } from "@radioflow/shared";
import { apiFetch } from "./api";
import { notifyStationRefresh } from "./local-audio-import";
import { queuePositionForPlaylistIndex } from "./playlist-queue-index";

/** Sincroniza la lista a cola y posiciona el voicetrack recién insertado al aire. */
export async function playPlaylistItemOnAir(opts: {
  token: string;
  playlistId: string;
  detail: ApiPlaylistDetail;
  assetId: string;
  refresh: () => Promise<void>;
  play: () => Promise<void>;
}): Promise<number | null> {
  const plIdx = opts.detail.items.findIndex((it) => it.asset?.id === opts.assetId);
  if (plIdx < 0) return null;

  await apiFetch("/api/station/queue-from-playlist", {
    method: "POST",
    token: opts.token,
    body: JSON.stringify({ playlistId: opts.playlistId, replace: true }),
  });

  const qPos = queuePositionForPlaylistIndex(opts.detail.items, plIdx);
  if (qPos > 0) {
    await apiFetch("/api/station", {
      method: "PATCH",
      token: opts.token,
      body: JSON.stringify({ currentPosition: qPos }),
    });
  }

  notifyStationRefresh();
  await opts.refresh();
  await opts.play();
  return plIdx;
}

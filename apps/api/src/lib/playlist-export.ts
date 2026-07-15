import { buildM3uPlaylist, buildPlsPlaylist } from "@radioflow/shared";
import type { QueueEntryKind } from "@radioflow/shared";

type ExportItem = {
  kind: string;
  label: string | null;
  pauseSec: number | null;
  asset: {
    path: string;
    title: string;
    artist: string | null;
    durationSec: number | null;
  } | null;
};

function trackTitle(asset: NonNullable<ExportItem["asset"]>): string {
  const artist = asset.artist?.trim();
  if (artist) return `${artist} - ${asset.title}`;
  return asset.title;
}

/** Ítems exportables (pistas y voicetracks; omite comandos y track_list). */
export function playlistItemsForExport(items: ExportItem[]): ExportItem[] {
  return items.filter((it) => {
    const k = it.kind as QueueEntryKind;
    return (k === "track" || k === "voicetrack") && it.asset?.path;
  });
}

export function buildPlaylistM3uExport(items: ExportItem[]): string {
  const tracks = playlistItemsForExport(items);
  return buildM3uPlaylist(
    tracks.map((it) => ({
      path: it.asset!.path,
      title: trackTitle(it.asset!),
      durationSec: it.asset!.durationSec ?? undefined,
    })),
  );
}

export function buildPlaylistPlsExport(items: ExportItem[]): string {
  const tracks = playlistItemsForExport(items);
  return buildPlsPlaylist(
    tracks.map((it) => ({
      path: it.asset!.path,
      title: trackTitle(it.asset!),
      durationSec: it.asset!.durationSec ?? undefined,
    })),
  );
}

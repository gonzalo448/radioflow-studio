import type { ApiStationAsset, ApiStationQueueItem, ApiStationState } from "@radioflow/shared";
import { isCommandPlaylistKind, queueEntryTitle as entryTitle } from "../lib/queue-entry-display";
import { logicalNextQueueRow } from "./playback-upcoming-order";

export type OnAirDisplay = {
  effectivePos: number;
  onAir: ApiStationAsset | null;
  prev: ApiStationAsset | null;
  nextRow: ApiStationQueueItem | undefined;
  /** Comando o fila sin pista (pausa, marcador). */
  commandEntry: ApiStationQueueItem | null;
};

/** Etiquetas de cinta superior alineadas con la pista que suena (incl. crossfade antes del skip en servidor). */
export function computeOnAirDisplay(
  state: ApiStationState | null,
  leadAssetIdOverride: string | null,
): OnAirDisplay {
  if (!state) {
    return { effectivePos: 0, onAir: null, prev: null, nextRow: undefined, commandEntry: null };
  }

  const q = state.queue;
  let pos = Math.max(0, state.station.currentPosition);
  if (q.length > 0 && pos >= q.length) {
    pos = 0;
  }
  const currentRow = q[pos];
  let commandEntry: ApiStationQueueItem | null =
    currentRow && isCommandPlaylistKind(currentRow.kind)
      ? currentRow
      : state.currentQueueEntry && isCommandPlaylistKind(state.currentQueueEntry.kind)
        ? state.currentQueueEntry
        : null;

  let onAir: ApiStationAsset | null =
    state.nowPlaying ??
    (currentRow && (currentRow.kind === "track" || currentRow.kind === "voicetrack") && currentRow.asset
      ? currentRow.asset
      : null);

  if (leadAssetIdOverride) {
    const idx = q.findIndex((row) => row.asset?.id === leadAssetIdOverride);
    if (idx >= 0) {
      pos = idx;
      const row = q[idx]!;
      onAir = row.asset;
      commandEntry = isCommandPlaylistKind(row.kind) ? row : null;
    } else {
      const row = q.find((r) => r.asset?.id === leadAssetIdOverride);
      if (row) {
        pos = q.indexOf(row);
        onAir = row.asset;
        commandEntry = isCommandPlaylistKind(row.kind) ? row : null;
      }
    }
  }

  let prev: ApiStationAsset | null = null;
  for (let i = pos - 1; i >= 0; i--) {
    const row = q[i];
    if (row?.kind === "track" || row?.kind === "voicetrack") {
      if (row.asset) {
        prev = row.asset;
        break;
      }
    }
  }

  const nextRow = logicalNextQueueRow(q, pos, state.playbackQueue ?? []);

  return { effectivePos: pos, onAir, prev, nextRow, commandEntry };
}

export function formatOnAirLabel(asset: ApiStationAsset | null | undefined): string {
  if (!asset) return "—";
  const artist = asset.artist?.trim();
  if (artist) return `${artist} · ${asset.title}`;
  return asset.title;
}

export function formatOnAirOrCommand(display: OnAirDisplay): string {
  if (display.commandEntry) {
    return entryTitle(display.commandEntry);
  }
  return formatOnAirLabel(display.onAir);
}

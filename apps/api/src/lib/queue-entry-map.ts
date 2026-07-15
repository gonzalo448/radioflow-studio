import type {
  ApiLibraryAsset,
  ApiPlaylistDetail,
  ApiPlaylistItem,
  ApiStationAsset,
  ApiStationQueueItem,
  QueueEntryKind,
} from "@radioflow/shared";
import { parseTrackListSpec } from "./expand-track-list.js";
import { parsePlaylistCmdSpec, parsePlaylistContainerSpec } from "./playlist-cmd-spec.js";

type AssetRow = {
  id: string;
  title: string;
  artist: string | null;
  path: string;
  coverPath?: string | null;
  playbackGainDb?: number;
  album?: string | null;
  genre?: string | null;
  mimeType?: string | null;
  durationSec?: number | null;
  releaseYear?: number | null;
  id3Comment?: string | null;
  audioBitrateKbps?: number | null;
  audioSampleRateHz?: number | null;
  audioChannels?: number | null;
  cueStartSec?: number | null;
  cueEndSec?: number | null;
};

export function mapAssetToStationAsset(asset: AssetRow): ApiStationAsset {
  return {
    id: asset.id,
    title: asset.title,
    artist: asset.artist,
    path: asset.path,
    coverPath: asset.coverPath ?? null,
    playbackGainDb: asset.playbackGainDb ?? 0,
    album: asset.album ?? null,
    genre: asset.genre ?? null,
    mimeType: asset.mimeType ?? null,
    durationSec: asset.durationSec ?? null,
    releaseYear: asset.releaseYear ?? null,
    id3Comment: asset.id3Comment ?? null,
    audioBitrateKbps: asset.audioBitrateKbps ?? null,
    audioSampleRateHz: asset.audioSampleRateHz ?? null,
    audioChannels: asset.audioChannels ?? null,
    cueStartSec: asset.cueStartSec ?? null,
    cueEndSec: asset.cueEndSec ?? null,
  };
}

export function mapAssetToLibraryAsset(asset: AssetRow): ApiLibraryAsset {
  return mapAssetToStationAsset(asset) as ApiLibraryAsset;
}

export function mapPlaylistItemRow(row: {
  id: string;
  position: number;
  kind: string;
  label: string | null;
  pauseSec: number | null;
  trackListSpec?: unknown;
  asset: AssetRow | null;
}): ApiPlaylistItem {
  const kind = row.kind as QueueEntryKind;
  let trackListSpec: ApiPlaylistItem["trackListSpec"] = null;
  if (kind === "track_list") trackListSpec = parseTrackListSpec(row.trackListSpec);
  else if (kind === "cmd") trackListSpec = parsePlaylistCmdSpec(row.trackListSpec);
  else if (kind === "container") trackListSpec = parsePlaylistContainerSpec(row.trackListSpec);
  return {
    id: row.id,
    position: row.position,
    kind,
    label: row.label,
    pauseSec: row.pauseSec,
    asset: row.asset ? mapAssetToLibraryAsset(row.asset) : null,
    trackListSpec,
  };
}

export function mapQueueItemRow(row: {
  id: string;
  position: number;
  kind: string;
  label: string | null;
  pauseSec: number | null;
  asset: AssetRow | null;
}): ApiStationQueueItem {
  const kind = row.kind as QueueEntryKind;
  return {
    id: row.id,
    position: row.position,
    kind,
    label: row.label,
    pauseSec: row.pauseSec,
    asset: row.asset ? mapAssetToStationAsset(row.asset) : null,
  };
}

export function mapPlaylistDetail(pl: {
  id: string;
  name: string;
  tabColor?: string | null;
  updatedAt?: Date;
  items: Parameters<typeof mapPlaylistItemRow>[0][];
}): ApiPlaylistDetail {
  return {
    id: pl.id,
    name: pl.name,
    tabColor: pl.tabColor ?? null,
    updatedAt: pl.updatedAt?.toISOString(),
    items: pl.items.map(mapPlaylistItemRow),
  };
}

export function commandLabel(kind: QueueEntryKind, label: string | null, pauseSec: number | null): string {
  if (kind === "pause") return label?.trim() || `Pausa ${pauseSec ?? 0}s`;
  if (kind === "marker") return label?.trim() || "Marcador";
  if (kind === "note") return label?.trim() || "Nota";
  if (kind === "voicetrack") return label?.trim() || "Voicetrack";
  if (kind === "hour_marker") return label?.trim() || "Marcador de hora";
  if (kind === "dtmf") return label?.trim() ? `DTMF ${label.trim()}` : "DTMF";
  if (kind === "track_list") return label?.trim() || "Lista de pistas";
  if (kind === "cmd") return label?.trim() || "Comando";
  if (kind === "container") return label?.trim() || "Container";
  return label?.trim() || "—";
}

/** Ítems con audio reproducible al sincronizar cola. */
export function isPlayableQueueEntryKind(kind: QueueEntryKind): boolean {
  return kind === "track" || kind === "voicetrack";
}

/** Notas, track_list y container no van al aire como ítem único (se expanden antes). */
export function shouldSyncPlaylistItemToQueue(kind: QueueEntryKind): boolean {
  return kind !== "note" && kind !== "track_list" && kind !== "container";
}

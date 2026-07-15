import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { assertAssetsPlayableInVault } from "../lib/library-vault.js";
import { writePlayLog } from "../lib/play-log.js";
import { parseTrackListSpec, resolveTrackListAssetIds } from "../lib/expand-track-list.js";
import { shouldSyncPlaylistItemToQueue } from "../lib/queue-entry-map.js";
import { encodeCmdQueueLabel, parsePlaylistCmdSpec, parsePlaylistContainerSpec } from "../lib/playlist-cmd-spec.js";
import type { QueueEntryKind } from "@radioflow/shared";
import { broadcastStationState } from "../realtime/station-hub.js";
import { resetHeadlessPlayoutSegment } from "./headless-playout.js";
import { ensureMainStation, getStationState, MAIN_STATION_ID } from "./station-state.js";
import { runAutoDjRefillTick } from "./autodj-refill.js";

export class SyncPlaylistError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "EMPTY",
  ) {
    super(message);
    this.name = "SyncPlaylistError";
  }
}

type ExpandedQueueRow = {
  kind: QueueEntryKind;
  assetId: string | null;
  label: string | null;
  pauseSec: number | null;
};

type RecentContext = {
  recentAssetIds: string[];
  recentArtists: string[];
};

type ExpandOpts = {
  env: Env;
  recentAssetIds: string[];
  recentArtists: string[];
  visitedPlaylists: Set<string>;
  depth: number;
};

const MAX_CONTAINER_DEPTH = 4;

async function loadRecentContext(stationId: string): Promise<RecentContext> {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) return { recentAssetIds: [], recentArtists: [] };

  const rows = await prisma.playQueueItem.findMany({
    where: {
      stationId,
      position: { lte: station.currentPosition },
      kind: { in: ["track", "voicetrack"] },
      assetId: { not: null },
    },
    orderBy: { position: "desc" },
    take: 250,
    select: { assetId: true, asset: { select: { artist: true } } },
  });

  const recentAssetIds: string[] = [];
  const recentArtists: string[] = [];
  for (const r of rows) {
    if (r.assetId) recentAssetIds.push(r.assetId);
    if (r.asset?.artist) recentArtists.push(r.asset.artist);
  }
  recentAssetIds.reverse();
  recentArtists.reverse();
  return { recentAssetIds, recentArtists };
}

async function expandPlaylistItemsToQueueRows(
  items: {
    id?: string;
    kind: string;
    assetId: string | null;
    label: string | null;
    pauseSec: number | null;
    trackListSpec: unknown;
  }[],
  opts: ExpandOpts,
): Promise<ExpandedQueueRow[]> {
  const rows: ExpandedQueueRow[] = [];

  for (const it of items) {
    const kind = it.kind as QueueEntryKind;

    if (kind === "track_list") {
      const spec = parseTrackListSpec(it.trackListSpec);
      if (!spec) continue;
      const ids = await resolveTrackListAssetIds(spec, opts.env, {
        recentAssetIds: opts.recentAssetIds,
        recentArtists: opts.recentArtists,
        playlistItemId: it.id,
      });
      if (ids.length === 0) continue;
      for (const assetId of ids) {
        rows.push({ kind: "track", assetId, label: null, pauseSec: null });
      }
      opts.recentAssetIds.push(...ids);
      continue;
    }

    if (kind === "container") {
      const cspec = parsePlaylistContainerSpec(it.trackListSpec);
      if (!cspec) continue;
      if (opts.depth >= MAX_CONTAINER_DEPTH) continue;
      if (opts.visitedPlaylists.has(cspec.playlistId)) continue;
      const nested = await prisma.playlist.findUnique({
        where: { id: cspec.playlistId },
        include: { items: { orderBy: { position: "asc" } } },
      });
      if (!nested) continue;
      const nextVisited = new Set(opts.visitedPlaylists);
      nextVisited.add(cspec.playlistId);
      const nestedRows = await expandPlaylistItemsToQueueRows(nested.items, {
        ...opts,
        visitedPlaylists: nextVisited,
        depth: opts.depth + 1,
      });
      rows.push(...nestedRows);
      continue;
    }

    if (kind === "cmd") {
      const spec = parsePlaylistCmdSpec(it.trackListSpec);
      if (!spec) continue;
      rows.push({
        kind: "cmd",
        assetId: null,
        label: encodeCmdQueueLabel(spec),
        pauseSec: null,
      });
      continue;
    }

    if (!shouldSyncPlaylistItemToQueue(kind)) continue;
    rows.push({
      kind,
      assetId: it.assetId,
      label: it.label,
      pauseSec: it.pauseSec,
    });
    if ((kind === "track" || kind === "voicetrack") && it.assetId) {
      opts.recentAssetIds.push(it.assetId);
    }
  }
  return rows;
}

/**
 * Volcado de playlist a la cola principal (misma lógica que POST /station/queue-from-playlist).
 */
export async function syncQueueFromPlaylist(opts: {
  playlistId: string;
  replace: boolean;
  scheduleBlockId?: string | null;
  userId: string | null;
  env: Env;
}) {
  await ensureMainStation();
  const recent = opts.replace ? { recentAssetIds: [], recentArtists: [] } : await loadRecentContext(MAIN_STATION_ID);
  const pl = await prisma.playlist.findUnique({
    where: { id: opts.playlistId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!pl) throw new SyncPlaylistError("Playlist no encontrada", "NOT_FOUND");

  const syncItems = pl.items.filter((it) => {
    const kind = it.kind as QueueEntryKind;
    return kind === "track_list" || kind === "container" || shouldSyncPlaylistItemToQueue(kind);
  });
  if (syncItems.length === 0) throw new SyncPlaylistError("La lista no tiene ítems reproducibles", "EMPTY");

  const expanded = await expandPlaylistItemsToQueueRows(syncItems, {
    env: opts.env,
    recentAssetIds: [...recent.recentAssetIds],
    recentArtists: [...recent.recentArtists],
    visitedPlaylists: new Set([opts.playlistId]),
    depth: 0,
  });
  if (expanded.length === 0) {
    throw new SyncPlaylistError(
      "No se pudo expandir la lista: revise que las «listas de pistas» tengan origen con canciones (carpeta o lista) y archivos en la bóveda",
      "EMPTY",
    );
  }

  const trackIds = expanded
    .filter((it) => (it.kind === "track" || it.kind === "voicetrack") && it.assetId)
    .map((it) => it.assetId!);
  await assertAssetsPlayableInVault(trackIds, opts.env);

  await prisma.$transaction(async (tx) => {
    if (opts.replace) {
      await tx.playQueueItem.deleteMany({ where: { stationId: MAIN_STATION_ID } });
      await tx.station.update({ where: { id: MAIN_STATION_ID }, data: { currentPosition: 0 } });
    }
    let pos = await tx.playQueueItem.count({ where: { stationId: MAIN_STATION_ID } });
    if (opts.replace) pos = 0;
    for (const it of expanded) {
      await tx.playQueueItem.create({
        data: {
          stationId: MAIN_STATION_ID,
          kind: it.kind,
          assetId: it.assetId,
          label: it.label,
          pauseSec: it.pauseSec,
          position: pos,
        },
      });
      pos += 1;
    }
    await tx.station.update({
      where: { id: MAIN_STATION_ID },
      data: {
        lastAppliedScheduleBlockId: opts.scheduleBlockId ?? null,
        autoDjActivePlaylistId: opts.playlistId,
        ...(opts.replace ? { autoDjPlaylistCursor: 0 } : {}),
      },
    });
  });

  resetHeadlessPlayoutSegment();

  void writePlayLog({
    action: "PLAYLIST_QUEUE_SYNC",
    userId: opts.userId,
    details: {
      playlistId: opts.playlistId,
      replace: opts.replace,
      count: expanded.length,
      scheduleBlockId: opts.scheduleBlockId ?? null,
      source: opts.userId ? "api" : "internal-scheduler",
    },
  });

  // Sembrar más pistas desde listas de pistas / playlist activa (RadioBOSS continuo).
  try {
    await runAutoDjRefillTick(opts.env);
  } catch {
    /* el sync ya dejó cola usable; el refill al skip cubre el resto */
  }

  void broadcastStationState();
  return getStationState();
}

import type { Env } from "../config.js";
import { prisma } from "../db.js";
import {
  autoDjTracksNeeded,
  countUpcomingPlayable,
  normalizeArtistForAutodj,
  resolveAutoDjMinUpcoming,
} from "../lib/autodj-buffer.js";
import { parseTrackListSpec, resolveTrackListAssetIds } from "../lib/expand-track-list.js";
import { shouldSyncPlaylistItemToQueue } from "../lib/queue-entry-map.js";
import { parsePlaylistContainerSpec } from "../lib/playlist-cmd-spec.js";
import { assertAssetsPlayableInVault } from "../lib/library-vault.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { ensureMainStation, MAIN_STATION_ID } from "./station-state.js";
import { getOrCreateSettings } from "./app-settings.js";
import { logAutomation } from "../lib/automation-log.js";

type RecentContext = { recentAssetIds: string[]; recentArtists: string[] };

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

/** Tick / on-demand: rellena la cola desde la playlist activa de Cabina / AutoDJ. */
export async function runAutoDjRefillTick(env: Env): Promise<{ added: number }> {
  await ensureMainStation();
  const station = await prisma.station.findUniqueOrThrow({ where: { id: MAIN_STATION_ID } });

  // Playlist activa = puesta en marcha desde Cabina (queue-from-playlist) o desde parrilla.
  // No depender de autoScheduleEnabled: eso controla bloques de horario, no el buffer de track lists.
  const playlistId = station.autoDjActivePlaylistId ?? null;
  if (!playlistId) return { added: 0 };

  const settings = await getOrCreateSettings();
  // Sin configurar (0): buffer corto para que una lista de pistas no agote la cola tras 1–2 canciones.
  const minUpcoming = resolveAutoDjMinUpcoming(settings.autoDjMinUpcomingTracks);

  const noRepeatArtistN = Math.max(0, Math.min(50, settings.autoDjNoRepeatArtistLastN ?? 0));
  const noRepeatTrackN = Math.max(0, Math.min(200, settings.autoDjNoRepeatTrackLastN ?? 0));

  const queue = await prisma.playQueueItem.findMany({
    where: { stationId: MAIN_STATION_ID },
    select: { position: true, kind: true },
    orderBy: { position: "asc" },
  });
  const upcoming = countUpcomingPlayable(queue, station.currentPosition);
  const need = autoDjTracksNeeded(upcoming, minUpcoming);
  if (need === 0) return { added: 0 };
  const pl = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!pl || pl.items.length === 0) return { added: 0 };

  const recent = await loadRecentContext(MAIN_STATION_ID);
  const recentAssetIds = [...recent.recentAssetIds];
  const recentArtists = [...recent.recentArtists];

  const recentAssetSet = noRepeatTrackN > 0 ? new Set(recentAssetIds.slice(-noRepeatTrackN)) : new Set<string>();
  const recentArtistSet =
    noRepeatArtistN > 0
      ? new Set(recentArtists.slice(-noRepeatArtistN).map((a) => normalizeArtistForAutodj(a)))
      : new Set<string>();
  const artistCache = new Map<string, string>(); // assetId -> normalized artist

  const startCursor = Math.max(0, station.autoDjPlaylistCursor ?? 0);
  let cursor = startCursor % pl.items.length;
  const expanded: { kind: "track" | "voicetrack"; assetId: string; label: string | null; pauseSec: number | null }[] = [];

  // Recorre la playlist en forma cíclica hasta conseguir N canciones.
  let safety = 0;
  while (expanded.length < need && safety < pl.items.length * 8) {
    safety += 1;
    const it = pl.items[cursor]!;
    cursor = (cursor + 1) % pl.items.length;

    const kind = it.kind as unknown as string;
    if (kind === "track_list") {
      const spec = parseTrackListSpec(it.trackListSpec);
      if (!spec) continue;
      const ids = await resolveTrackListAssetIds(spec, env, {
        recentAssetIds,
        recentArtists,
        playlistItemId: it.id,
      });
      // RadioBOSS: un paso por ítem Track List → 1 pista (o maxTracks si se configuró).
      for (const id of ids) {
        if (expanded.length >= need) break;
        expanded.push({ kind: "track", assetId: id, label: null, pauseSec: null });
        recentAssetIds.push(id);
      }
      continue;
    }

    if (kind === "container") {
      const cspec = parsePlaylistContainerSpec(it.trackListSpec);
      if (!cspec || cspec.playlistId === playlistId) continue;
      const nested = await prisma.playlist.findUnique({
        where: { id: cspec.playlistId },
        include: {
          items: {
            where: { kind: { in: ["track", "voicetrack"] }, assetId: { not: null } },
            orderBy: { position: "asc" },
            take: need,
          },
        },
      });
      if (!nested) continue;
      for (const nit of nested.items) {
        if (expanded.length >= need) break;
        if (!nit.assetId) continue;
        if (noRepeatTrackN > 0 && recentAssetSet.has(nit.assetId)) continue;
        expanded.push({
          kind: nit.kind as "track" | "voicetrack",
          assetId: nit.assetId,
          label: nit.label ?? null,
          pauseSec: nit.pauseSec ?? null,
        });
        recentAssetIds.push(nit.assetId);
        recentAssetSet.add(nit.assetId);
      }
      continue;
    }

    if (!shouldSyncPlaylistItemToQueue(kind as any)) continue;
    if ((kind === "track" || kind === "voicetrack") && it.assetId) {
      if (noRepeatTrackN > 0 && recentAssetSet.has(it.assetId)) {
        continue;
      }
      if (noRepeatArtistN > 0) {
        let norm = artistCache.get(it.assetId);
        if (!norm) {
          const row = await prisma.mediaAsset.findUnique({
            where: { id: it.assetId },
            select: { artist: true },
          });
          norm = normalizeArtistForAutodj(row?.artist);
          artistCache.set(it.assetId, norm);
        }
        if (recentArtistSet.has(norm)) {
          continue;
        }
        recentArtistSet.add(norm);
      }
      expanded.push({
        kind: kind as "track" | "voicetrack",
        assetId: it.assetId,
        label: it.label ?? null,
        pauseSec: it.pauseSec ?? null,
      });
      recentAssetIds.push(it.assetId);
      recentAssetSet.add(it.assetId);
    }
  }

  if (expanded.length === 0) return { added: 0 };
  await assertAssetsPlayableInVault(expanded.map((r) => r.assetId), env);

  await prisma.$transaction(async (tx) => {
    let pos = await tx.playQueueItem.count({ where: { stationId: MAIN_STATION_ID } });
    for (const r of expanded) {
      await tx.playQueueItem.create({
        data: {
          stationId: MAIN_STATION_ID,
          kind: r.kind,
          assetId: r.assetId,
          label: r.label,
          pauseSec: r.pauseSec,
          position: pos,
        },
      });
      pos += 1;
    }
    await tx.station.update({
      where: { id: MAIN_STATION_ID },
      data: { autoDjPlaylistCursor: cursor },
    });
  });

  logAutomation("autodj_refill", {
    playlistId,
    added: expanded.length,
    assetIds: expanded.map((r) => r.assetId),
    cursor,
  });

  void broadcastStationState();
  return { added: expanded.length };
}


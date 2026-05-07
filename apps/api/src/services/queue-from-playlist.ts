import { prisma } from "../db.js";
import { writePlayLog } from "../lib/play-log.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { ensureMainStation, getStationState, MAIN_STATION_ID } from "./station-state.js";

export class SyncPlaylistError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "EMPTY",
  ) {
    super(message);
    this.name = "SyncPlaylistError";
  }
}

/**
 * Volcado de playlist a la cola principal (misma lógica que POST /station/queue-from-playlist).
 */
export async function syncQueueFromPlaylist(opts: {
  playlistId: string;
  replace: boolean;
  scheduleBlockId?: string | null;
  userId: string | null;
}) {
  await ensureMainStation();
  const pl = await prisma.playlist.findUnique({
    where: { id: opts.playlistId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!pl) throw new SyncPlaylistError("Playlist no encontrada", "NOT_FOUND");
  if (pl.items.length === 0) throw new SyncPlaylistError("Playlist vacía", "EMPTY");

  await prisma.$transaction(async (tx) => {
    if (opts.replace) {
      await tx.playQueueItem.deleteMany({ where: { stationId: MAIN_STATION_ID } });
      await tx.station.update({ where: { id: MAIN_STATION_ID }, data: { currentPosition: 0 } });
    }
    let pos = await tx.playQueueItem.count({ where: { stationId: MAIN_STATION_ID } });
    if (opts.replace) pos = 0;
    for (const it of pl.items) {
      await tx.playQueueItem.create({
        data: { stationId: MAIN_STATION_ID, assetId: it.assetId, position: pos },
      });
      pos += 1;
    }
    await tx.station.update({
      where: { id: MAIN_STATION_ID },
      data: {
        lastAppliedScheduleBlockId: opts.scheduleBlockId ?? null,
      },
    });
  });

  void writePlayLog({
    action: "PLAYLIST_QUEUE_SYNC",
    userId: opts.userId,
    details: {
      playlistId: opts.playlistId,
      replace: opts.replace,
      count: pl.items.length,
      scheduleBlockId: opts.scheduleBlockId ?? null,
      source: opts.userId ? "api" : "internal-scheduler",
    },
  });
  void broadcastStationState();
  return getStationState();
}

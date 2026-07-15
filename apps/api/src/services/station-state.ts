import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { mapAssetToStationAsset, mapQueueItemRow } from "../lib/queue-entry-map.js";

export const MAIN_STATION_ID = "main";

export async function renumberPlaybackQueueTx(tx: Prisma.TransactionClient, stationId: string) {
  const rows = await tx.playbackQueueEntry.findMany({
    where: { stationId },
    orderBy: { sortIndex: "asc" },
  });
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sortIndex !== i) {
      await tx.playbackQueueEntry.update({ where: { id: rows[i].id }, data: { sortIndex: i } });
    }
  }
}

export async function ensureMainStation() {
  await prisma.station.upsert({
    where: { id: MAIN_STATION_ID },
    create: {
      id: MAIN_STATION_ID,
      mode: "AUTO",
      currentPosition: 0,
      autoScheduleEnabled: false,
      autoDjPlaylistCursor: 0,
      cabCrossfadeSec: 4,
      cabReferenceGainDb: 0,
      cabWebAudioEngine: true,
    },
    update: {},
  });
}

/** Si currentPosition quedó fuera de la cola (borrados, sync, etc.), la vuelve a un índice válido. */
export async function repairStationQueuePosition(stationId: string = MAIN_STATION_ID): Promise<number> {
  const station = await prisma.station.findUniqueOrThrow({ where: { id: stationId } });
  const count = await prisma.playQueueItem.count({ where: { stationId } });
  let next = station.currentPosition;
  if (count === 0) {
    next = 0;
  } else if (next < 0 || next >= count) {
    // Huérfana: reiniciar al inicio para que «Siguientes» y playNext vuelvan a tener sentido.
    next = 0;
  }
  if (next !== station.currentPosition) {
    await prisma.station.update({
      where: { id: stationId },
      data: { currentPosition: next },
    });
  }
  return next;
}

export async function getStationState() {
  await ensureMainStation();
  await repairStationQueuePosition(MAIN_STATION_ID);
  const station = await prisma.station.findUniqueOrThrow({ where: { id: MAIN_STATION_ID } });
  const queueRows = await prisma.playQueueItem.findMany({
    where: { stationId: MAIN_STATION_ID },
    orderBy: { position: "asc" },
    include: { asset: true },
  });
  const playbackQueue = await prisma.playbackQueueEntry.findMany({
    where: { stationId: MAIN_STATION_ID },
    orderBy: { sortIndex: "asc" },
    select: { id: true, playQueueItemId: true, sortIndex: true },
  });
  const queue = queueRows.map(mapQueueItemRow);
  const nowRow =
    station.currentPosition >= 0 && station.currentPosition < queueRows.length
      ? queueRows[station.currentPosition]
      : null;
  const currentQueueEntry = nowRow ? mapQueueItemRow(nowRow) : null;
  const nowPlaying =
    (nowRow?.kind === "track" || nowRow?.kind === "voicetrack") && nowRow.asset
      ? { ...mapAssetToStationAsset(nowRow.asset), queueItemId: nowRow.id }
      : null;
  return {
    station: {
      ...station,
      activePlaylistId: station.autoDjActivePlaylistId ?? null,
    },
    queue,
    playbackQueue,
    nowPlaying,
    currentQueueEntry,
  };
}

export type StationStatePayload = Awaited<ReturnType<typeof getStationState>>;

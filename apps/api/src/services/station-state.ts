import { prisma } from "../db.js";

export const MAIN_STATION_ID = "main";

export async function ensureMainStation() {
  await prisma.station.upsert({
    where: { id: MAIN_STATION_ID },
    create: { id: MAIN_STATION_ID, mode: "AUTO", currentPosition: 0, autoScheduleEnabled: false },
    update: {},
  });
}

export async function getStationState() {
  await ensureMainStation();
  const station = await prisma.station.findUniqueOrThrow({ where: { id: MAIN_STATION_ID } });
  const queue = await prisma.playQueueItem.findMany({
    where: { stationId: MAIN_STATION_ID },
    orderBy: { position: "asc" },
    include: { asset: true },
  });
  const now =
    station.currentPosition >= 0 && station.currentPosition < queue.length
      ? queue[station.currentPosition]
      : null;
  const nowPlaying = now ? { ...now.asset, queueItemId: now.id } : null;
  return { station, queue, nowPlaying };
}

export type StationStatePayload = Awaited<ReturnType<typeof getStationState>>;

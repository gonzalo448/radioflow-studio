import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError } from "../lib/app-error.js";
import { renumberPlaybackQueueTx } from "./station-state.js";

type AddToPlaybackQueueInput = {
  stationId: string;
  playQueueItemId: string;
};

type RemoveFromPlaybackQueueInput = {
  stationId: string;
  playQueueItemId: string;
};

export async function addToPlaybackQueue(input: AddToPlaybackQueueInput) {
  return prisma.$transaction(
    async (tx) => {
      const item = await tx.playQueueItem.findFirst({
        where: {
          id: input.playQueueItemId,
          stationId: input.stationId,
        },
      });

      if (!item) {
        throw new AppError("Ítem de cola no encontrado", {
          statusCode: 404,
          code: "QUEUE_ITEM_NOT_FOUND",
          details: {
            stationId: input.stationId,
            playQueueItemId: input.playQueueItemId,
          },
        });
      }

      const dup = await tx.playbackQueueEntry.findUnique({
        where: { playQueueItemId: input.playQueueItemId },
      });

      if (dup) {
        throw new AppError("La pista ya está en la cola de reproducción", {
          statusCode: 409,
          code: "PLAYBACK_QUEUE_DUPLICATE",
          details: { playQueueItemId: input.playQueueItemId },
        });
      }

      const last = await tx.playbackQueueEntry.findFirst({
        where: { stationId: input.stationId },
        orderBy: { sortIndex: "desc" },
      });

      return tx.playbackQueueEntry.create({
        data: {
          stationId: input.stationId,
          playQueueItemId: input.playQueueItemId,
          sortIndex: (last?.sortIndex ?? -1) + 1,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/** Quita de Cr.p. entradas ya emitidas o inexistentes (índice en parrilla ≤ posición actual). */
export async function pruneStalePlaybackQueueEntries(stationId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const station = await tx.station.findUniqueOrThrow({ where: { id: stationId } });
    const curPos = Math.max(0, station.currentPosition);
    const queue = await tx.playQueueItem.findMany({
      where: { stationId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const indexById = new Map(queue.map((row, index) => [row.id, index]));

    const entries = await tx.playbackQueueEntry.findMany({
      where: { stationId },
    });

    const stale = entries.filter((entry) => {
      const idx = indexById.get(entry.playQueueItemId);
      return idx === undefined || idx <= curPos;
    });

    if (stale.length === 0) return 0;

    await tx.playbackQueueEntry.deleteMany({
      where: { id: { in: stale.map((e) => e.id) } },
    });
    await renumberPlaybackQueueTx(tx, stationId);
    return stale.length;
  });
}

export async function removeFromPlaybackQueue(input: RemoveFromPlaybackQueueInput) {
  return prisma.$transaction(
    async (tx) => {
      const row = await tx.playbackQueueEntry.findUnique({
        where: { playQueueItemId: input.playQueueItemId },
      });

      if (!row) {
        throw new AppError("No está en la cola de reproducción", {
          statusCode: 404,
          code: "PLAYBACK_QUEUE_ENTRY_NOT_FOUND",
          details: { playQueueItemId: input.playQueueItemId },
        });
      }

      const removedSortIndex = row.sortIndex;

      await tx.playbackQueueEntry.delete({
        where: { id: row.id },
      });

      await tx.playbackQueueEntry.updateMany({
        where: {
          stationId: input.stationId,
          sortIndex: { gt: removedSortIndex },
        },
        data: {
          sortIndex: { decrement: 1 },
        },
      });

      return row;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

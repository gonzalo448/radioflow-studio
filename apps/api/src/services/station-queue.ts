import type { Prisma } from "@prisma/client";
import type { ApiStationQueueItem } from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { AppError } from "../lib/app-error.js";
import { assertAssetPlayableInVault } from "../lib/library-vault.js";
import { mapQueueItemRow } from "../lib/queue-entry-map.js";

type AppendInput = {
  stationId: string;
  assetId: string;
  playNext: boolean;
  env: Env;
};

type DeleteInput = {
  stationId: string;
  itemId: string;
};

function toQueueItem(row: {
  id: string;
  position: number;
  kind: string;
  label: string | null;
  pauseSec: number | null;
  asset: {
    id: string;
    title: string;
    artist: string | null;
    path: string;
    coverPath: string | null;
    playbackGainDb: number;
    album: string | null;
    genre: string | null;
    mimeType: string | null;
    durationSec: number | null;
    releaseYear: number | null;
    id3Comment: string | null;
    audioBitrateKbps: number | null;
    audioSampleRateHz: number | null;
    audioChannels: number | null;
  } | null;
}): ApiStationQueueItem {
  return mapQueueItemRow(row);
}

type AppendManyInput = {
  stationId: string;
  assetIds: string[];
  playNext: boolean;
  env: Env;
};

async function resolveInsertAt(
  tx: Prisma.TransactionClient,
  stationId: string,
  playNext: boolean,
): Promise<number> {
  const stationRow = await tx.station.findUniqueOrThrow({ where: { id: stationId } });
  const count = await tx.playQueueItem.count({ where: { stationId } });
  if (playNext && count > 0) {
    const cur = stationRow.currentPosition;
    // Posición fuera de cola: poner el bloque al frente para que aparezca en «Siguientes».
    if (cur < 0 || cur >= count) {
      await tx.station.update({ where: { id: stationId }, data: { currentPosition: 0 } });
      return 0;
    }
    return cur + 1;
  }
  return count;
}

export async function appendToStationQueue(input: AppendInput): Promise<ApiStationQueueItem> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: input.assetId } });
  if (!asset) {
    throw new AppError("Pista no encontrada en la librería", {
      statusCode: 404,
      code: "ASSET_NOT_FOUND",
      details: { assetId: input.assetId },
    });
  }

  assertAssetPlayableInVault(asset, input.env);

  return prisma.$transaction(async (tx) => {
    const insertAt = await resolveInsertAt(tx, input.stationId, input.playNext);

    const toShift = await tx.playQueueItem.findMany({
      where: { stationId: input.stationId, position: { gte: insertAt } },
      orderBy: { position: "desc" },
    });
    for (const row of toShift) {
      await tx.playQueueItem.update({
        where: { id: row.id },
        data: { position: row.position + 1 },
      });
    }

    const created = await tx.playQueueItem.create({
      data: {
        stationId: input.stationId,
        assetId: input.assetId,
        position: insertAt,
      },
      include: { asset: true },
    });

    return toQueueItem(created);
  });
}

/** Inserta varias pistas en un solo turno (orden conservado) y un único shift de posiciones. */
export async function appendManyToStationQueue(input: AppendManyInput): Promise<ApiStationQueueItem[]> {
  if (input.assetIds.length === 0) return [];

  for (const assetId of input.assetIds) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new AppError("Pista no encontrada en la librería", {
        statusCode: 404,
        code: "ASSET_NOT_FOUND",
        details: { assetId },
      });
    }
    assertAssetPlayableInVault(asset, input.env);
  }

  return prisma.$transaction(async (tx) => {
    const insertAt = await resolveInsertAt(tx, input.stationId, input.playNext);
    const n = input.assetIds.length;

    const toShift = await tx.playQueueItem.findMany({
      where: { stationId: input.stationId, position: { gte: insertAt } },
      orderBy: { position: "desc" },
    });
    for (const row of toShift) {
      await tx.playQueueItem.update({
        where: { id: row.id },
        data: { position: row.position + n },
      });
    }

    const created: ApiStationQueueItem[] = [];
    for (let i = 0; i < input.assetIds.length; i++) {
      const row = await tx.playQueueItem.create({
        data: {
          stationId: input.stationId,
          assetId: input.assetIds[i]!,
          position: insertAt + i,
        },
        include: { asset: true },
      });
      created.push(toQueueItem(row));
    }
    return created;
  });
}

export async function deleteFromStationQueue(input: DeleteInput): Promise<{ assetId: string | null }> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.playQueueItem.findFirst({
      where: { id: input.itemId, stationId: input.stationId },
    });

    if (!row) {
      throw new AppError("Ítem de cola no encontrado", {
        statusCode: 404,
        code: "QUEUE_ITEM_NOT_FOUND",
        details: { itemId: input.itemId },
      });
    }

    const removedPosition = row.position;
    const assetId = row.assetId;

    await tx.playQueueItem.delete({ where: { id: row.id } });

    const after = await tx.playQueueItem.findMany({
      where: { stationId: input.stationId, position: { gt: removedPosition } },
      orderBy: { position: "asc" },
    });
    for (const item of after) {
      await tx.playQueueItem.update({
        where: { id: item.id },
        data: { position: item.position - 1 },
      });
    }

    const station = await tx.station.findUniqueOrThrow({ where: { id: input.stationId } });
    const count = await tx.playQueueItem.count({ where: { stationId: input.stationId } });
    let nextPos = station.currentPosition;
    if (removedPosition < station.currentPosition) {
      nextPos = Math.max(0, station.currentPosition - 1);
    } else if (count === 0) {
      nextPos = 0;
    } else if (station.currentPosition >= count) {
      nextPos = Math.max(0, count - 1);
    }

    if (nextPos !== station.currentPosition) {
      await tx.station.update({
        where: { id: input.stationId },
        data: { currentPosition: nextPos },
      });
    }

    return { assetId };
  });
}

/**
 * Borra de la cola todo lo que ya sonó (posiciones ≤ finishedPosition),
 * renumera el resto desde 0 y deja currentPosition en 0 (la nueva pista al aire).
 * Así «Siguientes» no acumula historial ni locuciones/intros ya emitidas.
 */
export async function removePlayedQueueUpTo(
  stationId: string,
  finishedPosition: number,
): Promise<{ removed: number; remaining: number }> {
  if (finishedPosition < 0) {
    const remaining = await prisma.playQueueItem.count({ where: { stationId } });
    return { removed: 0, remaining };
  }

  return prisma.$transaction(async (tx) => {
    const doomed = await tx.playQueueItem.findMany({
      where: { stationId, position: { lte: finishedPosition } },
      select: { id: true },
    });
    if (doomed.length > 0) {
      await tx.playQueueItem.deleteMany({
        where: { id: { in: doomed.map((r) => r.id) } },
      });
    }

    const remaining = await tx.playQueueItem.findMany({
      where: { stationId },
      orderBy: { position: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i]!.position !== i) {
        await tx.playQueueItem.update({
          where: { id: remaining[i]!.id },
          data: { position: i },
        });
      }
    }

    await tx.station.update({
      where: { id: stationId },
      data: { currentPosition: 0 },
    });

    return { removed: doomed.length, remaining: remaining.length };
  });
}

/** Inserta un bloque de spots justo después de la pista al aire (o al inicio si la cola está vacía). */
export async function insertBreakAfterCurrent(
  stationId: string,
  assetIds: string[],
  env: Env,
): Promise<number> {
  if (assetIds.length === 0) return 0;

  for (const assetId of assetIds) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new AppError("Spot publicitario no encontrado", {
        statusCode: 404,
        code: "ASSET_NOT_FOUND",
        details: { assetId },
      });
    }
    assertAssetPlayableInVault(asset, env);
  }

  await prisma.$transaction(async (tx) => {
    const station = await tx.station.findUniqueOrThrow({ where: { id: stationId } });
    const count = await tx.playQueueItem.count({ where: { stationId } });
    let insertAt = 0;
    if (count > 0) {
      insertAt = Math.min(Math.max(0, station.currentPosition), count - 1) + 1;
    }

    const toShift = await tx.playQueueItem.findMany({
      where: { stationId, position: { gte: insertAt } },
      orderBy: { position: "desc" },
    });
    for (const row of toShift) {
      await tx.playQueueItem.update({
        where: { id: row.id },
        data: { position: row.position + assetIds.length },
      });
    }

    for (let i = 0; i < assetIds.length; i++) {
      await tx.playQueueItem.create({
        data: { stationId, assetId: assetIds[i]!, position: insertAt + i },
      });
    }
  });

  return assetIds.length;
}

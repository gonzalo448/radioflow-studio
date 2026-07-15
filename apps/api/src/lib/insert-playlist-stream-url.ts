import { prisma } from "../db.js";
import { createOrReuseStreamUrlAsset } from "./create-stream-url-asset.js";
import { mapPlaylistDetail } from "./queue-entry-map.js";

export type InsertPlaylistStreamUrlInput = {
  playlistId: string;
  url: string;
  title?: string;
  artist?: string;
  durationSec?: number;
  insertAfterItemId?: string | null;
};

export async function insertPlaylistStreamUrlItem(input: InsertPlaylistStreamUrlInput) {
  const pl = await prisma.playlist.findUnique({ where: { id: input.playlistId } });
  if (!pl) return null;

  const asset = await createOrReuseStreamUrlAsset({
    url: input.url,
    title: input.title,
    artist: input.artist,
    durationSec: input.durationSec,
  });

  const items = await prisma.playlistItem.findMany({
    where: { playlistId: input.playlistId },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });

  let insertPosition = items.length;
  if (input.insertAfterItemId) {
    const idx = items.findIndex((i) => i.id === input.insertAfterItemId);
    if (idx >= 0) insertPosition = idx + 1;
  }

  await prisma.$transaction(async (tx) => {
    const toShift = items.filter((i) => i.position >= insertPosition);
    for (let i = toShift.length - 1; i >= 0; i--) {
      const row = toShift[i]!;
      await tx.playlistItem.update({
        where: { id: row.id },
        data: { position: row.position + 1 },
      });
    }
    await tx.playlistItem.create({
      data: {
        playlistId: input.playlistId,
        assetId: asset.id,
        position: insertPosition,
        kind: "track",
      },
    });
  });

  const full = await prisma.playlist.findUnique({
    where: { id: input.playlistId },
    include: { items: { include: { asset: true }, orderBy: { position: "asc" } } },
  });
  if (!full) return null;
  return mapPlaylistDetail(full);
}

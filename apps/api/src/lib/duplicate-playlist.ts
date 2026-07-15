import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { mapPlaylistDetail } from "./queue-entry-map.js";

/** Duplica una playlist con todos sus ítems (RB-004). */
export async function duplicatePlaylist(sourceId: string, newName: string) {
  const source = await prisma.playlist.findUnique({
    where: { id: sourceId },
    include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
  });
  if (!source) return null;

  return prisma.$transaction(async (tx) => {
    const created = await tx.playlist.create({ data: { name: newName.trim() } });
    for (const item of source.items) {
      await tx.playlistItem.create({
        data: {
          playlistId: created.id,
          position: item.position,
          kind: item.kind,
          assetId: item.assetId,
          label: item.label,
          pauseSec: item.pauseSec,
          ...(item.trackListSpec != null
            ? { trackListSpec: item.trackListSpec as Prisma.InputJsonValue }
            : {}),
        },
      });
    }
    const full = await tx.playlist.findUnique({
      where: { id: created.id },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
    return full ? mapPlaylistDetail(full) : null;
  });
}

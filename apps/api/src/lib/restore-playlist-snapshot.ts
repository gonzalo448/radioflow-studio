import type { Prisma, QueueEntryKind } from "@prisma/client";
import { prisma } from "../db.js";
import { mapPlaylistDetail } from "./queue-entry-map.js";

export type PlaylistSnapshotItem = {
  kind: string;
  assetId?: string | null;
  label?: string | null;
  pauseSec?: number | null;
  trackListSpec?: unknown;
};

/** Reemplaza todos los ítems de una playlist (undo/redo estilo RadioBOSS). */
export async function restorePlaylistSnapshot(playlistId: string, items: PlaylistSnapshotItem[]) {
  const pl = await prisma.playlist.findUnique({ where: { id: playlistId } });
  if (!pl) return null;

  return prisma.$transaction(async (tx) => {
    await tx.playlistItem.deleteMany({ where: { playlistId } });
    for (let position = 0; position < items.length; position++) {
      const it = items[position]!;
      await tx.playlistItem.create({
        data: {
          playlistId,
          position,
          kind: it.kind as QueueEntryKind,
          assetId: it.assetId ?? null,
          label: it.label ?? null,
          pauseSec: it.pauseSec ?? null,
          ...(it.trackListSpec != null ? { trackListSpec: it.trackListSpec as Prisma.InputJsonValue } : {}),
        },
      });
    }
    const full = await tx.playlist.findUnique({
      where: { id: playlistId },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
    return full ? mapPlaylistDetail(full) : null;
  });
}

export function snapshotFromPlaylistItems(
  items: Array<{
    kind: string;
    assetId?: string | null;
    asset?: { id: string } | null;
    label?: string | null;
    pauseSec?: number | null;
    trackListSpec?: unknown;
  }>,
): PlaylistSnapshotItem[] {
  return items.map((it) => ({
    kind: it.kind,
    assetId: it.assetId ?? it.asset?.id ?? null,
    label: it.label ?? null,
    pauseSec: it.pauseSec ?? null,
    trackListSpec: it.trackListSpec ?? null,
  }));
}

import { prisma } from "../db.js";
import type { Prisma } from "@prisma/client";
import type { ApiTrackListSpec } from "@radioflow/shared";
import { mapPlaylistDetail } from "./queue-entry-map.js";

export async function insertPlaylistTrackListItem(opts: {
  playlistId: string;
  spec: ApiTrackListSpec;
  insertAfterItemId?: string | null;
}) {
  const pl = await prisma.playlist.findUnique({ where: { id: opts.playlistId } });
  if (!pl) return null;

  let defaultLabel = `Lista: ${opts.spec.value.split("/").filter(Boolean).pop() ?? opts.spec.value}`;
  if (opts.spec.source === "genre") defaultLabel = `Lista: ${opts.spec.value}`;
  else if (opts.spec.source === "category") defaultLabel = `Cat.: ${opts.spec.value}`;
  else if (opts.spec.source === "artist") {
    defaultLabel = `Lista: ${opts.spec.value === "__none__" ? "Sin artista" : opts.spec.value}`;
  } else if (opts.spec.source === "playlist") {
    const src = await prisma.playlist.findUnique({
      where: { id: opts.spec.value },
      select: { name: true },
    });
    defaultLabel = src?.name ? `Lista de pistas: ${src.name}` : "Lista de pistas";
  } else if (opts.spec.source === "folder") {
    defaultLabel = `Lista: ${opts.spec.value.split("/").filter(Boolean).pop() ?? opts.spec.value}`;
  }

  const label = opts.spec.label?.trim() || defaultLabel;

  return prisma.$transaction(async (tx) => {
    const items = await tx.playlistItem.findMany({
      where: { playlistId: opts.playlistId },
      orderBy: { position: "asc" },
    });

    let insertAt = items.length;
    if (opts.insertAfterItemId) {
      const after = items.find((i) => i.id === opts.insertAfterItemId);
      if (after) insertAt = after.position + 1;
    }

    const toShift = items.filter((i) => i.position >= insertAt).sort((a, b) => b.position - a.position);
    for (const row of toShift) {
      await tx.playlistItem.update({
        where: { id: row.id },
        data: { position: row.position + 1 },
      });
    }

    await tx.playlistItem.create({
      data: {
        playlistId: opts.playlistId,
        kind: "track_list",
        label,
        trackListSpec: opts.spec as unknown as Prisma.InputJsonValue,
        position: insertAt,
      },
    });

    const full = await tx.playlist.findUnique({
      where: { id: opts.playlistId },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
    return full ? mapPlaylistDetail(full) : null;
  });
}

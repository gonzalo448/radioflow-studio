import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { assertAssetsPlayableInVault } from "./library-vault.js";

export async function transferPlaylistItems(opts: {
  targetPlaylistId: string;
  sourcePlaylistId: string;
  itemIds: string[];
  mode: "move" | "copy";
  env: Env;
}) {
  const { targetPlaylistId, sourcePlaylistId, itemIds, mode, env } = opts;
  if (targetPlaylistId === sourcePlaylistId) {
    throw new Error("Origen y destino son la misma lista");
  }
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) throw new Error("Sin ítems para transferir");

  const sourceItems = await prisma.playlistItem.findMany({
    where: { playlistId: sourcePlaylistId, id: { in: uniqueIds } },
    orderBy: { position: "asc" },
    include: { asset: true },
  });
  if (sourceItems.length !== uniqueIds.length) {
    throw new Error("Uno o más ítems no pertenecen a la lista origen");
  }

  const assetIds = sourceItems
    .filter((i) => (i.kind === "track" || i.kind === "voicetrack") && i.assetId)
    .map((i) => i.assetId!);
  if (assetIds.length > 0) {
    await assertAssetsPlayableInVault(assetIds, env);
  }

  return prisma.$transaction(async (tx) => {
    const target = await tx.playlist.findUnique({ where: { id: targetPlaylistId } });
    const source = await tx.playlist.findUnique({ where: { id: sourcePlaylistId } });
    if (!target || !source) throw new Error("Lista no encontrada");

    const last = await tx.playlistItem.findFirst({
      where: { playlistId: targetPlaylistId },
      orderBy: { position: "desc" },
    });
    let pos = (last?.position ?? -1) + 1;
    await tx.playlistItem.createMany({
      data: sourceItems.map((item, i) => ({
        playlistId: targetPlaylistId,
        kind: item.kind,
        assetId: item.assetId,
        label: item.label,
        pauseSec: item.pauseSec,
        trackListSpec: item.trackListSpec ?? undefined,
        position: pos + i,
      })),
    });

    if (mode === "move") {
      await tx.playlistItem.deleteMany({
        where: { playlistId: sourcePlaylistId, id: { in: uniqueIds } },
      });
      const rest = await tx.playlistItem.findMany({
        where: { playlistId: sourcePlaylistId },
        orderBy: { position: "asc" },
      });
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].position !== i) {
          await tx.playlistItem.update({ where: { id: rest[i].id }, data: { position: i } });
        }
      }
    }

    return tx.playlist.findUnique({
      where: { id: targetPlaylistId },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
  });
}

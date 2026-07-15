import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { assertAssetPlayableInVault } from "./library-vault.js";
import { mapPlaylistDetail } from "./queue-entry-map.js";

export async function insertPlaylistVoicetrackItem(
  opts: {
    playlistId: string;
    assetId: string;
    label?: string;
    title?: string;
    insertAfterItemId?: string | null;
  },
  env: Env,
) {
  const pl = await prisma.playlist.findUnique({ where: { id: opts.playlistId } });
  if (!pl) return null;

  const asset = await prisma.mediaAsset.findUnique({ where: { id: opts.assetId } });
  if (!asset) return null;

  assertAssetPlayableInVault(asset, env);

  const label = opts.label?.trim() || null;
  const title = opts.title?.trim();

  return prisma.$transaction(async (tx) => {
    if (title) {
      await tx.mediaAsset.update({
        where: { id: opts.assetId },
        data: { title, artist: asset.artist?.trim() || "Voicetrack" },
      });
    }

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
        kind: "voicetrack",
        assetId: opts.assetId,
        label,
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

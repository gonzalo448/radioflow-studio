import type { Env } from "../config.js";
import { prisma } from "../db.js";
import {
  mediaAssetWhereFromLibraryFilters,
  type LibraryAssetListFilters,
} from "./library-list-filters.js";
import { assertAssetsPlayableInVault } from "./library-vault.js";

const FILL_PAGE = 5000;

export async function listLibraryAssetIdsForFill(
  filters: LibraryAssetListFilters,
  env: Env,
): Promise<{ ids: string[]; count: number }> {
  const ids: string[] = [];
  let skip = 0;
  for (;;) {
    const page = await prisma.mediaAsset.findMany({
      where: mediaAssetWhereFromLibraryFilters(filters),
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip,
      take: FILL_PAGE,
      select: { id: true },
    });
    if (page.length === 0) break;
    ids.push(...page.map((a) => a.id));
    skip += page.length;
    if (page.length < FILL_PAGE) break;
  }
  if (ids.length === 0) return { ids: [], count: 0 };
  await assertAssetsPlayableInVault(ids, env);
  return { ids, count: ids.length };
}

export async function replacePlaylistItemsWithAssets(
  playlistId: string,
  assetIds: string[],
  renameTo?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    await tx.playlistItem.deleteMany({ where: { playlistId } });
    if (assetIds.length > 0) {
      // createMany en lotes para no saturar SQLite/Postgres con un solo statement enorme
      const CHUNK = 1000;
      for (let i = 0; i < assetIds.length; i += CHUNK) {
        const slice = assetIds.slice(i, i + CHUNK);
        await tx.playlistItem.createMany({
          data: slice.map((assetId, j) => ({ playlistId, assetId, position: i + j })),
        });
      }
    }
    if (renameTo?.trim()) {
      await tx.playlist.update({ where: { id: playlistId }, data: { name: renameTo.trim() } });
    }
    return tx.playlist.findUnique({
      where: { id: playlistId },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
  });
}

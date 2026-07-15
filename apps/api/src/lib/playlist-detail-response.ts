import { prisma } from "../db.js";
import { mapPlaylistDetail } from "./queue-entry-map.js";

type PlaylistRow = {
  id: string;
  name: string;
  tabColor?: string | null;
  updatedAt: Date;
  rotationResetAt?: Date | null;
  createdAt: Date;
  items: Array<{ assetId?: string | null } & Parameters<typeof mapPlaylistDetail>[0]["items"][number]>;
};

export async function buildPlaylistDetailResponse(pl: PlaylistRow) {
  const detail = mapPlaylistDetail(pl);
  const since = pl.rotationResetAt ?? pl.createdAt;
  const assetIds = [...new Set(pl.items.map((i) => i.assetId).filter(Boolean))] as string[];
  let playedAssetIds: string[] = [];
  if (assetIds.length > 0) {
    const logs = await prisma.playLog.findMany({
      where: {
        assetId: { in: assetIds },
        createdAt: { gte: since },
        action: "SKIP",
      },
      select: { assetId: true },
      distinct: ["assetId"],
    });
    playedAssetIds = logs.map((l) => l.assetId).filter((x): x is string => Boolean(x));
  }
  return {
    ...detail,
    rotationResetAt: (pl.rotationResetAt ?? pl.createdAt).toISOString(),
    playedAssetIds,
  };
}

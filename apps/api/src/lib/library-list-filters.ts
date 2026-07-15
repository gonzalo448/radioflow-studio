import type { Prisma } from "@prisma/client";

export type LibraryAssetListFilters = {
  q?: string;
  genre?: string;
  artist?: string;
  album?: string;
  pathPrefix?: string;
};

/** Filtros compartidos entre GET /library/assets y creación de playlists desde la biblioteca. */
export function mediaAssetWhereFromLibraryFilters(
  raw: LibraryAssetListFilters,
): Prisma.MediaAssetWhereInput {
  const q = (raw.q ?? "").trim();
  const genre = (raw.genre ?? "").trim();
  const artist = (raw.artist ?? "").trim();
  const album = (raw.album ?? "").trim();
  const pathPrefix = (raw.pathPrefix ?? "").trim().replace(/\\/g, "/");

  return {
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { artist: { contains: q, mode: "insensitive" } },
            { album: { contains: q, mode: "insensitive" } },
            { semanticNote: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(genre ? { genre: { equals: genre, mode: "insensitive" } } : {}),
    ...(artist === "__none__"
      ? { OR: [{ artist: null }, { artist: "" }] }
      : artist
        ? { artist: { equals: artist, mode: "insensitive" } }
        : {}),
    ...(album ? { album: { equals: album, mode: "insensitive" } } : {}),
    ...(pathPrefix
      ? {
          path: {
            startsWith: pathPrefix.endsWith("/") ? pathPrefix : `${pathPrefix}/`,
          },
        }
      : {}),
  };
}

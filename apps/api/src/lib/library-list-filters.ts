import type { Prisma } from "@prisma/client";
import { containsCi, equalsCi } from "./prisma-string-filter.js";

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
            { title: containsCi(q) },
            { artist: containsCi(q) },
            { album: containsCi(q) },
            { semanticNote: containsCi(q) },
          ],
        }
      : {}),
    ...(genre ? { genre: equalsCi(genre) } : {}),
    ...(artist === "__none__"
      ? { OR: [{ artist: null }, { artist: "" }] }
      : artist
        ? { artist: equalsCi(artist) }
        : {}),
    ...(album ? { album: equalsCi(album) } : {}),
    ...(pathPrefix
      ? {
          path: {
            startsWith: pathPrefix.endsWith("/") ? pathPrefix : `${pathPrefix}/`,
          },
        }
      : {}),
  };
}

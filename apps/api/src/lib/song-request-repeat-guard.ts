import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import { equalsCi } from "./prisma-string-filter.js";

export class SongRequestRepeatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongRequestRepeatError";
  }
}

/** RB-071: bloquea pedidos duplicados recientes por artista o título. */
export async function assertSongRequestNotDuplicate(opts: {
  title: string;
  artist?: string | null;
}): Promise<void> {
  const settings = await getOrCreateSettings();
  const titleMin = settings.songRequestTitleCooldownMin ?? 0;
  const artistMin = settings.songRequestArtistCooldownMin ?? 0;
  if (titleMin <= 0 && artistMin <= 0) return;

  const title = opts.title.trim();
  const artist = opts.artist?.trim();

  if (titleMin > 0 && title) {
    const since = new Date(Date.now() - titleMin * 60_000);
    const dup = await prisma.songRequest.findFirst({
      where: {
        title: equalsCi(title),
        createdAt: { gte: since },
        status: { not: "rejected" },
      },
      orderBy: { createdAt: "desc" },
    });
    if (dup) {
      throw new SongRequestRepeatError(
        `Ya hay un pedido reciente con ese título. Espere ${titleMin} min antes de repetir.`,
      );
    }
  }

  if (artistMin > 0 && artist) {
    const since = new Date(Date.now() - artistMin * 60_000);
    const dup = await prisma.songRequest.findFirst({
      where: {
        artist: equalsCi(artist),
        createdAt: { gte: since },
        status: { not: "rejected" },
      },
      orderBy: { createdAt: "desc" },
    });
    if (dup) {
      throw new SongRequestRepeatError(
        `Ya hay un pedido reciente de ese artista. Espere ${artistMin} min antes de repetir.`,
      );
    }
  }
}

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db.js";
import {
  guessMimeFromStreamUrl,
  normalizeRemoteStreamUrl,
  titleFromStreamUrl,
} from "./remote-stream-path.js";

export type CreateStreamUrlAssetInput = {
  url: string;
  title?: string;
  artist?: string;
  durationSec?: number;
};

/** Crea o reutiliza un MediaAsset cuyo path es la URL remota. */
export async function createOrReuseStreamUrlAsset(
  input: CreateStreamUrlAssetInput,
  db: PrismaClient = defaultPrisma,
) {
  const path = normalizeRemoteStreamUrl(input.url);
  const existing = await db.mediaAsset.findFirst({ where: { path } });
  if (existing) return existing;

  return db.mediaAsset.create({
    data: {
      title: titleFromStreamUrl(path, input.title),
      artist: input.artist?.trim() || null,
      path,
      mimeType: guessMimeFromStreamUrl(path),
      ...(input.durationSec != null && input.durationSec > 0 ? { durationSec: input.durationSec } : {}),
    },
  });
}

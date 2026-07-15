import { parseM3uPlaylist, parsePlsPlaylist } from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { createOrReuseStreamUrlAsset } from "./create-stream-url-asset.js";
import { mapPlaylistDetail } from "./queue-entry-map.js";
import { isRemoteStreamPath, normalizeRemoteStreamUrl } from "./remote-stream-path.js";
import { mediaRootAbs, relativeToMediaRoot, isPathInsideRoot } from "./media-path.js";
import { existsSync } from "node:fs";
import path from "node:path";

function resolveLocalPathToStored(rawPath: string, env: Env): string | null {
  const norm = rawPath.trim().replace(/\\/g, "/");
  if (isRemoteStreamPath(norm)) return null;
  const root = mediaRootAbs(env);
  const abs = path.isAbsolute(norm) ? path.normalize(norm) : path.resolve(root, norm);
  if (!isPathInsideRoot(abs, root) || !existsSync(abs)) return null;
  const stored = relativeToMediaRoot(abs, env).split(path.sep).join("/");
  return stored;
}

async function assetIdForPath(rawPath: string, title: string | undefined, env: Env): Promise<string | null> {
  if (isRemoteStreamPath(rawPath)) {
    try {
      const asset = await createOrReuseStreamUrlAsset({ url: normalizeRemoteStreamUrl(rawPath), title });
      return asset.id;
    } catch {
      return null;
    }
  }
  const stored = resolveLocalPathToStored(rawPath, env);
  if (!stored) return null;
  const existing = await prisma.mediaAsset.findFirst({ where: { path: stored } });
  if (existing) return existing.id;
  const abs = path.join(mediaRootAbs(env), ...stored.split("/"));
  const base = path.basename(abs, path.extname(abs));
  const asset = await prisma.mediaAsset.create({
    data: { title: title?.trim() || base.replace(/_/g, " ") || "Sin título", path: stored },
  });
  return asset.id;
}

export type ImportPlaylistFileResult = {
  playlistId: string;
  added: number;
  skipped: number;
};

/** Importa M3U/PLS a playlist nueva o existente (RB-009). */
export async function importPlaylistFile(
  opts: {
    format: "m3u" | "pls";
    content: string;
    name?: string;
    targetPlaylistId?: string | null;
  },
  env: Env,
): Promise<ImportPlaylistFileResult | null> {
  const entries =
    opts.format === "pls" ? parsePlsPlaylist(opts.content) : parseM3uPlaylist(opts.content);
  if (entries.length === 0) return null;

  let playlistId = opts.targetPlaylistId ?? null;
  if (!playlistId) {
    const name = opts.name?.trim() || `Importada ${new Date().toISOString().slice(0, 10)}`;
    const pl = await prisma.playlist.create({ data: { name } });
    playlistId = pl.id;
  } else {
    const pl = await prisma.playlist.findUnique({ where: { id: playlistId } });
    if (!pl) return null;
  }

  const last = await prisma.playlistItem.findFirst({
    where: { playlistId },
    orderBy: { position: "desc" },
  });
  let position = (last?.position ?? -1) + 1;
  let added = 0;
  let skipped = 0;

  for (const en of entries) {
    const assetId = await assetIdForPath(en.path, en.title, env);
    if (!assetId) {
      skipped += 1;
      continue;
    }
    await prisma.playlistItem.create({
      data: { playlistId, assetId, position, kind: "track" },
    });
    position += 1;
    added += 1;
  }

  if (added === 0 && !opts.targetPlaylistId) {
    await prisma.playlist.delete({ where: { id: playlistId } });
    return null;
  }

  return { playlistId, added, skipped };
}

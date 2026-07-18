import { existsSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { containsCi, equalsCi } from "./prisma-string-filter.js";
import type { ApiLibraryProcessSyncMetadataResult } from "@radioflow/shared";
import type { Env } from "../config.js";
import { enrichMediaAssetFromAudioFile } from "./id3-enrich-asset.js";
import { resolveAssetFilePath } from "./media-path.js";

export type MetadataSyncFilters = {
  q?: string;
  genre?: string;
  artist?: string;
  pathPrefix?: string;
};

export type SyncMetadataProgress = {
  done: number;
  total: number;
  updated: number;
  failures: number;
  recentFailures: { assetId: string; title: string; error: string }[];
};

const BATCH_SIZE = 40;
const MAX_RECENT_FAILURES = 30;

export function buildMediaAssetWhere(filters: MetadataSyncFilters): Prisma.MediaAssetWhereInput {
  const q = (filters.q ?? "").trim();
  const genre = (filters.genre ?? "").trim();
  const artist = (filters.artist ?? "").trim();
  const pathPrefix = (filters.pathPrefix ?? "").trim().replace(/\\/g, "/");

  return {
    ...(q
      ? {
          OR: [
            { title: containsCi(q) },
            { artist: containsCi(q) },
            { album: containsCi(q) },
          ],
        }
      : {}),
    ...(genre ? { genre: equalsCi(genre) } : {}),
    ...(artist === "__none__"
      ? { OR: [{ artist: null }, { artist: "" }] }
      : artist
        ? { artist: equalsCi(artist) }
        : {}),
    ...(pathPrefix ? { path: { startsWith: pathPrefix } } : {}),
  };
}

async function syncOneAsset(
  prisma: PrismaClient,
  env: Env,
  assetId: string,
): Promise<{ ok: true; title: string } | { ok: false; title: string; error: string }> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    return { ok: false, title: "", error: "No encontrado" };
  }
  const abs = resolveAssetFilePath(asset.path, env);
  if (!abs || !existsSync(abs)) {
    return { ok: false, title: asset.title, error: "Archivo no accesible" };
  }
  try {
    await enrichMediaAssetFromAudioFile(prisma, env, asset);
    return { ok: true, title: asset.title };
  } catch {
    return { ok: false, title: asset.title, error: "Error al leer metadatos" };
  }
}

function pushFailure(
  recentFailures: SyncMetadataProgress["recentFailures"],
  row: { assetId: string; title: string; error: string },
): void {
  recentFailures.push(row);
  if (recentFailures.length > MAX_RECENT_FAILURES) {
    recentFailures.shift();
  }
}

export async function countAssetsForMetadataSync(
  prisma: PrismaClient,
  filters: MetadataSyncFilters,
): Promise<number> {
  return prisma.mediaAsset.count({ where: buildMediaAssetWhere(filters) });
}

export async function runSyncMetadataBatchForAssets(
  prisma: PrismaClient,
  env: Env,
  params: {
    assetIds: string[];
    onProgress?: (p: SyncMetadataProgress) => Promise<void>;
  },
): Promise<ApiLibraryProcessSyncMetadataResult> {
  const { assetIds, onProgress } = params;
  const total = assetIds.length;
  let updated = 0;
  let failures = 0;
  const recentFailures: SyncMetadataProgress["recentFailures"] = [];
  let done = 0;

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, title: true, path: true },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));

  for (const id of assetIds) {
    if (!byId.has(id)) {
      failures += 1;
      pushFailure(recentFailures, { assetId: id, title: "", error: "No encontrado" });
    } else {
      const r = await syncOneAsset(prisma, env, id);
      if (r.ok) updated += 1;
      else {
        failures += 1;
        pushFailure(recentFailures, { assetId: id, title: r.title, error: r.error });
      }
    }
    done += 1;
    if (onProgress && (done % 5 === 0 || done === total)) {
      await onProgress({ done, total, updated, failures, recentFailures: [...recentFailures] });
    }
  }

  if (onProgress) {
    await onProgress({ done, total, updated, failures, recentFailures: [...recentFailures] });
  }

  return { kind: "sync_metadata", updated, failures, total, recentFailures };
}

export async function runSyncMetadataForLibrary(
  prisma: PrismaClient,
  env: Env,
  params: {
    filters: MetadataSyncFilters;
    onProgress?: (p: SyncMetadataProgress) => Promise<void>;
  },
): Promise<ApiLibraryProcessSyncMetadataResult> {
  const where = buildMediaAssetWhere(params.filters);
  const total = await prisma.mediaAsset.count({ where });
  let updated = 0;
  let failures = 0;
  let done = 0;
  const recentFailures: SyncMetadataProgress["recentFailures"] = [];
  let cursor: string | undefined;

  while (done < total) {
    const batch = await prisma.mediaAsset.findMany({
      where,
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
      select: { id: true, title: true, path: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    for (const asset of batch) {
      const r = await syncOneAsset(prisma, env, asset.id);
      if (r.ok) updated += 1;
      else {
        failures += 1;
        pushFailure(recentFailures, { assetId: asset.id, title: r.title, error: r.error });
      }
      done += 1;
    }

    cursor = batch[batch.length - 1]!.id;
    if (params.onProgress) {
      await params.onProgress({ done, total, updated, failures, recentFailures: [...recentFailures] });
    }
  }

  return { kind: "sync_metadata", updated, failures, total, recentFailures };
}

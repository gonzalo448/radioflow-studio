import { existsSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import type { ApiLibraryProcessTracksLoudnessResult, ApiLibraryProcessTracksLoudnessRow } from "@radioflow/shared";
import type { Env } from "../config.js";
import {
  clampPlaybackGainDb,
  measureIntegratedLufsWithLoudnorm,
  suggestedGainDbForTarget,
} from "./ffmpeg-loudnorm-measure.js";
import { resolveAssetFilePath } from "./media-path.js";

export type LoudnessBatchProgress = {
  done: number;
  total: number;
  rows: ApiLibraryProcessTracksLoudnessRow[];
};

/**
 * Medición / aplicación loudnorm para una lista de assets (orden preservado).
 * Usado por POST síncrono y por jobs en cola.
 */
export async function runLoudnessBatchForAssets(
  prisma: PrismaClient,
  env: Env,
  params: {
    assetIds: string[];
    targetLufs: number;
    dryRun: boolean;
    onProgress?: (p: LoudnessBatchProgress) => Promise<void>;
  },
): Promise<ApiLibraryProcessTracksLoudnessResult> {
  const { assetIds, targetLufs, dryRun, onProgress } = params;
  const rowsOut: ApiLibraryProcessTracksLoudnessResult["rows"] = [];
  let updated = 0;
  const total = assetIds.length;
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, path: true, title: true, playbackGainDb: true },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));
  let done = 0;
  for (const id of assetIds) {
    const asset = byId.get(id);
    if (!asset) {
      rowsOut.push({
        assetId: id,
        title: "",
        path: "",
        previousPlaybackGainDb: 0,
        measuredIntegratedLufs: null,
        suggestedGainDb: null,
        targetLufs,
        error: "No encontrado",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rowsOut] });
      continue;
    }
    const abs = resolveAssetFilePath(asset.path, env);
    const prev = asset.playbackGainDb ?? 0;
    if (!abs || !existsSync(abs)) {
      rowsOut.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        previousPlaybackGainDb: prev,
        measuredIntegratedLufs: null,
        suggestedGainDb: null,
        targetLufs,
        error: "Archivo no accesible",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rowsOut] });
      continue;
    }
    const measured = await measureIntegratedLufsWithLoudnorm(abs, env.FFMPEG_PATH, targetLufs);
    if (measured == null) {
      rowsOut.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        previousPlaybackGainDb: prev,
        measuredIntegratedLufs: null,
        suggestedGainDb: null,
        targetLufs,
        error: "Medición loudnorm fallida",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rowsOut] });
      continue;
    }
    const suggested = clampPlaybackGainDb(suggestedGainDbForTarget(measured, targetLufs));
    let applied: number | null = null;
    if (!dryRun) {
      await prisma.mediaAsset.update({
        where: { id },
        data: { playbackGainDb: suggested },
      });
      applied = suggested;
      updated += 1;
    }
    rowsOut.push({
      assetId: id,
      title: asset.title,
      path: asset.path,
      previousPlaybackGainDb: prev,
      measuredIntegratedLufs: measured,
      suggestedGainDb: suggested,
      targetLufs,
      ...(applied != null ? { appliedPlaybackGainDb: applied } : {}),
      error: null,
    });
    done += 1;
    if (onProgress) await onProgress({ done, total, rows: [...rowsOut] });
  }
  return { dryRun, targetLufs, rows: rowsOut, updated };
}

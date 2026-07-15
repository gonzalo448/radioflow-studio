import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Env } from "../config.js";
import { resolveAssetFilePath } from "./media-path.js";

type AssetFileRef = { path: string; coverPath?: string | null };

/** Borra del disco el audio y la carátula asociados a una pista de librería. */
export async function removeMediaAssetFiles(
  env: Env,
  asset: AssetFileRef,
): Promise<{ removedAudio: boolean; removedCover: boolean }> {
  let removedAudio = false;
  let removedCover = false;

  const audioPath = resolveAssetFilePath(asset.path, env);
  if (audioPath && existsSync(audioPath)) {
    try {
      await rm(audioPath, { force: true });
      removedAudio = true;
    } catch {
      /* */
    }
  }

  if (asset.coverPath) {
    const coverPath = resolveAssetFilePath(asset.coverPath, env);
    if (coverPath && existsSync(coverPath)) {
      try {
        await rm(coverPath, { force: true });
        removedCover = true;
      } catch {
        /* */
      }
    }
  }

  return { removedAudio, removedCover };
}

export async function removeMediaAssetFilesBatch(
  env: Env,
  assets: AssetFileRef[],
): Promise<number> {
  let removedFiles = 0;
  for (const asset of assets) {
    const r = await removeMediaAssetFiles(env, asset);
    if (r.removedAudio) removedFiles += 1;
  }
  return removedFiles;
}

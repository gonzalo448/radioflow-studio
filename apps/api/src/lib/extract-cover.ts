import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import type { IPicture } from "music-metadata";
import type { Env } from "../config.js";
import { mediaRootAbs, relativeToMediaRoot } from "./media-path.js";

/** Guarda bytes de carátula embebida bajo `covers/<assetId>.(jpg|png)`. */
export async function saveEmbeddedPicture(
  pic: IPicture,
  assetId: string,
  env: Env,
): Promise<string | null> {
  if (!pic?.data?.length) return null;
  try {
    const fmt = (pic.format || "").toLowerCase();
    const ext = fmt.includes("png") ? "png" : "jpg";
    const coversDir = path.join(mediaRootAbs(env), "covers");
    await mkdir(coversDir, { recursive: true });
    const absCover = path.join(coversDir, `${assetId}.${ext}`);
    await writeFile(absCover, pic.data);
    return relativeToMediaRoot(absCover, env);
  } catch {
    return null;
  }
}

/**
 * Intenta leer una imagen embebida (ID3/APIC, etc.) y guardarla bajo MEDIA_ROOT/covers/<assetId>.(jpg|png).
 * Devuelve ruta relativa al root de medios o null si no hay carátula.
 */
export async function tryExtractCoverFromAudioFile(
  absAudioPath: string,
  assetId: string,
  env: Env,
): Promise<string | null> {
  try {
    const mm = await parseFile(absAudioPath, { skipCovers: false });
    const pic = mm.common.picture?.[0];
    if (!pic) return null;
    return saveEmbeddedPicture(pic, assetId, env);
  } catch {
    return null;
  }
}

import fs from "node:fs";
import path from "node:path";
import type { Env } from "../config.js";
import { isPathInsideRoot, mediaRootAbs, resolveAssetFilePath } from "./media-path.js";

/** Resuelve rutas de audio para Liquidsoap / eventos legacy (vault, absoluta bajo MEDIA_ROOT, http). */
export function resolveLiquidsoapAudioPath(stored: string, env: Env): string | null {
  const raw = stored.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const vault = resolveAssetFilePath(raw, env);
  if (vault) return vault.split(path.sep).join("/");

  if (path.isAbsolute(raw)) {
    const root = mediaRootAbs(env);
    const norm = path.normalize(raw);
    if (isPathInsideRoot(norm, root) && fs.existsSync(norm)) {
      return norm.split(path.sep).join("/");
    }
    if (fs.existsSync(norm)) return norm.split(path.sep).join("/");
  }

  return null;
}

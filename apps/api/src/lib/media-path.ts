import fs from "node:fs";
import path from "node:path";
import type { Env } from "../config.js";

export function mediaRootAbs(env: Env): string {
  return path.resolve(process.cwd(), env.MEDIA_ROOT);
}

/** Comprueba que `resolvedFile` quede dentro de `root`. */
export function isPathInsideRoot(resolvedFile: string, root: string): boolean {
  const rootR = path.resolve(root);
  const fileR = path.resolve(resolvedFile);
  const rel = path.relative(rootR, fileR);
  return (rel === "" || !rel.startsWith("..")) && !path.isAbsolute(rel);
}

/** Resuelve ruta almacenada en MediaAsset a archivo legible bajo MEDIA_ROOT (o absoluta ya bajo root). */
export function resolveAssetFilePath(storedPath: string, env: Env): string | null {
  const root = mediaRootAbs(env);
  const candidate = path.isAbsolute(storedPath)
    ? path.normalize(storedPath)
    : path.resolve(root, storedPath);
  if (!isPathInsideRoot(candidate, root)) return null;
  if (!fs.existsSync(candidate)) return null;
  return candidate;
}

export async function ensureMediaDirs(env: Env): Promise<void> {
  const uploadDir = path.join(mediaRootAbs(env), "uploads");
  await fs.promises.mkdir(uploadDir, { recursive: true });
}

export function relativeToMediaRoot(absolutePath: string, env: Env): string {
  const root = mediaRootAbs(env);
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

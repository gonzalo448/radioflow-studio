import fs from "node:fs";
import path from "node:path";
import type { Env } from "../config.js";
import { ensureMediaDirs, mediaRootAbs } from "./media-path.js";

export const STATION_LOGO_API_PATH = "/api/settings/station-logo";
const BRANDING_DIR = "branding";
const LOGO_PREFIX = "station-logo";

export function stationLogoMime(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  if (e === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

export async function findStationLogoAbsPath(env: Env): Promise<string | null> {
  await ensureMediaDirs(env);
  const dir = path.join(mediaRootAbs(env), BRANDING_DIR);
  if (!fs.existsSync(dir)) return null;
  for (const ent of fs.readdirSync(dir)) {
    if (ent.startsWith(`${LOGO_PREFIX}.`)) {
      return path.join(dir, ent);
    }
  }
  return null;
}

export function stationLogoDestAbs(env: Env, ext: string): string {
  return path.join(mediaRootAbs(env), BRANDING_DIR, `${LOGO_PREFIX}${ext}`);
}

export async function clearStationLogoFiles(env: Env): Promise<void> {
  await ensureMediaDirs(env);
  const dir = path.join(mediaRootAbs(env), BRANDING_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    for (const ent of await fs.promises.readdir(dir)) {
      if (ent.startsWith(`${LOGO_PREFIX}.`)) {
        await fs.promises.unlink(path.join(dir, ent));
      }
    }
  } catch {
    /* */
  }
}

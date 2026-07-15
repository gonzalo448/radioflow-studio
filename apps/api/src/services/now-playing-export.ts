import fs from "node:fs";
import path from "node:path";
import type { ApiPublicNowPlaying } from "@radioflow/shared";
import type { Env } from "../config.js";
import { resolveAssetFilePath, mediaRootAbs } from "../lib/media-path.js";
import { prisma } from "../db.js";
import { getPublicNowPlaying } from "./now-playing.js";

import { resolveRdsLine } from "../lib/rds-text.js";
import { getOrCreateSettings } from "../services/app-settings.js";

export const NOWPLAYING_JSON = "nowplaying.json";
export const CURRENT_COVER = "current-cover.jpg";
export const RDS_TXT = "rds.txt";

let lastExportedKey: string | null | undefined;

function exportDirAbs(env: Env): string {
  const dir = env.NOW_PLAYING_EXPORT_DIR?.trim();
  if (dir) return path.resolve(dir);
  return path.join(mediaRootAbs(env), "nowplaying");
}

export function nowPlayingExportPaths(env: Env) {
  const dir = exportDirAbs(env);
  return {
    dir,
    jsonPath: path.join(dir, NOWPLAYING_JSON),
    coverPath: path.join(dir, CURRENT_COVER),
  };
}

async function ensureExportDir(env: Env): Promise<string> {
  const dir = exportDirAbs(env);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

async function writeCoverSidecar(
  env: Env,
  destCover: string,
  now: ApiPublicNowPlaying["now"],
): Promise<boolean> {
  if (!now?.assetId) {
    try {
      await fs.promises.unlink(destCover);
    } catch {
      /* sin archivo previo */
    }
    return false;
  }

  const asset = await prisma.mediaAsset.findUnique({ where: { id: now.assetId } });
  if (asset?.coverPath) {
    const src = resolveAssetFilePath(asset.coverPath, env);
    if (src) {
      await fs.promises.copyFile(src, destCover);
      return true;
    }
  }

  if (now.coverUrl?.startsWith("http://") || now.coverUrl?.startsWith("https://")) {
    try {
      const res = await fetch(now.coverUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) {
          await fs.promises.writeFile(destCover, buf);
          return true;
        }
      }
    } catch {
      /* omitir */
    }
  }

  try {
    await fs.promises.unlink(destCover);
  } catch {
    /* ignore */
  }
  return false;
}

export async function writeNowPlayingSidecar(
  env: Env,
  origin: string,
  payload: ApiPublicNowPlaying,
): Promise<{ jsonPath: string; coverWritten: boolean }> {
  await ensureExportDir(env);
  const { jsonPath, coverPath } = nowPlayingExportPaths(env);
  const coverWritten = await writeCoverSidecar(env, coverPath, payload.now);

  const sidecar = {
    ...payload,
    coverFile: coverWritten ? CURRENT_COVER : null,
    sidecarUpdatedAt: new Date().toISOString(),
  };

  const tmp = `${jsonPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, jsonPath);

  const settings = await getOrCreateSettings();
  if (settings.rdsEnabled) {
    const rdsLine = await resolveRdsLine({
      title: payload.now?.title,
      artist: payload.now?.artist,
      stationName: settings.stationName,
    });
    if (rdsLine) {
      const rdsPath = path.join(exportDirAbs(env), RDS_TXT);
      await fs.promises.writeFile(rdsPath, `${rdsLine}\n`, "utf8");
    }
  }

  return { jsonPath, coverWritten };
}

export function sidecarPublicUrls(origin: string): { jsonUrl: string; coverUrl: string } {
  const base = origin.replace(/\/$/, "");
  return {
    jsonUrl: `${base}/api/public/nowplaying.json`,
    coverUrl: `${base}/api/public/current-cover.jpg`,
  };
}

/** Escribe sidecar solo si cambió la pista al aire (o pasó a silencio). */
export async function exportNowPlayingSidecarIfChanged(origin: string, env: Env): Promise<void> {
  if (!env.NOW_PLAYING_EXPORT_ENABLED) return;

  const payload = await getPublicNowPlaying(origin);
  const key = payload.now?.assetId ?? "__idle__";
  if (key === lastExportedKey) return;
  lastExportedKey = key;

  await writeNowPlayingSidecar(env, origin, payload);
}

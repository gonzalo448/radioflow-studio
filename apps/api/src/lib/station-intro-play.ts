import { copyFile, mkdir, stat } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import { ensureMainStation } from "../services/station-state.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { logAutomation } from "./automation-log.js";
import { deferredSpotInsertAt } from "./deferred-spot-insert.js";
import { enrichMediaAssetFromAudioFile } from "./id3-enrich-asset.js";
import { mediaRootAbs, relativeToMediaRoot } from "./media-path.js";

const VAULT_PREFIX = "uploads/station-intro";
const INTRO_GAIN_DB = 4;
const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma"]);

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".wav") return "audio/wav";
  if (e === ".flac") return "audio/flac";
  if (e === ".ogg" || e === ".oga") return "audio/ogg";
  if (e === ".m4a" || e === ".aac") return "audio/mp4";
  return "audio/mpeg";
}

function isAudioFile(name: string): boolean {
  return AUDIO_EXT.has(path.extname(name).toLowerCase());
}

/** Resuelve ruta absoluta a un archivo de audio (archivo directo o uno al azar de carpeta). */
export function resolveStationIntroFile(sourceAbs: string): { absPath: string; fileName: string } | null {
  const trimmed = sourceAbs.trim();
  if (!trimmed) return null;

  let st: fs.Stats;
  try {
    st = fs.statSync(trimmed);
  } catch {
    return null;
  }

  if (st.isFile()) {
    if (!isAudioFile(trimmed)) return null;
    return { absPath: trimmed, fileName: path.basename(trimmed) };
  }

  if (!st.isDirectory()) return null;

  let names: string[];
  try {
    names = fs.readdirSync(trimmed);
  } catch {
    return null;
  }

  const audio = names
    .filter((n) => isAudioFile(n))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (audio.length === 0) return null;

  const pick = audio.length === 1 ? audio[0]! : audio[Math.floor(Math.random() * audio.length)]!;
  return { absPath: path.join(trimmed, pick), fileName: pick };
}

/** Copia a bóveda, enriquece ID3 (incl. carátula) y fija género/ganancia de intro. */
async function finalizeIntroAsset(env: Env, assetId: string): Promise<void> {
  const row = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!row) return;
  try {
    await enrichMediaAssetFromAudioFile(prisma, env, row);
  } catch {
    /* metadatos opcionales */
  }
  await prisma.mediaAsset.update({
    where: { id: assetId },
    data: {
      genre: "station-intro",
      playbackGainDb: INTRO_GAIN_DB,
      cueStartSec: null,
      cueEndSec: null,
    },
  });
}

async function ensureVaultAssetForIntro(env: Env, absPath: string, fileName: string): Promise<string> {
  const destDir = path.join(mediaRootAbs(env), ...VAULT_PREFIX.split("/"));
  await mkdir(destDir, { recursive: true });
  const safeName = fileName.replace(/[^\w.\-áéíóúüñÁÉÍÓÚÜÑ ]+/gi, "_");
  const destAbs = path.join(destDir, safeName);
  const rel = relativeToMediaRoot(destAbs, env).split(path.sep).join("/");

  const srcMtime = (await stat(absPath)).mtimeMs;
  const existing = await prisma.mediaAsset.findFirst({ where: { path: rel } });
  if (existing) {
    let copied = false;
    try {
      const destMtime = (await stat(destAbs)).mtimeMs;
      if (destMtime < srcMtime) {
        await copyFile(absPath, destAbs);
        copied = true;
      }
    } catch {
      await copyFile(absPath, destAbs);
      copied = true;
    }
    // Releer carátula/ID3 si falta cover o el archivo fuente cambió.
    if (copied || !existing.coverPath) {
      await finalizeIntroAsset(env, existing.id);
    } else {
      await prisma.mediaAsset.update({
        where: { id: existing.id },
        data: {
          genre: "station-intro",
          playbackGainDb: Math.max(existing.playbackGainDb ?? 0, INTRO_GAIN_DB),
          cueStartSec: null,
          cueEndSec: null,
        },
      });
    }
    return existing.id;
  }

  try {
    await copyFile(absPath, destAbs);
  } catch (err) {
    const again = await prisma.mediaAsset.findFirst({ where: { path: rel } });
    if (again) {
      await finalizeIntroAsset(env, again.id);
      return again.id;
    }
    throw err;
  }

  const base = path.basename(safeName, path.extname(safeName));
  const asset = await prisma.mediaAsset.create({
    data: {
      title: `Intro · ${base}`,
      artist: "Intro emisora",
      path: rel,
      mimeType: mimeFromExt(path.extname(safeName)),
      genre: "station-intro",
      playbackGainDb: INTRO_GAIN_DB,
      cueStartSec: null,
      cueEndSec: null,
    },
  });
  await finalizeIntroAsset(env, asset.id);
  return asset.id;
}

export type PlayStationIntroResult = {
  ok: boolean;
  inserted: number;
  fileName?: string;
  assetId?: string;
  deferred?: boolean;
  error?: string;
};

async function insertStationIntroPlaceholder(stationId: string): Promise<number> {
  await prisma.$transaction(async (tx) => {
    await tx.playQueueItem.deleteMany({
      where: { stationId, kind: "station_intro" },
    });

    const remaining = await tx.playQueueItem.findMany({
      where: { stationId },
      orderBy: { position: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i]!.position !== i) {
        await tx.playQueueItem.update({
          where: { id: remaining[i]!.id },
          data: { position: i },
        });
      }
    }

    const station = await tx.station.findUniqueOrThrow({ where: { id: stationId } });
    const insertAt = deferredSpotInsertAt(station.currentPosition, remaining);

    const toShift = await tx.playQueueItem.findMany({
      where: { stationId, position: { gte: insertAt } },
      orderBy: { position: "desc" },
    });
    for (const row of toShift) {
      await tx.playQueueItem.update({
        where: { id: row.id },
        data: { position: row.position + 1 },
      });
    }

    await tx.playQueueItem.create({
      data: {
        stationId,
        assetId: null,
        position: insertAt,
        kind: "station_intro",
        label: "Intro de emisora (al salir al aire)",
      },
    });
  });
  return 1;
}

/** Programa intro tras la canción al aire; el archivo se elige al expandir el marcador. */
export async function scheduleStationIntroAfterCurrent(
  env: Env,
  opts?: { sourceAbs?: string | null },
): Promise<PlayStationIntroResult> {
  const settings = await getOrCreateSettings();
  const sourceAbs = (opts?.sourceAbs ?? settings.stationIntroSourceAbs ?? "").trim();
  if (!sourceAbs) {
    return {
      ok: false,
      inserted: 0,
      error: "Configure el archivo o carpeta de intro de emisora.",
    };
  }

  const probe = resolveStationIntroFile(sourceAbs);
  if (!probe) {
    return {
      ok: false,
      inserted: 0,
      error: "No se encontró audio en la ruta indicada (archivo .mp3/.wav o carpeta con audio).",
    };
  }

  await ensureMainStation();
  const inserted = await insertStationIntroPlaceholder("main");
  void broadcastStationState();

  return {
    ok: true,
    inserted,
    fileName: probe.fileName,
    deferred: true,
  };
}

export async function playStationIntroNow(
  env: Env,
  opts?: { sourceAbs?: string | null; afterCurrent?: boolean },
): Promise<PlayStationIntroResult> {
  if (opts?.afterCurrent !== false) {
    return scheduleStationIntroAfterCurrent(env, { sourceAbs: opts?.sourceAbs });
  }

  const settings = await getOrCreateSettings();
  const sourceAbs = (opts?.sourceAbs ?? settings.stationIntroSourceAbs ?? "").trim();
  if (!sourceAbs) {
    return { ok: false, inserted: 0, error: "Configure el archivo o carpeta de intro de emisora." };
  }

  const resolved = resolveStationIntroFile(sourceAbs);
  if (!resolved) {
    return { ok: false, inserted: 0, error: "No se encontró audio en la ruta indicada." };
  }

  const assetId = await ensureVaultAssetForIntro(env, resolved.absPath, resolved.fileName);
  await ensureMainStation();
  const last = await prisma.playQueueItem.findFirst({
    where: { stationId: "main" },
    orderBy: { position: "desc" },
  });
  const position = (last?.position ?? -1) + 1;
  await prisma.playQueueItem.create({
    data: {
      stationId: "main",
      assetId,
      position,
      kind: "track",
      label: "Intro emisora",
    },
  });
  void broadcastStationState();

  return { ok: true, inserted: 1, fileName: resolved.fileName, assetId };
}

export type ResolveStationIntroResult = {
  ok: boolean;
  fileName?: string;
  error?: string;
};

/** Expande marcador `station_intro` con el audio configurado (al llegar al aire). */
export async function resolveStationIntroQueueItem(
  env: Env,
  queueItemId: string,
): Promise<ResolveStationIntroResult> {
  const item = await prisma.playQueueItem.findUnique({ where: { id: queueItemId } });
  if (!item || item.kind !== "station_intro") {
    return { ok: false, error: "No hay marcador de intro en esa fila" };
  }

  const settings = await getOrCreateSettings();
  const sourceAbs = (settings.stationIntroSourceAbs ?? "").trim();
  if (!sourceAbs) {
    await prisma.playQueueItem.delete({ where: { id: queueItemId } });
    void broadcastStationState();
    return { ok: false, error: "Sin intro de emisora configurada" };
  }

  const resolved = resolveStationIntroFile(sourceAbs);
  if (!resolved) {
    await prisma.playQueueItem.delete({ where: { id: queueItemId } });
    void broadcastStationState();
    return { ok: false, error: "No se encontró audio de intro" };
  }

  const assetId = await ensureVaultAssetForIntro(env, resolved.absPath, resolved.fileName);
  await prisma.playQueueItem.update({
    where: { id: queueItemId },
    data: {
      kind: "track",
      assetId,
      label: resolved.fileName,
    },
  });
  void broadcastStationState();

  logAutomation("station_intro", { fileName: resolved.fileName }, assetId);

  return { ok: true, fileName: resolved.fileName };
}

export async function resolveStationIntroIfCurrent(env: Env): Promise<ResolveStationIntroResult | null> {
  await ensureMainStation();
  const station = await prisma.station.findUniqueOrThrow({ where: { id: "main" } });
  const row = await prisma.playQueueItem.findFirst({
    where: { stationId: "main", position: station.currentPosition },
  });
  if (!row || row.kind !== "station_intro") return null;
  return resolveStationIntroQueueItem(env, row.id);
}

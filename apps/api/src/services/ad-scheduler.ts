import type { AdSchedulerConfig } from "@prisma/client";
import type { ApiAdSchedulerConfig, ApiAdSpotRow } from "@radioflow/shared";
import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { assertAssetPlayableInVault } from "../lib/library-vault.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { insertBreakAfterCurrent } from "./station-queue.js";
import { ensureMainStation, MAIN_STATION_ID } from "./station-state.js";

const CONFIG_ID = "main";

type AdSpot = { id: string; title: string; artist: string | null; path: string; durationSec: number | null };

export function toApiAdConfig(row: AdSchedulerConfig): ApiAdSchedulerConfig {
  return {
    id: row.id,
    enabled: row.enabled,
    pathPrefix: row.pathPrefix,
    intervalMinutes: row.intervalMinutes,
    spotsPerBreak: row.spotsPerBreak,
    maxSpotsPerHour: row.maxSpotsPerHour,
    minGapMinutes: row.minGapMinutes,
    rotationMode: row.rotationMode === "sequential" ? "sequential" : "random",
    lastBreakAt: row.lastBreakAt ? row.lastBreakAt.toISOString() : null,
    sequentialCursor: row.sequentialCursor,
    hourWindowStart: row.hourWindowStart ? row.hourWindowStart.toISOString() : null,
    spotsThisHour: row.spotsThisHour,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureAdSchedulerConfig(): Promise<AdSchedulerConfig> {
  return prisma.adSchedulerConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID },
    update: {},
  });
}

export async function listAdSpots(pathPrefix: string, env: Env): Promise<ApiAdSpotRow[]> {
  const prefix = pathPrefix.trim().replace(/\\/g, "/");
  const rows = await prisma.mediaAsset.findMany({
    where: { path: { startsWith: prefix } },
    orderBy: { title: "asc" },
    take: 500,
    select: { id: true, title: true, artist: true, path: true, durationSec: true },
  });
  return rows.filter((a) => {
    try {
      assertAssetPlayableInVault(a, env);
      return true;
    } catch {
      return false;
    }
  });
}

async function loadAdPool(pathPrefix: string, env: Env): Promise<AdSpot[]> {
  return listAdSpots(pathPrefix, env);
}

function pickSpotIds(
  pool: AdSpot[],
  count: number,
  rotationMode: string,
  cursor: number,
): { ids: string[]; nextCursor: number } {
  if (pool.length === 0) return { ids: [], nextCursor: 0 };
  const n = Math.min(count, pool.length);
  const ids: string[] = [];
  const used = new Set<string>();

  if (rotationMode === "sequential") {
    let idx = cursor % pool.length;
    for (let i = 0; i < n; i++) {
      let guard = 0;
      while (used.has(pool[idx]!.id) && guard < pool.length) {
        idx = (idx + 1) % pool.length;
        guard++;
      }
      ids.push(pool[idx]!.id);
      used.add(pool[idx]!.id);
      idx = (idx + 1) % pool.length;
    }
    return { ids, nextCursor: idx };
  }

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  for (const spot of shuffled) {
    if (ids.length >= n) break;
    if (used.has(spot.id)) continue;
    ids.push(spot.id);
    used.add(spot.id);
  }
  return { ids, nextCursor: cursor };
}

function sameHour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() && a.getHours() === b.getHours();
}

function minutesSince(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

export type PlayAdBreakInput = {
  env: Env;
  source: "manual" | "auto" | "scheduler";
  spotCount?: number;
  pathPrefix?: string;
};

export async function playAdBreak(input: PlayAdBreakInput): Promise<{ assetIds: string[]; insertedCount: number }> {
  await ensureMainStation();
  const config = await ensureAdSchedulerConfig();
  const prefix = (input.pathPrefix ?? config.pathPrefix).trim().replace(/\\/g, "/");
  const count = Math.max(1, Math.min(10, input.spotCount ?? config.spotsPerBreak));

  const pool = await loadAdPool(prefix, input.env);
  if (pool.length === 0) {
    throw new Error(`No hay spots en la carpeta «${prefix}»`);
  }

  const { ids, nextCursor } = pickSpotIds(pool, count, config.rotationMode, config.sequentialCursor);
  if (ids.length === 0) {
    throw new Error("No se pudieron elegir spots");
  }

  const insertedCount = await insertBreakAfterCurrent(MAIN_STATION_ID, ids, input.env);
  const now = new Date();

  const hourReset = !config.hourWindowStart || !sameHour(config.hourWindowStart, now);
  const spotsThisHour = (hourReset ? 0 : config.spotsThisHour) + ids.length;

  await prisma.adSchedulerConfig.update({
    where: { id: CONFIG_ID },
    data: {
      lastBreakAt: now,
      sequentialCursor: nextCursor,
      hourWindowStart: hourReset ? now : config.hourWindowStart,
      spotsThisHour,
    },
  });

  await prisma.adBreakLog.create({
    data: {
      stationId: MAIN_STATION_ID,
      assetIds: ids,
      source: input.source,
    },
  });

  void broadcastStationState();
  return { assetIds: ids, insertedCount };
}

export async function runAdSchedulerTick(env: Env): Promise<void> {
  const config = await ensureAdSchedulerConfig();
  if (!config.enabled) return;

  const station = await prisma.station.findUnique({ where: { id: MAIN_STATION_ID } });
  if (!station || station.mode === "LIVE") return;

  const now = new Date();
  if (config.lastBreakAt && minutesSince(config.lastBreakAt, now) < config.minGapMinutes) return;

  const hourReset = !config.hourWindowStart || !sameHour(config.hourWindowStart, now);
  const spotsThisHour = hourReset ? 0 : config.spotsThisHour;
  if (spotsThisHour >= config.maxSpotsPerHour) return;

  if (config.lastBreakAt && minutesSince(config.lastBreakAt, now) < config.intervalMinutes) return;

  try {
    await playAdBreak({ env, source: "auto" });
  } catch {
    // Sin spots o cola bloqueada: no tumbar el tick
  }
}

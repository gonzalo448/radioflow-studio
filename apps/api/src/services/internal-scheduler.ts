import type { ApiScheduleApplyActiveReason } from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { SyncPlaylistError, syncQueueFromPlaylist } from "./queue-from-playlist.js";
import { ensureMainStation, getStationState, MAIN_STATION_ID, type StationStatePayload } from "./station-state.js";

export type ScheduleBlockHint = {
  id: string;
  playlistId: string | null;
  priority: number;
  startMinute: number;
  label: string;
};

export function pickWinningBlock(active: ScheduleBlockHint[]): ScheduleBlockHint | null {
  const withPl = active.filter((b): b is ScheduleBlockHint & { playlistId: string } => Boolean(b.playlistId));
  if (withPl.length === 0) return null;
  withPl.sort((a, b) => b.priority - a.priority || a.startMinute - b.startMinute);
  return withPl[0]!;
}

/** Bloques de parrilla que cubren el minuto actual (mismo criterio que GET /schedule/today-hints). */
export async function getActiveScheduleBlocksNow(): Promise<ScheduleBlockHint[]> {
  const now = new Date();
  const day = now.getDay();
  const minuteNow = now.getHours() * 60 + now.getMinutes();
  const blocks = await prisma.scheduleBlock.findMany({
    where: { dayOfWeek: day },
    orderBy: { startMinute: "asc" },
  });
  return blocks
    .filter((b) => minuteNow >= b.startMinute && minuteNow < b.endMinute)
    .map((b) => ({
      id: b.id,
      playlistId: b.playlistId,
      priority: b.priority,
      startMinute: b.startMinute,
      label: b.label,
    }));
}

/**
 * Un tick del motor de parrilla (sin HTTP). Idempotente vía `lastAppliedScheduleBlockId`.
 * No usar junto con schedule-worker externo salvo que compartan la misma deduplicación (riesgo: doble trabajo).
 */
export async function runInternalScheduleTick(replaceQueue: boolean, env: Env): Promise<void> {
  await ensureMainStation();
  const station = await prisma.station.findUnique({ where: { id: MAIN_STATION_ID } });
  if (!station?.autoScheduleEnabled) return;

  const active = await getActiveScheduleBlocksNow();
  const winner = pickWinningBlock(active);
  if (!winner?.playlistId) return;

  const persisted = station.lastAppliedScheduleBlockId ?? null;
  if (winner.id === persisted) return;

  await syncQueueFromPlaylist({
    playlistId: winner.playlistId,
    replace: replaceQueue,
    scheduleBlockId: winner.id,
    userId: null,
    env,
  });
}

export type ApplyActiveScheduleOutcome = {
  applied: boolean;
  reason: ApiScheduleApplyActiveReason;
  block: ScheduleBlockHint | null;
  station: StationStatePayload | null;
};

/** Aplica manualmente el bloque ganador del minuto actual (no exige `autoScheduleEnabled`). */
export async function applyActiveScheduleBlock(opts: {
  replace: boolean;
  force: boolean;
  userId: string | null;
  env: Env;
}): Promise<ApplyActiveScheduleOutcome> {
  await ensureMainStation();
  const active = await getActiveScheduleBlocksNow();
  const winner = pickWinningBlock(active);

  if (!winner) {
    const reason: ApiScheduleApplyActiveReason =
      active.length === 0 ? "no_active_block" : "no_playlist_on_block";
    const block = active.length > 0 ? active.sort((a, b) => b.priority - a.priority)[0]! : null;
    return { applied: false, reason, block, station: null };
  }

  const station = await prisma.station.findUnique({ where: { id: MAIN_STATION_ID } });
  const persisted = station?.lastAppliedScheduleBlockId ?? null;
  if (!opts.force && winner.id === persisted) {
    return {
      applied: false,
      reason: "already_applied",
      block: winner,
      station: await getStationState(),
    };
  }

  try {
    const stationState = await syncQueueFromPlaylist({
      playlistId: winner.playlistId!,
      replace: opts.replace,
      scheduleBlockId: winner.id,
      userId: opts.userId,
      env: opts.env,
    });
    return { applied: true, reason: "applied", block: winner, station: stationState };
  } catch (e) {
    if (e instanceof SyncPlaylistError) {
      return { applied: false, reason: "no_playlist_on_block", block: winner, station: null };
    }
    throw e;
  }
}

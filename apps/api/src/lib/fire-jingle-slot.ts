import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { appendToStationQueue } from "../services/station-queue.js";
import {
  broadcastOnly,
  logAndBroadcastQueueAppend,
  logAndBroadcastSkip,
} from "../services/station-events.js";
import { MAIN_STATION_ID } from "../services/station-state.js";
import { skipStation } from "../services/station-skip.js";
import { resetHeadlessPlayoutSegment } from "../services/headless-playout.js";
import {
  isJingleSlotKey,
  normalizeJinglePageKey,
  resolveJingleFireMode,
  shouldSkipAfterCartInsert,
} from "./jingle-fire-mode.js";

export async function fireJingleSlot(input: {
  slotKey: string;
  pageKey?: string;
  playNext?: boolean;
  playNow?: boolean;
  userId?: string | null;
  env: Env;
}): Promise<
  | { ok: true; assetId: string; label: string; playNow: boolean }
  | { ok: false; error: string }
> {
  const slotKey = input.slotKey.trim();
  if (!isJingleSlotKey(slotKey)) {
    return { ok: false, error: "Tecla de cart inválida" };
  }
  const pk = normalizeJinglePageKey(input.pageKey);
  const mode = resolveJingleFireMode({
    playNext: input.playNext,
    playNow: input.playNow,
  });

  const row = await prisma.jingleSlot.findUnique({
    where: { stationId_pageKey_slotKey: { stationId: MAIN_STATION_ID, pageKey: pk, slotKey } },
    include: { asset: { select: { id: true, title: true } } },
  });
  if (!row?.assetId) {
    return { ok: false, error: `Sin audio en página ${pk}, tecla ${slotKey}` };
  }

  const stationBefore = await prisma.station.findUniqueOrThrow({ where: { id: MAIN_STATION_ID } });
  const countBefore = await prisma.playQueueItem.count({ where: { stationId: MAIN_STATION_ID } });
  const cur = stationBefore.currentPosition;
  const hadOnAir = countBefore > 0 && cur >= 0 && cur < countBefore;

  await appendToStationQueue({
    stationId: MAIN_STATION_ID,
    assetId: row.assetId,
    playNext: mode.playNext,
    env: input.env,
  });

  await logAndBroadcastQueueAppend({
    userId: input.userId ?? null,
    assetId: row.assetId,
    details: {
      source: "cart_wall",
      pageKey: pk,
      slotKey,
      playNow: mode.playNow,
    },
  });

  if (shouldSkipAfterCartInsert(mode.playNow, hadOnAir)) {
    const skipResult = await skipStation({ stationId: MAIN_STATION_ID, env: input.env });
    resetHeadlessPlayoutSegment();
    await logAndBroadcastSkip({
      userId: input.userId ?? null,
      assetId: skipResult.nowItem?.assetId ?? row.assetId,
      details: {
        ...skipResult.logDetails,
        source: "cart_wall_play_now",
        pageKey: pk,
        slotKey,
      },
    });
  } else if (mode.playNow && !hadOnAir) {
    await prisma.station.update({
      where: { id: MAIN_STATION_ID },
      data: { currentPosition: 0 },
    });
    resetHeadlessPlayoutSegment();
    await broadcastOnly();
  }

  return {
    ok: true,
    assetId: row.assetId,
    label: row.label ?? row.asset?.title ?? slotKey,
    playNow: mode.playNow,
  };
}

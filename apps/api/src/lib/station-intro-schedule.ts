import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import {
  isOnScheduledSpotBoundary,
  isScheduledSpotInterval,
  scheduledSpotSlotKey,
} from "./scheduled-spot-interval.js";
import { scheduleStationIntroAfterCurrent } from "./station-intro-play.js";

/**
 * Intro de emisora automática cada 15 / 30 / 60 min (reloj del PC),
 * insertada al terminar la canción al aire.
 */
export async function runStationIntroScheduleTick(env: Env, now = new Date()): Promise<void> {
  const settings = await getOrCreateSettings();
  const intervalRaw = settings.stationIntroIntervalMin ?? 0;
  if (!isScheduledSpotInterval(intervalRaw) || intervalRaw === 0) return;
  const source = (settings.stationIntroSourceAbs ?? "").trim();
  if (!source) return;
  if (!isOnScheduledSpotBoundary(now, intervalRaw)) return;

  const slotKey = scheduledSpotSlotKey(now, intervalRaw);
  if (settings.stationIntroLastSlotKey === slotKey) return;

  await prisma.appSettings.update({
    where: { id: "global" },
    data: { stationIntroLastSlotKey: slotKey },
  });

  const result = await scheduleStationIntroAfterCurrent(env);
  if (!result.ok) {
    await prisma.appSettings.update({
      where: { id: "global" },
      data: { stationIntroLastSlotKey: null },
    });
  }
}

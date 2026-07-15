import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import {
  isOnScheduledSpotBoundary,
  isScheduledSpotInterval,
  scheduledSpotSlotKey,
} from "./scheduled-spot-interval.js";
import { scheduleTimeAnnounceAfterCurrent } from "./time-announce-play.js";

/**
 * Si la locución automática está activa y el reloj del PC cae en un límite
 * (cada 15 / 30 / 60 min), programa la locución al terminar la canción al aire.
 */
export async function runTimeAnnounceScheduleTick(env: Env, now = new Date()): Promise<void> {
  const settings = await getOrCreateSettings();
  const intervalRaw = settings.timeAnnounceIntervalMin ?? 0;
  if (!isScheduledSpotInterval(intervalRaw) || intervalRaw === 0) return;
  const folder = (settings.timeAnnounceFolderAbs ?? "").trim();
  if (!folder) return;
  if (!isOnScheduledSpotBoundary(now, intervalRaw)) return;

  const slotKey = scheduledSpotSlotKey(now, intervalRaw);
  if (settings.timeAnnounceLastSlotKey === slotKey) return;

  await prisma.appSettings.update({
    where: { id: "global" },
    data: { timeAnnounceLastSlotKey: slotKey },
  });

  const result = await scheduleTimeAnnounceAfterCurrent(env, {
    folderAbs: folder,
    slotKey,
    now,
  });
  if (!result.ok) {
    await prisma.appSettings.update({
      where: { id: "global" },
      data: { timeAnnounceLastSlotKey: null },
    });
  }
}

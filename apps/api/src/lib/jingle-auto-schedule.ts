import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import {
  isOnScheduledSpotBoundary,
  isScheduledSpotInterval,
  scheduledSpotSlotKey,
} from "./scheduled-spot-interval.js";
import { scheduleJingleAutoAfterCurrent } from "./jingle-auto-play.js";

/**
 * Si el jingle automático por tiempo está activo y el reloj cae en el límite
 * (cada 15 / 30 / 60 min), programa un marcador `jingle_auto` al terminar la canción al aire.
 */
export async function runJingleAutoScheduleTick(env: Env, now = new Date()): Promise<void> {
  const settings = await getOrCreateSettings();
  const intervalRaw = settings.jingleAutoIntervalMin ?? 0;
  if (!isScheduledSpotInterval(intervalRaw) || intervalRaw === 0) return;
  if (!isOnScheduledSpotBoundary(now, intervalRaw)) return;

  const slotKey = scheduledSpotSlotKey(now, intervalRaw);
  if (settings.jingleAutoLastTimeSlotKey === slotKey) return;

  await prisma.appSettings.update({
    where: { id: "global" },
    data: { jingleAutoLastTimeSlotKey: slotKey },
  });

  const result = await scheduleJingleAutoAfterCurrent(env);
  if (!result.ok) {
    await prisma.appSettings.update({
      where: { id: "global" },
      data: { jingleAutoLastTimeSlotKey: null },
    });
  }
}


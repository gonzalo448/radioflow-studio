import type { Env } from "../config.js";
import { runJingleAutoScheduleTick } from "./jingle-auto-schedule.js";
import { runStationIntroScheduleTick } from "./station-intro-schedule.js";
import { runTimeAnnounceScheduleTick } from "./time-announce-schedule.js";

let spotsTickInFlight = false;

/**
 * Un solo tick serializado: intro → locución → jingle.
 * Evita inserts concurrentes en la misma posición que hacen sonar spots
 * desordenados o encima de la música por carreras con el crossfade.
 */
export async function runScheduledSpotsTick(env: Env, now = new Date()): Promise<void> {
  if (spotsTickInFlight) return;
  spotsTickInFlight = true;
  try {
    await runStationIntroScheduleTick(env, now);
    await runTimeAnnounceScheduleTick(env, now);
    await runJingleAutoScheduleTick(env, now);
  } finally {
    spotsTickInFlight = false;
  }
}

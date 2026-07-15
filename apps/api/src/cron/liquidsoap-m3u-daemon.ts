/**
 * Proceso permanente con node-cron (equivalente a un worker aparte; en Docker ver perfil `liquidsoap-cron`).
 */
import "dotenv/config";
import cron from "node-cron";
import { loadEnv } from "../config.js";
import { regenerateAllLiquidsoapM3u } from "../lib/liquidsoap-m3u-generator.js";

loadEnv();

const schedule = process.env.LIQUIDSOAP_CRON_SCHEDULE?.trim() || "0 * * * *";
const tz = process.env.LIQUIDSOAP_CRON_TZ?.trim();

async function runOnce() {
  try {
    console.log("[liquidsoap-cron] Generando playlists...");
    const r = await regenerateAllLiquidsoapM3u();
    console.log(
      `[liquidsoap-cron] Listo: ${r.written} archivos en ${r.outDir} · cola=${r.stationQueueTracks} · eventos=${r.eventoTracks}`,
    );
  } catch (e) {
    console.error("[liquidsoap-cron] Error:", e);
  }
}

if (process.env.LIQUIDSOAP_CRON_RUN_ON_START === "1") {
  void runOnce();
}

if (tz) {
  cron.schedule(schedule, () => void runOnce(), { timezone: tz });
} else {
  cron.schedule(schedule, () => void runOnce());
}

console.log(`[liquidsoap-cron] Programado: "${schedule}"${tz ? ` · TZ=${tz}` : ""}`);

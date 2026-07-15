import "dotenv/config";
import { loadEnv } from "../config.js";
import { prisma } from "../db.js";
import { processNextLibraryProcessJob } from "../lib/library-process-worker-tick.js";

const pollMs = Math.max(500, Number(process.env.LIBRARY_PROCESS_WORKER_POLL_MS ?? "2500"));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const env = loadEnv();
  console.info(`[library-process-worker] poll ${pollMs} ms — Ctrl+C (mismo MEDIA_ROOT que la API).`);
  for (;;) {
    const ran = await processNextLibraryProcessJob(env);
    if (!ran) {
      await sleep(pollMs);
      continue;
    }
    console.info("[library-process-worker] job procesado");
  }
}

main().catch((err) => {
  console.error("[library-process-worker] error fatal:", err);
  process.exit(1);
});

import type { Env } from "../config.js";
import { claimNextLibraryProcessJob, executeLibraryProcessJob } from "./library-process-job-runner.js";

/** Toma un job pendiente de la cola y lo ejecuta. Devuelve true si había trabajo. */
export async function processNextLibraryProcessJob(env: Env): Promise<boolean> {
  const job = await claimNextLibraryProcessJob(env);
  if (!job) return false;
  await executeLibraryProcessJob(job, env);
  return true;
}

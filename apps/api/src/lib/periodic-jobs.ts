import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Env } from "../config.js";
import { cleanupOldLibraryProcessJobs } from "./library-process-job-cleanup.js";
import { processNextLibraryProcessJob } from "./library-process-worker-tick.js";
import { cleanupRefreshTokens } from "./refresh-token-cleanup.js";
import { runInternalScheduleTick } from "../services/internal-scheduler.js";
import { runLibraryAutoUpdateTick } from "../services/library-auto-update.js";
import { runCueDetectBackfillTick } from "./cue-detect-backfill.js";
import { runSchedulerEventsTick } from "../services/scheduler-events.js";
import { runAdSchedulerTick } from "../services/ad-scheduler.js";
import { runHeadlessPlayoutTick } from "../services/headless-playout.js";
import { runListenerSampleTick } from "../services/listener-sample-tick.js";
import { runStreamingFailoverTick } from "../services/streaming-failover-tick.js";
import { runIcecastSourceAlertTick } from "../services/icecast-source-alert-tick.js";
import { regenerateAllLiquidsoapM3u } from "../lib/liquidsoap-m3u-generator.js";
import { runScheduledSpotsTick } from "./scheduled-spots-tick.js";
import { runAutoDjRefillTick } from "../services/autodj-refill.js";
import { resolveScheduleApplyMode } from "./schedule-apply-mode.js";

export type PeriodicJobsHandle = {
  stop(): void;
};

function trackInterval(
  handles: ReturnType<typeof setInterval>[],
  fn: () => void,
  intervalMs: number,
  runOnStart = true,
): void {
  if (runOnStart) fn();
  handles.push(setInterval(fn, intervalMs));
}

function registerMaintenanceJobs(app: FastifyInstance, env: Env, handles: ReturnType<typeof setInterval>[]): void {
  const log = app.log;

  const cleanupMin = env.REFRESH_TOKEN_CLEANUP_INTERVAL_MIN;
  if (cleanupMin > 0) {
    const run = () => {
      void cleanupRefreshTokens({
        revokedRetentionDays: env.REFRESH_TOKEN_REVOKED_RETENTION_DAYS,
        expiredRetentionDays: env.REFRESH_TOKEN_EXPIRED_RETENTION_DAYS,
        maxDelete: env.REFRESH_TOKEN_CLEANUP_MAX_DELETE,
      })
        .then((deleted) => {
          if (deleted > 0) log.info({ deleted }, "refresh token cleanup");
        })
        .catch((err) => log.error({ err }, "refresh token cleanup failed"));
    };
    trackInterval(handles, run, cleanupMin * 60_000);
  }

  const jobCleanupMin = env.LIBRARY_PROCESS_JOB_CLEANUP_INTERVAL_MIN;
  if (jobCleanupMin > 0 && env.LIBRARY_PROCESS_JOB_RETENTION_DAYS > 0) {
    const runJobCleanup = () => {
      void cleanupOldLibraryProcessJobs({
        retentionDays: env.LIBRARY_PROCESS_JOB_RETENTION_DAYS,
        maxDelete: env.LIBRARY_PROCESS_JOB_CLEANUP_MAX_DELETE,
      })
        .then((deleted) => {
          if (deleted > 0) log.info({ deleted }, "library process job cleanup");
        })
        .catch((err) => log.error({ err }, "library process job cleanup failed"));
    };
    trackInterval(handles, runJobCleanup, jobCleanupMin * 60_000);
  }

  const libraryPollMs = Math.max(500, env.LIBRARY_PROCESS_WORKER_POLL_MS);
  const runLibraryJobs = () => {
    void processNextLibraryProcessJob(env).catch((err) =>
      log.error({ err }, "library process job tick failed"),
    );
  };
  // B2: primer tick al arrancar para no dejar la cola idle hasta el primer intervalo
  trackInterval(handles, runLibraryJobs, libraryPollMs, true);

  const cueBackfillPoll = env.CUE_DETECT_BACKFILL_POLL_MS;
  if (cueBackfillPoll > 0 && env.CUE_DETECT_BACKFILL_ENABLED) {
    const tickCues = () => {
      void runCueDetectBackfillTick(env).catch((err) => log.error({ err }, "cue detect backfill tick failed"));
    };
    // Arranque diferido ~12 s para no competir con el boot (migraciones / enrich de cola)
    setTimeout(() => tickCues(), 12_000);
    handles.push(setInterval(tickCues, cueBackfillPoll));
  }

  const autoUpdatePoll = env.LIBRARY_AUTO_UPDATE_POLL_MS;
  if (autoUpdatePoll > 0) {
    const tickAutoUpdate = () => {
      void runLibraryAutoUpdateTick(env).catch((err) => log.error({ err }, "library auto-update tick failed"));
    };
    trackInterval(handles, tickAutoUpdate, autoUpdatePoll, false);
  }

  const listenerPoll = env.LISTENER_SAMPLE_POLL_MS;
  if (listenerPoll > 0) {
    const tickListeners = () => {
      void runListenerSampleTick(env).catch((err) => log.error({ err }, "listener sample tick failed"));
    };
    trackInterval(handles, tickListeners, listenerPoll, true);
  }

  const failoverPoll = Math.max(30_000, listenerPoll > 0 ? listenerPoll : 60_000);
  const tickFailover = () => {
    void runStreamingFailoverTick().catch((err) => log.error({ err }, "streaming failover tick failed"));
  };
  trackInterval(handles, tickFailover, failoverPoll, false);

  const sourceAlertPoll = env.ICECAST_SOURCE_ALERT_POLL_MS;
  if (sourceAlertPoll > 0) {
    const tickSourceAlert = () => {
      void runIcecastSourceAlertTick(env).catch((err) => log.error({ err }, "icecast source alert tick failed"));
    };
    trackInterval(handles, tickSourceAlert, sourceAlertPoll, false);
  }

  const liquidsoapPoll = env.LIQUIDSOAP_M3U_POLL_MS;
  if (liquidsoapPoll > 0) {
    log.warn(
      { pollMs: liquidsoapPoll },
      "Liquidsoap M3U poll activo (legacy). Path por defecto al aire es encoder→Icecast; no uses ambos en el mismo mount.",
    );
    const tickLiquidsoap = () => {
      void regenerateAllLiquidsoapM3u(env).catch((err) => log.error({ err }, "liquidsoap m3u tick failed"));
    };
    trackInterval(handles, tickLiquidsoap, liquidsoapPoll, true);
  }
}

function registerAutomationJobs(app: FastifyInstance, env: Env, handles: ReturnType<typeof setInterval>[]): void {
  const log = app.log;

  const resolved = resolveScheduleApplyMode({
    scheduleApplyMode: env.SCHEDULE_APPLY_MODE,
    internalSchedulePollMs: env.INTERNAL_SCHEDULE_POLL_MS,
    scheduleWorkerExpected: env.SCHEDULE_WORKER_EXPECTED === true,
  });
  if (resolved.warn) {
    log.warn({ schedule: resolved }, resolved.warn);
  }

  const poll = resolved.effectiveInternalPollMs;
  if (poll > 0) {
    const replace = env.SCHEDULE_REPLACE_QUEUE;
    log.info(
      { pollMs: poll, replaceQueue: replace, mode: resolved.mode },
      "C3 parrilla: aplicador interno activo (ScheduleBlock → cola). No corrás schedule-worker en paralelo.",
    );
    const tick = () => {
      void runInternalScheduleTick(replace, env).catch((err) => log.error({ err }, "internal-scheduler"));
    };
    trackInterval(handles, tick, poll);
  } else if (resolved.mode === "worker") {
    log.info(
      { mode: resolved.mode },
      "C3 parrilla: modo worker — INTERNAL_SCHEDULE_POLL_MS efectivo=0; apply vía @radioflow/schedule-worker.",
    );
  }

  const spoll = env.SCHEDULER_EVENTS_POLL_MS;
  if (spoll > 0) {
    const tick = () => {
      void runSchedulerEventsTick(env).catch((err) => log.error({ err }, "scheduler-events"));
    };
    trackInterval(handles, tick, spoll, env.SCHEDULER_EVENTS_RUN_ON_BOOT);
  }

  // Spots diferidos (intro → locución → jingle) en un solo tick serializado.
  if (spoll > 0) {
    const tick = () => {
      void runScheduledSpotsTick(env).catch((err) => log.error({ err }, "scheduled-spots"));
    };
    trackInterval(handles, tick, Math.max(spoll, 5000), false);
  }

  // AutoDJ: buffer mínimo desde playlist activa de Cabina (no requiere autoScheduleEnabled).
  if (spoll > 0) {
    const tick = () => {
      void runAutoDjRefillTick(env).catch((err) => log.error({ err }, "autodj-refill"));
    };
    trackInterval(handles, tick, Math.max(spoll, 5000), false);
  }

  const adsPoll = env.ADS_SCHEDULER_POLL_MS;
  if (adsPoll > 0) {
    const tick = () => {
      void runAdSchedulerTick(env).catch((err) => log.error({ err }, "ad-scheduler"));
    };
    trackInterval(handles, tick, adsPoll, false);
  }

  if (env.HEADLESS_PLAYOUT_POLL_MS > 0) {
    const tick = () => {
      void runHeadlessPlayoutTick(env).catch((err) => log.error({ err }, "headless-playout"));
    };
    trackInterval(handles, tick, env.HEADLESS_PLAYOUT_POLL_MS, false);
  }
}

/**
 * Tareas periódicas en segundo plano (no HTTP). Separadas del servidor Fastify para poder detenerlas en shutdown.
 *
 * Modos (`API_BACKGROUND_MODE`):
 * - `http-only`: ninguna (recomendado con workers externos dedicados).
 * - `maintenance`: limpieza de tokens y jobs de biblioteca.
 * - `automation`: parrilla interna y scheduler de eventos (según poll ms).
 * - `full`: mantenimiento + automatización (desarrollo / despliegue todo-en-uno).
 */
export function startPeriodicJobs(app: FastifyInstance, env: Env): PeriodicJobsHandle {
  const handles: ReturnType<typeof setInterval>[] = [];
  const mode = env.API_BACKGROUND_MODE;

  logBackgroundMode(app.log, mode);

  if (mode === "maintenance" || mode === "full") {
    registerMaintenanceJobs(app, env, handles);
  }

  if (mode === "automation" || mode === "full") {
    registerAutomationJobs(app, env, handles);
  }

  return {
    stop() {
      for (const handle of handles) clearInterval(handle);
      handles.length = 0;
      app.log.info({ mode }, "Tareas periódicas detenidas");
    },
  };
}

function logBackgroundMode(log: FastifyBaseLogger, mode: Env["API_BACKGROUND_MODE"]): void {
  const hint =
    mode === "http-only"
      ? "Solo HTTP; use schedule-worker y library-process-worker por separado."
      : mode === "maintenance"
        ? "Limpieza + cola de biblioteca (process-jobs) + backfill de cues; parrilla/eventos externos."
        : mode === "automation"
          ? "Automatización en proceso API; sin limpieza de mantenimiento."
          : "Mantenimiento, cola de biblioteca y automatización en el mismo proceso.";
  log.info({ mode }, `Modo de tareas en segundo plano: ${hint}`);
}

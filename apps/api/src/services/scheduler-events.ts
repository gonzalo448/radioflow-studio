import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { isSqliteDatabaseUrl } from "../lib/db-dialect.js";
import { assertAssetPlayableInVault } from "../lib/library-vault.js";
import { adBreakPayloadSchema } from "../lib/ad-scheduler-body.js";
import { schedulerGeneratePayloadSchema } from "../lib/playlist-generator-body.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { playAdBreak } from "./ad-scheduler.js";
import { playTimeAnnounceNow } from "../lib/time-announce-play.js";
import { generatePlaylistPro, parsedBodyToGeneratorInput } from "./playlist-generator.js";
import { syncQueueFromPlaylist } from "./queue-from-playlist.js";
import { ensureMainStation } from "./station-state.js";
import { skipStation } from "./station-skip.js";
import { startStreamRecording, stopStreamRecording } from "../lib/stream-recorder.js";
import { logAutomation } from "../lib/automation-log.js";

export type SchedulerCommand =
  | "STATION_SKIP"
  | "QUEUE_FROM_PLAYLIST_REPLACE"
  | "QUEUE_FROM_PLAYLIST_APPEND"
  | "STATION_MODE_AUTO"
  | "STATION_MODE_LIVE"
  | "STATION_MODE_LIVE_ASSIST"
  | "CLEAR_QUEUE"
  | "PLAY_JINGLE_SLOT"
  | "STREAM_RECORD_START"
  | "STREAM_RECORD_STOP";

export type SchedulerAction =
  | { type: "PLAY_PLAYLIST"; playlistId: string; replaceQueue?: boolean }
  | { type: "PLAY_ASSET"; assetId: string }
  | { type: "RUN_COMMAND"; command: SchedulerCommand; args?: Record<string, unknown> }
  | { type: "GENERATE_AND_PLAY_PLAYLIST"; replaceQueue?: boolean; generate: ReturnType<typeof schedulerGeneratePayloadSchema.parse>["generate"] }
  | { type: "PLAY_AD_BREAK"; spotCount?: number; pathPrefix?: string }
  | { type: "TIME_ANNOUNCE"; afterCurrent?: boolean; folderAbs?: string | null };

function parseAction(actionType: string, payload: unknown): SchedulerAction {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (actionType === "PLAY_PLAYLIST") {
    const playlistId = String(p.playlistId ?? "");
    const replaceQueue = p.replaceQueue === true;
    return { type: "PLAY_PLAYLIST", playlistId, replaceQueue };
  }
  if (actionType === "PLAY_ASSET") {
    const assetId = String(p.assetId ?? "");
    return { type: "PLAY_ASSET", assetId };
  }
  if (actionType === "GENERATE_AND_PLAY_PLAYLIST") {
    const parsed = schedulerGeneratePayloadSchema.parse(payload);
    return {
      type: "GENERATE_AND_PLAY_PLAYLIST",
      generate: parsed.generate,
      replaceQueue: parsed.replaceQueue,
    };
  }
  if (actionType === "PLAY_AD_BREAK") {
    const parsed = adBreakPayloadSchema.parse(payload ?? {});
    return {
      type: "PLAY_AD_BREAK",
      spotCount: parsed.spotCount,
      pathPrefix: parsed.pathPrefix,
    };
  }
  if (actionType === "TIME_ANNOUNCE") {
    const afterCurrent = p.afterCurrent !== false;
    const folderAbs =
      typeof p.folderAbs === "string" && p.folderAbs.trim() ? p.folderAbs.trim() : null;
    return { type: "TIME_ANNOUNCE", afterCurrent, folderAbs };
  }
  const command = String(p.command ?? "") as SchedulerCommand;
  return { type: "RUN_COMMAND", command, args: (p.args as Record<string, unknown> | undefined) ?? undefined };
}

async function execAction(actionType: string, payload: unknown, env: Env): Promise<void> {
  const action = parseAction(actionType, payload);

  if (action.type === "PLAY_PLAYLIST") {
    if (!action.playlistId) throw new Error("playlistId requerido");
    await syncQueueFromPlaylist({
      playlistId: action.playlistId,
      replace: action.replaceQueue ?? false,
      scheduleBlockId: null,
      userId: null,
      env,
    });
    return;
  }

  if (action.type === "GENERATE_AND_PLAY_PLAYLIST") {
    const generated = await generatePlaylistPro(env, parsedBodyToGeneratorInput(action.generate));
    await syncQueueFromPlaylist({
      playlistId: generated.playlistId,
      replace: action.replaceQueue ?? true,
      scheduleBlockId: null,
      userId: null,
      env,
    });
    return;
  }

  if (action.type === "PLAY_AD_BREAK") {
    await playAdBreak({
      env,
      source: "scheduler",
      spotCount: action.spotCount,
      pathPrefix: action.pathPrefix,
    });
    return;
  }

  if (action.type === "TIME_ANNOUNCE") {
    const result = await playTimeAnnounceNow(env, {
      folderAbs: action.folderAbs,
      afterCurrent: action.afterCurrent !== false,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "No se pudo anunciar la hora");
    }
    return;
  }

  if (action.type === "PLAY_ASSET") {
    if (!action.assetId) throw new Error("assetId requerido");
    await ensureMainStation();
    const asset = await prisma.mediaAsset.findUnique({ where: { id: action.assetId } });
    if (!asset) throw new Error("Asset no encontrado");
    assertAssetPlayableInVault(asset, env);
    const last = await prisma.playQueueItem.findFirst({ where: { stationId: "main" }, orderBy: { position: "desc" } });
    const position = (last?.position ?? -1) + 1;
    await prisma.playQueueItem.create({ data: { stationId: "main", assetId: asset.id, position } });
    void broadcastStationState();
    return;
  }

  if (action.type === "RUN_COMMAND") {
    if (action.command === "STATION_SKIP") {
      await skipStation({ stationId: "main", env });
      void broadcastStationState();
      return;
    }
    if (action.command === "STATION_MODE_AUTO" || action.command === "STATION_MODE_LIVE" || action.command === "STATION_MODE_LIVE_ASSIST") {
      const mode =
        action.command === "STATION_MODE_AUTO"
          ? "AUTO"
          : action.command === "STATION_MODE_LIVE"
            ? "LIVE"
            : "LIVE_ASSIST";
      await prisma.station.update({ where: { id: "main" }, data: { mode } });
      void broadcastStationState();
      return;
    }
    if (action.command === "CLEAR_QUEUE") {
      await prisma.playQueueItem.deleteMany({ where: { stationId: "main" } });
      await prisma.station.update({ where: { id: "main" }, data: { currentPosition: 0 } });
      void broadcastStationState();
      return;
    }
    if (action.command === "PLAY_JINGLE_SLOT") {
      const slotKey = String((action.args ?? {}).slotKey ?? "1");
      const pageKey = String((action.args ?? {}).pageKey ?? "A");
      const slot = await prisma.jingleSlot.findUnique({
        where: { stationId_pageKey_slotKey: { stationId: "main", pageKey, slotKey } },
      });
      if (!slot) throw new Error(`Cart ${pageKey}${slotKey} sin asignar`);
      const last = await prisma.playQueueItem.findFirst({ where: { stationId: "main" }, orderBy: { position: "desc" } });
      const position = (last?.position ?? -1) + 1;
      await prisma.playQueueItem.create({
        data: { stationId: "main", assetId: slot.assetId, position, kind: "track" },
      });
      void broadcastStationState();
      return;
    }
    if (action.command === "QUEUE_FROM_PLAYLIST_REPLACE" || action.command === "QUEUE_FROM_PLAYLIST_APPEND") {
      const playlistId = String((action.args ?? {}).playlistId ?? "");
      if (!playlistId) throw new Error("args.playlistId requerido");
      await syncQueueFromPlaylist({
        playlistId,
        replace: action.command === "QUEUE_FROM_PLAYLIST_REPLACE",
        scheduleBlockId: null,
        userId: null,
        env,
      });
      return;
    }
    if (action.command === "STREAM_RECORD_START") {
      await startStreamRecording(env);
      return;
    }
    if (action.command === "STREAM_RECORD_STOP") {
      await stopStreamRecording(env);
      return;
    }
    throw new Error("Comando no soportado");
  }
}

/**
 * Tick idempotente multi-réplica:
 * usa advisory lock de Postgres para evitar doble ejecución simultánea.
 */
export async function runSchedulerEventsTick(env: Env): Promise<void> {
  const tick = async () => {
    const now = new Date();
    const due = await prisma.schedulerEvent.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
      take: 20,
    });

    for (const ev of due) {
      const startedAt = new Date();
      const run = await prisma.schedulerRun.create({
        data: { eventId: ev.id, status: "success", startedAt },
      });
      try {
        const repeatMin = (ev as { repeatIntervalMin?: number | null }).repeatIntervalMin ?? 0;
        const isRecurring = Number.isFinite(repeatMin) && repeatMin > 0;
        const nextRunAt = isRecurring ? new Date((ev.nextRunAt ?? now).getTime() + repeatMin * 60_000) : null;
        await prisma.schedulerEvent.update({
          where: { id: ev.id },
          data: { nextRunAt, enabled: isRecurring ? true : false },
        });
        await execAction(ev.actionType, ev.payload, env);
        logAutomation("scheduler_event", {
          eventId: ev.id,
          name: ev.name,
          actionType: ev.actionType,
        });
        await prisma.schedulerRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: "success" } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error";
        // Si falló y era recurrente, se reintentará en el próximo slot.
        await prisma.schedulerRun.update({
          where: { id: run.id },
          data: { finishedAt: new Date(), status: "error", error: msg },
        });
      }
    }
  };

  if (isSqliteDatabaseUrl()) {
    await tick();
    return;
  }

  // Candado de transacción (pg_try_advisory_xact_lock): con el pool de Prisma,
  // lock y unlock de sesión pueden caer en conexiones distintas y dejar el
  // candado tomado para siempre (ticks silenciosamente muertos). El candado
  // xact se libera solo al terminar la transacción, incluso ante timeout.
  const lockId = 915_000_001;
  await prisma.$transaction(
    async (tx) => {
      const got = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${lockId}) AS locked`;
      if (!got?.[0]?.locked) return;
      await tick();
    },
    { maxWait: 5_000, timeout: 60_000 },
  );
}

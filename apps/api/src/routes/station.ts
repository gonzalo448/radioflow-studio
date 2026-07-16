import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  ApiError,
  ApiStationDtmfBody,
  ApiStationPatchBody,
  ApiStationQueueAppendBody,
  ApiStationQueueAppendBulkBody,
  ApiStationQueueFromPlaylistBody,
  ApiStationQueueItem,
  ApiStationState,
  ApiStation,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_STATION_WRITE } from "../lib/auth.js";
import { SyncPlaylistError, syncQueueFromPlaylist } from "../services/queue-from-playlist.js";
import { ensureMainStation, getStationState, MAIN_STATION_ID } from "../services/station-state.js";
import { enrichStationState } from "../services/now-playing.js";
import { resolvePublicApiOrigin } from "../lib/api-base-url.js";
import {
  appendManyToStationQueue,
  appendToStationQueue,
  deleteFromStationQueue,
} from "../services/station-queue.js";
import {
  addToPlaybackQueue,
  pruneStalePlaybackQueueEntries,
  removeFromPlaybackQueue,
} from "../services/station-playback-queue.js";
import { skipStation } from "../services/station-skip.js";
import {
  logAndBroadcastQueueAppend,
  logAndBroadcastQueueRemove,
  logAndBroadcastSkip,
  logAndBroadcastStationUpdate,
  broadcastOnly,
} from "../services/station-events.js";
import { resetHeadlessPlayoutSegment, touchPlayoutClientHeartbeat } from "../services/headless-playout.js";
import { handleDtmfDigit, parseDtmfActionsJson, serializeDtmfActions } from "../lib/dtmf-actions.js";
import type { DtmfAction } from "../lib/dtmf-actions.js";
import { logAutomation } from "../lib/automation-log.js";

const dtmfActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("skip") }),
  z.object({
    type: z.literal("cart"),
    slotKey: z.string().min(1).max(2),
    pageKey: z.enum(["A", "B", "C"]).optional(),
  }),
  z.object({ type: z.literal("mode"), mode: z.enum(["AUTO", "LIVE", "LIVE_ASSIST"]) }),
]);

const patchStation = z.object({
  mode: z.enum(["AUTO", "LIVE_ASSIST", "LIVE"]).optional(),
  currentPosition: z.number().int().min(0).optional(),
  liveTitle: z.string().nullable().optional(),
  autoScheduleEnabled: z.boolean().optional(),
  cabCrossfadeSec: z.number().min(0).max(30).optional(),
  cabFadeInSec: z.number().min(0).max(30).optional(),
  cabFadeOutSec: z.number().min(0).max(30).optional(),
  /** Gap Killer: típ. −60…−20 dBFS. */
  cabSilenceThresholdDb: z.number().min(-80).max(-10).optional(),
  cabReferenceGainDb: z.number().min(-48).max(24).optional(),
  cabWebAudioEngine: z.boolean().optional(),
  dtmfActions: z.record(dtmfActionSchema).optional(),
});

const dtmfBody = z.object({
  digit: z.string().min(1).max(2),
});

const appendBody = z.object({
  assetId: z.string().min(1),
  playNext: z.boolean().optional(),
});

const appendBulkBody = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(200),
  playNext: z.boolean().optional(),
});

const fromPlaylistBody = z.object({
  playlistId: z.string().min(1),
  replace: z.boolean().default(false),
  scheduleBlockId: z.string().optional(),
});

const playbackQueueBody = z.object({
  playQueueItemId: z.string().min(1),
});

const playoutHeartbeatBody = z.object({
  queueItemId: z.string().optional(),
  playing: z.boolean().optional(),
  currentSec: z.number().min(0).optional(),
});

const airQualityBody = z.object({
  kind: z.enum(["air_silence", "air_clipping"]),
  peak01: z.number().min(0).max(1),
  assetId: z.string().optional(),
});

export const stationRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiStationState }>("/station", async (request) => {
    const origin = resolvePublicApiOrigin(request, opts.env);
    return (await enrichStationState(origin)) as unknown as ApiStationState;
  });

  app.post<{ Body: ApiStationQueueAppendBody; Reply: ApiStationQueueItem | ApiError }>(
    "/station/queue",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      await ensureMainStation();

      const body = appendBody.parse(request.body);
      const item = await appendToStationQueue({
        stationId: MAIN_STATION_ID,
        assetId: body.assetId,
        playNext: body.playNext ?? false,
        env: opts.env,
      });

      let prunedPlaybackQueue = 0;
      if (body.playNext) {
        prunedPlaybackQueue = await pruneStalePlaybackQueueEntries(MAIN_STATION_ID);
      }

      await logAndBroadcastQueueAppend({
        userId: request.userId ?? null,
        assetId: body.assetId,
        details: body.playNext
          ? {
              playNext: true,
              ...(prunedPlaybackQueue > 0 ? { prunedPlaybackQueue } : {}),
            }
          : undefined,
      });

      return reply.status(201).send(item);
    },
  );

  app.post<{ Body: ApiStationQueueAppendBulkBody; Reply: ApiStationQueueItem[] | ApiError }>(
    "/station/queue-bulk",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      await ensureMainStation();

      const body = appendBulkBody.parse(request.body);
      const playNext = body.playNext ?? false;
      const items = await appendManyToStationQueue({
        stationId: MAIN_STATION_ID,
        assetIds: body.assetIds,
        playNext,
        env: opts.env,
      });

      let prunedPlaybackQueue = 0;
      if (playNext) {
        prunedPlaybackQueue = await pruneStalePlaybackQueueEntries(MAIN_STATION_ID);
      }

      await logAndBroadcastQueueAppend({
        userId: request.userId ?? null,
        assetId: body.assetIds[0] ?? null,
        details: {
          bulk: true,
          count: items.length,
          ...(playNext ? { playNext: true } : {}),
          ...(prunedPlaybackQueue > 0 ? { prunedPlaybackQueue } : {}),
        },
      });

      return reply.status(201).send(items);
    },
  );

  app.post<{ Reply: ApiStationState | ApiError }>(
    "/station/queue-clear",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      await ensureMainStation();
      await prisma.playQueueItem.deleteMany({ where: { stationId: MAIN_STATION_ID } });
      await prisma.station.update({
        where: { id: MAIN_STATION_ID },
        data: {
          currentPosition: 0,
          autoDjActivePlaylistId: null,
          autoDjPlaylistCursor: 0,
        },
      });
      resetHeadlessPlayoutSegment();
      await logAndBroadcastStationUpdate({
        userId: request.userId ?? null,
        details: { action: "queue_clear" },
      });
      return getStationState();
    },
  );

  app.post<{ Body: ApiStationQueueFromPlaylistBody; Reply: ApiStationState | ApiError }>(
    "/station/queue-from-playlist",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;

      const body = fromPlaylistBody.parse(request.body);

      try {
        const state = await syncQueueFromPlaylist({
          playlistId: body.playlistId,
          replace: body.replace,
          scheduleBlockId: body.scheduleBlockId,
          userId: request.userId ?? null,
          env: opts.env,
        });

        return state;
      } catch (e) {
        if (e instanceof SyncPlaylistError) {
          if (e.code === "NOT_FOUND") {
            return reply.status(404).send({ error: e.message });
          }
          if (e.code === "EMPTY") {
            return reply.status(400).send({ error: e.message });
          }
        }
        throw e;
      }
    },
  );

  app.post<{ Body: { playQueueItemId: string } }>(
    "/station/playback-queue",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      await ensureMainStation();

      const body = playbackQueueBody.parse(request.body);
      const row = await addToPlaybackQueue({
        stationId: MAIN_STATION_ID,
        playQueueItemId: body.playQueueItemId,
      });

      const item = await prisma.playQueueItem.findFirst({
        where: { id: body.playQueueItemId, stationId: MAIN_STATION_ID },
      });

      await logAndBroadcastQueueAppend({
        userId: request.userId ?? null,
        assetId: item?.assetId ?? null,
        details: {
          playbackQueue: true,
          playQueueItemId: body.playQueueItemId,
          sortIndex: row.sortIndex,
        },
      });

      return reply.status(201).send(row);
    },
  );

  app.delete("/station/playback-queue/item/:playQueueItemId", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;

    const { playQueueItemId } = request.params as { playQueueItemId: string };
    await removeFromPlaybackQueue({
      stationId: MAIN_STATION_ID,
      playQueueItemId,
    });

    await broadcastOnly();
    return reply.status(204).send();
  });

  app.delete("/station/queue/:itemId", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    await ensureMainStation();

    const { itemId } = request.params as { itemId: string };
    const removed = await deleteFromStationQueue({
      stationId: MAIN_STATION_ID,
      itemId,
    });

    await logAndBroadcastQueueRemove({
      userId: request.userId ?? null,
      assetId: removed.assetId,
      queueItemId: itemId,
    });

    return reply.status(204).send();
  });

  app.patch<{ Body: ApiStationPatchBody; Reply: ApiStation | ApiError }>(
    "/station",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      await ensureMainStation();

      const body = patchStation.parse(request.body);

      const station = await prisma.station.update({
        where: { id: MAIN_STATION_ID },
        data: {
          ...(body.mode && { mode: body.mode }),
          ...(body.currentPosition !== undefined && { currentPosition: body.currentPosition }),
          ...(body.liveTitle !== undefined && { liveTitle: body.liveTitle }),
          ...(body.autoScheduleEnabled !== undefined && {
            autoScheduleEnabled: body.autoScheduleEnabled,
          }),
          ...(body.autoScheduleEnabled === false && { lastAppliedScheduleBlockId: null }),
          ...(body.cabCrossfadeSec !== undefined && {
            cabCrossfadeSec: body.cabCrossfadeSec,
          }),
          ...(body.cabFadeInSec !== undefined && {
            cabFadeInSec: body.cabFadeInSec,
          }),
          ...(body.cabFadeOutSec !== undefined && {
            cabFadeOutSec: body.cabFadeOutSec,
          }),
          ...(body.cabSilenceThresholdDb !== undefined && {
            cabSilenceThresholdDb: body.cabSilenceThresholdDb,
          }),
          ...(body.cabReferenceGainDb !== undefined && {
            cabReferenceGainDb: body.cabReferenceGainDb,
          }),
          ...(body.cabWebAudioEngine !== undefined && {
            cabWebAudioEngine: body.cabWebAudioEngine,
          }),
          ...(body.dtmfActions !== undefined && {
            dtmfActionsJson: serializeDtmfActions(body.dtmfActions as Record<string, DtmfAction>),
          }),
        },
      });

      await logAndBroadcastStationUpdate({
        userId: request.userId ?? null,
        details: body as Record<string, unknown>,
      });

      if (body.currentPosition !== undefined) {
        resetHeadlessPlayoutSegment();
      }

      const dtmfActions = parseDtmfActionsJson(station.dtmfActionsJson);
      return { ...(station as unknown as ApiStation), dtmfActions };
    },
  );

  app.post<{ Body: ApiStationDtmfBody; Reply: { ok: true; result: string } | ApiError }>(
    "/station/dtmf",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const body = dtmfBody.parse(request.body);
      try {
        const result = await handleDtmfDigit(body.digit, opts.env);
        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "DTMF no procesado";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post("/station/playout-heartbeat", async (request, reply) => {
    const body = playoutHeartbeatBody.parse(request.body ?? {});
    touchPlayoutClientHeartbeat(body.playing !== false);
    return reply.status(204).send();
  });

  app.post<{ Reply: ApiStationState | ApiError }>("/station/skip", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    await ensureMainStation();

    const result = await skipStation({ stationId: MAIN_STATION_ID, env: opts.env });
    resetHeadlessPlayoutSegment();

    await logAndBroadcastSkip({
      userId: request.userId ?? null,
      assetId: result.nowItem?.assetId ?? null,
      details: result.logDetails,
    });

    // Misma forma que queue-from-playlist / queue-clear: estado con cola (smoke B4 + clientes).
    return getStationState();
  });

  app.post("/station/air-quality-alert", async (request, reply) => {
    const body = airQualityBody.parse(request.body ?? {});
    logAutomation(body.kind, { peak01: body.peak01, source: "cabina-meter" }, body.assetId ?? null);
    return { ok: true };
  });
};
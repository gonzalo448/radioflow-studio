import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiBroadcastConfigPatchBody, ApiBroadcastStatus, ApiEncoderHeartbeatBody, ApiError, ApiSettings, ApiStreamRecordingStatus, ApiStreamRecordingStopResult, ApiStreamingEncoderUrl, ApiStreamingEncoderUrls, ApiStreamingTarget, ApiStreamingTargetCreateBody, ApiStreamingTargetPatchBody, StreamProtocol } from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import {
  optionalAuth,
  requireRoles,
  requireUser,
  ROLES_STATION_WRITE,
  ROLES_STREAMING_WRITE,
} from "../lib/auth.js";
import { buildEncoderSourceUrl } from "../lib/streaming-url.js";
import { extraIdsFromSettings, serializeExtraStreamingTargetIds } from "../lib/extra-streaming-targets.js";
import { probeIcecastStatus } from "../lib/icecast-status.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import { mapSettings } from "../routes/settings.js";
import { getEncoderHeartbeat, setEncoderHeartbeat } from "../services/encoder-status-store.js";
import { getPublicNowPlaying } from "../services/now-playing.js";
import { resolvePublicApiOrigin } from "../lib/api-base-url.js";
import {
  getStreamRecordingStatus,
  startStreamRecording,
  stopStreamRecording,
} from "../lib/stream-recorder.js";
import { readStreamingFailoverStatus } from "../services/streaming-failover-tick.js";
import { readIcecastSourceAlertStatus } from "../services/icecast-source-alert-tick.js";
import { resolveActiveListenUrl } from "../services/public-listen.js";

const targetBody = z.object({
  name: z.string().min(1),
  protocol: z.enum(["icecast", "shoutcast", "azuracast"]),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(8000),
  mountPath: z.string().default("/stream"),
  sourceUser: z.string().nullable().optional(),
  sourcePassword: z.string().min(1),
  publicBaseUrl: z.string().max(2048).nullable().optional(),
  tls: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

const patchBody = targetBody
  .partial()
  .extend({
    sourcePassword: z.string().min(1).optional(),
  });

const heartbeatBody = z.object({
  ffmpegActive: z.boolean(),
  wsConnected: z.boolean(),
  title: z.string().nullable().optional(),
  artist: z.string().nullable().optional(),
  album: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  coverUrl: z.string().max(2048).nullable().optional(),
  stationLogoUrl: z.string().max(2048).nullable().optional(),
  lastFfmpegExitCode: z.number().int().nullable().optional(),
});

const broadcastConfigBody = z.object({
  broadcastEnabled: z.boolean().optional(),
  activeStreamingTargetId: z.string().nullable().optional(),
  extraStreamingTargetIds: z.array(z.string().min(1)).max(5).optional(),
  rdsEnabled: z.boolean().optional(),
  rdsText: z.string().max(512).nullable().optional(),
});

function sanitize(t: {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  mountPath: string;
  sourceUser: string | null;
  sourcePassword: string;
  publicBaseUrl: string | null;
  tls: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { sourcePassword, ...rest } = t;
  return {
    ...rest,
    protocol: rest.protocol as ApiStreamingTarget["protocol"],
    createdAt: rest.createdAt.toISOString(),
    updatedAt: rest.updatedAt.toISOString(),
    hasSourcePassword: sourcePassword.length > 0,
  } satisfies ApiStreamingTarget;
}

export const streamingRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiStreamingTarget[] | ApiError | void }>("/streaming/targets", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const rows = await prisma.streamingTarget.findMany({ orderBy: { name: "asc" } });
    return rows.map(sanitize);
  });

  app.get<{ Reply: ApiStreamingTarget | ApiError | void }>("/streaming/targets/:id", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const { id } = request.params as { id: string };
    const row = await prisma.streamingTarget.findUnique({ where: { id } });
    if (!row) return reply.status(404).send({ error: "Destino no encontrado" });
    return sanitize(row);
  });

  app.post<{ Body: ApiEncoderHeartbeatBody; Reply: { ok: true } | ApiError }>(
    "/streaming/encoder-heartbeat",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const body = heartbeatBody.parse(request.body);
      setEncoderHeartbeat({
        ffmpegActive: body.ffmpegActive,
        wsConnected: body.wsConnected,
        title: body.title ?? null,
        artist: body.artist ?? null,
        album: body.album ?? null,
        assetId: body.assetId ?? null,
        coverUrl: body.coverUrl ?? null,
        stationLogoUrl: body.stationLogoUrl ?? null,
        lastFfmpegExitCode: body.lastFfmpegExitCode ?? null,
      });
      return { ok: true };
    },
  );

  app.get("/streaming/failover-status", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return readStreamingFailoverStatus();
  });

  app.get<{ Reply: ApiBroadcastStatus | ApiError | void }>("/streaming/broadcast-status", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const origin = resolvePublicApiOrigin(request, opts.env);
    const publicNp = await getPublicNowPlaying(origin);
    const settings = await getOrCreateSettings();
    let activeTarget: ApiBroadcastStatus["activeTarget"] = null;
    let icecast: ApiBroadcastStatus["icecast"] = {
      listenUrl: null,
      listeners: null,
      streamTitle: null,
      sourceConnected: null,
      error: "Sin destino activo en Marca",
    };
    if (settings.activeStreamingTargetId) {
      const target = await prisma.streamingTarget.findUnique({
        where: { id: settings.activeStreamingTargetId },
      });
      if (target) {
        activeTarget = {
          id: target.id,
          name: target.name,
          protocol: target.protocol as StreamProtocol,
        };
        if (target.protocol === "icecast" || target.protocol === "azuracast") {
          icecast = await probeIcecastStatus({
            host: target.host,
            port: target.port,
            mountPath: target.mountPath,
            tls: target.tls,
            publicBaseUrl: target.publicBaseUrl,
          });
        } else {
          icecast = {
            listenUrl: target.publicBaseUrl,
            listeners: null,
            streamTitle: null,
            sourceConnected: null,
            error: "Estado Icecast no disponible para este protocolo",
          };
        }
      }
    }
    const encoder = getEncoderHeartbeat(opts.env.ENCODER_HEARTBEAT_STALE_MS);
    const publicListenUrl =
      icecast.listenUrl?.trim() ||
      (await resolveActiveListenUrl()).listenUrl?.trim() ||
      null;
    return {
      nowPlaying: publicNp.now,
      encoder,
      icecast,
      activeTarget,
      streamRecording: getStreamRecordingStatus(),
      sourceAlert: readIcecastSourceAlertStatus(opts.env),
      airPath: "encoder",
      broadcastEnabled: settings.broadcastEnabled ?? false,
      publicListenUrl,
    };
  });

  app.get<{ Reply: ApiStreamRecordingStatus | ApiError | void }>("/streaming/record/status", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    return getStreamRecordingStatus();
  });

  app.post<{ Reply: ApiStreamRecordingStatus | ApiError | void }>("/streaming/record/start", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    try {
      return await startStreamRecording(opts.env);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo iniciar la grabación";
      return reply.status(400).send({ error: msg });
    }
  });

  app.post<{ Reply: ApiStreamRecordingStopResult | ApiError | void }>("/streaming/record/stop", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    try {
      return await stopStreamRecording(opts.env);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo detener la grabación";
      return reply.status(400).send({ error: msg });
    }
  });

  app.get<{ Reply: ApiStreamingEncoderUrl | ApiError | void }>("/streaming/encoder-url", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    const settings = await getOrCreateSettings();
    if (!settings.activeStreamingTargetId) {
      return reply.status(404).send({ error: "Configura un destino activo en Marca (ajustes)" });
    }
    const target = await prisma.streamingTarget.findUnique({
      where: { id: settings.activeStreamingTargetId },
    });
    if (!target?.enabled) {
      return reply.status(404).send({ error: "Destino activo no encontrado o deshabilitado" });
    }
    const url = buildEncoderSourceUrl(target);
    return {
      url,
      targetId: target.id,
      name: target.name,
      protocol: target.protocol as StreamProtocol,
    };
  });

  app.get<{ Reply: ApiStreamingEncoderUrls | ApiError | void }>("/streaming/encoder-urls", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    const settings = await getOrCreateSettings();
    let primary: ApiStreamingEncoderUrls["primary"] = null;
    if (settings.activeStreamingTargetId) {
      const target = await prisma.streamingTarget.findUnique({
        where: { id: settings.activeStreamingTargetId },
      });
      if (target?.enabled) {
        primary = {
          url: buildEncoderSourceUrl(target),
          targetId: target.id,
          name: target.name,
          protocol: target.protocol as StreamProtocol,
        };
      }
    }
    const extraIds = extraIdsFromSettings(settings);
    const extras: ApiStreamingEncoderUrls["extras"] = [];
    if (extraIds.length > 0) {
      const rows = await prisma.streamingTarget.findMany({
        where: { id: { in: extraIds }, enabled: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of extraIds) {
        const target = byId.get(id);
        if (!target) continue;
        extras.push({
          url: buildEncoderSourceUrl(target),
          targetId: target.id,
          name: target.name,
          protocol: target.protocol as StreamProtocol,
        });
      }
    }
    if (!primary && extras.length === 0) {
      return reply.status(404).send({ error: "Configura al menos un destino activo en Marca" });
    }
    return { primary, extras };
  });

  app.patch<{ Body: ApiBroadcastConfigPatchBody; Reply: ApiSettings | ApiError }>(
    "/streaming/broadcast-config",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const body = broadcastConfigBody.parse(request.body);
      await getOrCreateSettings();
      if (body.activeStreamingTargetId) {
        const t = await prisma.streamingTarget.findFirst({
          where: { id: body.activeStreamingTargetId, enabled: true },
        });
        if (!t) return reply.status(400).send({ error: "Destino de streaming no válido o deshabilitado" });
      }
      if (body.extraStreamingTargetIds?.length) {
        const primary =
          body.activeStreamingTargetId ?? (await getOrCreateSettings()).activeStreamingTargetId;
        if (body.extraStreamingTargetIds.some((id) => id === primary)) {
          return reply.status(400).send({ error: "Los destinos secundarios no pueden incluir el primario" });
        }
        const rows = await prisma.streamingTarget.findMany({
          where: { id: { in: body.extraStreamingTargetIds }, enabled: true },
          select: { id: true },
        });
        if (rows.length !== body.extraStreamingTargetIds.length) {
          return reply.status(400).send({ error: "Uno o más destinos secundarios no son válidos" });
        }
      }

      const row = await prisma.appSettings.update({
        where: { id: "global" },
        data: {
          ...(body.broadcastEnabled !== undefined ? { broadcastEnabled: body.broadcastEnabled } : {}),
          ...(body.activeStreamingTargetId !== undefined
            ? { activeStreamingTargetId: body.activeStreamingTargetId }
            : {}),
          ...(body.extraStreamingTargetIds !== undefined
            ? { extraStreamingTargetIds: serializeExtraStreamingTargetIds(body.extraStreamingTargetIds) }
            : {}),
          ...(body.rdsEnabled !== undefined ? { rdsEnabled: body.rdsEnabled } : {}),
          ...(body.rdsText !== undefined ? { rdsText: body.rdsText } : {}),
        },
      });

      return mapSettings(row);
    },
  );

  app.post<{ Body: ApiStreamingTargetCreateBody; Reply: ApiStreamingTarget | ApiError | void }>(
    "/streaming/targets",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    const body = targetBody.parse(request.body);
    const row = await prisma.streamingTarget.create({ data: body });
    return reply.status(201).send(sanitize(row));
    },
  );

  app.patch<{ Body: ApiStreamingTargetPatchBody; Reply: ApiStreamingTarget | ApiError | void }>(
    "/streaming/targets/:id",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = patchBody.parse(request.body);
    try {
      const row = await prisma.streamingTarget.update({
        where: { id },
        data: {
          ...body,
        },
      });
      return sanitize(row);
    } catch {
      return reply.status(404).send({ error: "Destino no encontrado" });
    }
    },
  );

  app.delete<{ Reply: void | ApiError }>("/streaming/targets/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STREAMING_WRITE)) return;
    const { id } = request.params as { id: string };
    try {
      await prisma.streamingTarget.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Destino no encontrado" });
    }
  });
};

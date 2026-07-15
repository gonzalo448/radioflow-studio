import type { FastifyPluginAsync } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { z } from "zod";
import type { ApiError, ApiSettings, ApiSettingsPatchBody } from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";
import {
  extraIdsFromSettings,
  serializeExtraStreamingTargetIds,
} from "../lib/extra-streaming-targets.js";
import {
  failoverBackupIdsFromSettings,
  serializeFailoverBackupIds,
} from "../lib/streaming-failover-chain.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import {
  parseLibraryCustomFieldLabels,
  serializeLibraryCustomFieldLabels,
} from "../lib/library-custom-field-labels.js";
import { ensureMediaDirs } from "../lib/media-path.js";
import {
  clearStationLogoFiles,
  findStationLogoAbsPath,
  stationLogoDestAbs,
  stationLogoMime,
  STATION_LOGO_API_PATH,
} from "../lib/station-logo-file.js";

const customFieldLabelsBody = z.array(z.string().max(64)).min(5).max(5);

const patchSettings = z.object({
  stationName: z.string().min(1).optional(),
  tagline: z.string().nullable().optional(),
  primaryColor: z.string().min(1).nullable().optional(),
  logoUrl: z.string().max(2048).nullable().optional(),
  activeStreamingTargetId: z.string().nullable().optional(),
  extraStreamingTargetIds: z.array(z.string().min(1)).max(5).optional(),
  rdsText: z.string().max(512).nullable().optional(),
  rdsEnabled: z.boolean().optional(),
  songRequestArtistCooldownMin: z.coerce.number().int().min(0).max(10_080).optional(),
  songRequestTitleCooldownMin: z.coerce.number().int().min(0).max(10_080).optional(),
  autoDjNoRepeatArtistLastN: z.coerce.number().int().min(0).max(50).optional(),
  autoDjNoRepeatTrackLastN: z.coerce.number().int().min(0).max(200).optional(),
  autoDjMinUpcomingTracks: z.coerce.number().int().min(0).max(200).optional(),
  autoIntroFolder: z.string().min(1).max(64).optional(),
  libraryCustomFieldLabels: customFieldLabelsBody.optional(),
  streamRecordingFolder: z.string().min(1).max(64).optional(),
  timeAnnounceFolderAbs: z.string().max(1024).nullable().optional(),
  timeAnnounceIntervalMin: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).optional(),
  jingleAutoIntervalMin: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).optional(),
  jingleAutoEveryTracks: z.coerce.number().int().min(0).max(500).optional(),
  jingleAutoPageKey: z.enum(["A", "B", "C"]).optional(),
  jingleAutoSlotKeys: z.array(z.string().min(1).max(1)).max(10).optional(),
  stationIntroSourceAbs: z.string().max(1024).nullable().optional(),
  stationIntroIntervalMin: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).optional(),
  streamingFailoverEnabled: z.boolean().optional(),
  streamingFailoverBackupTargetId: z.string().nullable().optional(),
  streamingFailoverBackupTargetIds: z.array(z.string().min(1)).max(5).optional(),
  streamingFailoverAutoRevert: z.boolean().optional(),
  broadcastEnabled: z.boolean().optional(),
});

function mapInterval(n: number | null | undefined): 0 | 15 | 30 | 60 {
  return n === 15 || n === 30 || n === 60 ? n : 0;
}

export function mapSettings(row: Awaited<ReturnType<typeof getOrCreateSettings>>): ApiSettings {
  return {
    id: row.id,
    stationName: row.stationName,
    tagline: row.tagline,
    primaryColor: row.primaryColor,
    logoUrl: row.logoUrl,
    activeStreamingTargetId: row.activeStreamingTargetId,
    extraStreamingTargetIds: extraIdsFromSettings(row),
    rdsText: row.rdsText ?? null,
    rdsEnabled: row.rdsEnabled ?? false,
    songRequestArtistCooldownMin: row.songRequestArtistCooldownMin ?? 0,
    songRequestTitleCooldownMin: row.songRequestTitleCooldownMin ?? 60,
    autoDjNoRepeatArtistLastN: row.autoDjNoRepeatArtistLastN ?? 0,
    autoDjNoRepeatTrackLastN: row.autoDjNoRepeatTrackLastN ?? 0,
    autoDjMinUpcomingTracks: row.autoDjMinUpcomingTracks ?? 0,
    autoIntroFolder: row.autoIntroFolder ?? "intros",
    libraryCustomFieldLabels: parseLibraryCustomFieldLabels(row.libraryCustomFieldLabels),
    streamRecordingFolder: row.streamRecordingFolder ?? "recordings",
    timeAnnounceFolderAbs: row.timeAnnounceFolderAbs ?? null,
    timeAnnounceIntervalMin: mapInterval(row.timeAnnounceIntervalMin),
    jingleAutoIntervalMin: mapInterval(row.jingleAutoIntervalMin),
    jingleAutoEveryTracks: row.jingleAutoEveryTracks ?? 0,
    jingleAutoPageKey: (row.jingleAutoPageKey?.toUpperCase() === "B"
      ? "B"
      : row.jingleAutoPageKey?.toUpperCase() === "C"
        ? "C"
        : "A") as "A" | "B" | "C",
    jingleAutoSlotKeys: (() => {
      try {
        const j = JSON.parse(row.jingleAutoSlotKeysJson ?? "[]") as unknown;
        if (!Array.isArray(j)) return [];
        return j.filter((x) => typeof x === "string" && x.length === 1);
      } catch {
        return [];
      }
    })(),
    stationIntroSourceAbs: row.stationIntroSourceAbs ?? null,
    stationIntroIntervalMin: mapInterval(row.stationIntroIntervalMin),
    streamingFailoverEnabled: row.streamingFailoverEnabled ?? false,
    streamingFailoverBackupTargetId: row.streamingFailoverBackupTargetId ?? null,
    streamingFailoverBackupTargetIds: failoverBackupIdsFromSettings(row),
    streamingFailoverAutoRevert: row.streamingFailoverAutoRevert ?? true,
    broadcastEnabled: row.broadcastEnabled ?? false,
  };
}

export const settingsRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiSettings }>("/settings", async () => {
    return mapSettings(await getOrCreateSettings());
  });

  app.patch<{ Body: ApiSettingsPatchBody; Reply: ApiSettings | ApiError }>("/settings", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const body = patchSettings.parse(request.body);
    if (body.activeStreamingTargetId) {
      const t = await prisma.streamingTarget.findFirst({
        where: { id: body.activeStreamingTargetId, enabled: true },
      });
      if (!t) return reply.status(400).send({ error: "Destino de streaming no válido o deshabilitado" });
    }
    if (body.extraStreamingTargetIds?.length) {
      const primary = body.activeStreamingTargetId ?? (await getOrCreateSettings()).activeStreamingTargetId;
      const invalid = body.extraStreamingTargetIds.filter((id) => id === primary);
      if (invalid.length > 0) {
        return reply.status(400).send({ error: "Los destinos secundarios no pueden incluir el destino primario" });
      }
      const rows = await prisma.streamingTarget.findMany({
        where: { id: { in: body.extraStreamingTargetIds }, enabled: true },
        select: { id: true },
      });
      if (rows.length !== body.extraStreamingTargetIds.length) {
        return reply.status(400).send({ error: "Uno o más destinos secundarios no son válidos" });
      }
    }
    const row = await prisma.appSettings.upsert({
      where: { id: "global" },
      create: {
        id: "global",
        stationName: body.stationName ?? "RadioFlow Studio",
        tagline: body.tagline ?? undefined,
        primaryColor: body.primaryColor ?? "#38bdf8",
        logoUrl: body.logoUrl ?? undefined,
        activeStreamingTargetId: body.activeStreamingTargetId ?? undefined,
        extraStreamingTargetIds:
          body.extraStreamingTargetIds !== undefined
            ? serializeExtraStreamingTargetIds(body.extraStreamingTargetIds)
            : undefined,
        rdsText: body.rdsText ?? undefined,
        rdsEnabled: body.rdsEnabled ?? undefined,
        songRequestArtistCooldownMin: body.songRequestArtistCooldownMin ?? undefined,
        songRequestTitleCooldownMin: body.songRequestTitleCooldownMin ?? undefined,
        autoDjNoRepeatArtistLastN: body.autoDjNoRepeatArtistLastN ?? undefined,
        autoDjNoRepeatTrackLastN: body.autoDjNoRepeatTrackLastN ?? undefined,
        autoDjMinUpcomingTracks: body.autoDjMinUpcomingTracks ?? undefined,
        autoIntroFolder: body.autoIntroFolder ?? undefined,
        libraryCustomFieldLabels: body.libraryCustomFieldLabels
          ? serializeLibraryCustomFieldLabels(body.libraryCustomFieldLabels)
          : undefined,
        streamRecordingFolder: body.streamRecordingFolder ?? undefined,
        timeAnnounceFolderAbs: body.timeAnnounceFolderAbs ?? undefined,
        timeAnnounceIntervalMin: body.timeAnnounceIntervalMin ?? undefined,
        jingleAutoIntervalMin: body.jingleAutoIntervalMin ?? undefined,
        jingleAutoEveryTracks: body.jingleAutoEveryTracks ?? undefined,
        jingleAutoPageKey: body.jingleAutoPageKey ?? undefined,
        jingleAutoSlotKeysJson:
          body.jingleAutoSlotKeys !== undefined ? JSON.stringify(body.jingleAutoSlotKeys) : undefined,
        stationIntroSourceAbs: body.stationIntroSourceAbs ?? undefined,
        stationIntroIntervalMin: body.stationIntroIntervalMin ?? undefined,
        streamingFailoverEnabled: body.streamingFailoverEnabled ?? undefined,
        streamingFailoverBackupTargetId: body.streamingFailoverBackupTargetId ?? undefined,
        streamingFailoverBackupTargetIdsJson:
          body.streamingFailoverBackupTargetIds !== undefined
            ? serializeFailoverBackupIds(body.streamingFailoverBackupTargetIds)
            : undefined,
        streamingFailoverAutoRevert: body.streamingFailoverAutoRevert ?? undefined,
        broadcastEnabled: body.broadcastEnabled ?? undefined,
      },
      update: {
        ...(body.stationName !== undefined ? { stationName: body.stationName } : {}),
        ...(body.tagline !== undefined ? { tagline: body.tagline } : {}),
        ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        ...(body.activeStreamingTargetId !== undefined
          ? { activeStreamingTargetId: body.activeStreamingTargetId }
          : {}),
        ...(body.extraStreamingTargetIds !== undefined
          ? { extraStreamingTargetIds: serializeExtraStreamingTargetIds(body.extraStreamingTargetIds) }
          : {}),
        ...(body.rdsText !== undefined ? { rdsText: body.rdsText } : {}),
        ...(body.rdsEnabled !== undefined ? { rdsEnabled: body.rdsEnabled } : {}),
        ...(body.songRequestArtistCooldownMin !== undefined
          ? { songRequestArtistCooldownMin: body.songRequestArtistCooldownMin }
          : {}),
        ...(body.songRequestTitleCooldownMin !== undefined
          ? { songRequestTitleCooldownMin: body.songRequestTitleCooldownMin }
          : {}),
        ...(body.autoDjNoRepeatArtistLastN !== undefined
          ? { autoDjNoRepeatArtistLastN: body.autoDjNoRepeatArtistLastN }
          : {}),
        ...(body.autoDjNoRepeatTrackLastN !== undefined
          ? { autoDjNoRepeatTrackLastN: body.autoDjNoRepeatTrackLastN }
          : {}),
        ...(body.autoDjMinUpcomingTracks !== undefined
          ? { autoDjMinUpcomingTracks: body.autoDjMinUpcomingTracks }
          : {}),
        ...(body.autoIntroFolder !== undefined ? { autoIntroFolder: body.autoIntroFolder } : {}),
        ...(body.libraryCustomFieldLabels !== undefined
          ? { libraryCustomFieldLabels: serializeLibraryCustomFieldLabels(body.libraryCustomFieldLabels) }
          : {}),
        ...(body.streamRecordingFolder !== undefined ? { streamRecordingFolder: body.streamRecordingFolder } : {}),
        ...(body.timeAnnounceFolderAbs !== undefined ? { timeAnnounceFolderAbs: body.timeAnnounceFolderAbs } : {}),
        ...(body.timeAnnounceIntervalMin !== undefined
          ? { timeAnnounceIntervalMin: body.timeAnnounceIntervalMin }
          : {}),
        ...(body.jingleAutoIntervalMin !== undefined ? { jingleAutoIntervalMin: body.jingleAutoIntervalMin } : {}),
        ...(body.jingleAutoEveryTracks !== undefined ? { jingleAutoEveryTracks: body.jingleAutoEveryTracks } : {}),
        ...(body.jingleAutoPageKey !== undefined ? { jingleAutoPageKey: body.jingleAutoPageKey } : {}),
        ...(body.jingleAutoSlotKeys !== undefined
          ? { jingleAutoSlotKeysJson: JSON.stringify(body.jingleAutoSlotKeys) }
          : {}),
        ...(body.stationIntroSourceAbs !== undefined ? { stationIntroSourceAbs: body.stationIntroSourceAbs } : {}),
        ...(body.stationIntroIntervalMin !== undefined
          ? { stationIntroIntervalMin: body.stationIntroIntervalMin }
          : {}),
        ...(body.streamingFailoverEnabled !== undefined
          ? { streamingFailoverEnabled: body.streamingFailoverEnabled }
          : {}),
        ...(body.streamingFailoverBackupTargetId !== undefined
          ? { streamingFailoverBackupTargetId: body.streamingFailoverBackupTargetId }
          : {}),
        ...(body.streamingFailoverBackupTargetIds !== undefined
          ? {
              streamingFailoverBackupTargetIdsJson: serializeFailoverBackupIds(
                body.streamingFailoverBackupTargetIds,
              ),
              streamingFailoverBackupTargetId: body.streamingFailoverBackupTargetIds[0] ?? null,
            }
          : {}),
        ...(body.streamingFailoverAutoRevert !== undefined
          ? { streamingFailoverAutoRevert: body.streamingFailoverAutoRevert }
          : {}),
        ...(body.broadcastEnabled !== undefined ? { broadcastEnabled: body.broadcastEnabled } : {}),
      },
    });
    return mapSettings(row);
  });

  app.get("/settings/station-logo", async (_request, reply) => {
    const abs = await findStationLogoAbsPath(opts.env);
    if (!abs) return reply.status(404).send({ error: "Sin logo de emisora" });
    const ext = path.extname(abs);
    reply.header("Cache-Control", "public, max-age=300");
    reply.type(stationLogoMime(ext));
    return reply.send(createReadStream(abs));
  });

  app.post<{ Reply: ApiSettings | ApiError | void }>("/settings/logo", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    await ensureMediaDirs(opts.env);
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Falta imagen (multipart field: file)" });

    const orig = file.filename || "logo.png";
    const ext = path.extname(orig).toLowerCase();
    const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
    if (!allowed.has(ext)) {
      return reply.status(400).send({ error: "Formato no admitido. Use PNG, JPG, WEBP, GIF o SVG." });
    }

    await clearStationLogoFiles(opts.env);
    const absDest = stationLogoDestAbs(opts.env, ext);
    await pipeline(file.file, createWriteStream(absDest));

    const row = await prisma.appSettings.upsert({
      where: { id: "global" },
      create: { id: "global", logoUrl: STATION_LOGO_API_PATH },
      update: { logoUrl: STATION_LOGO_API_PATH },
    });
    return mapSettings(row);
  });
};

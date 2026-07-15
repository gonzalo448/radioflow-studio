import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  ApiError,
  ApiSongRequest,
  ApiSongRequestCreateBody,
  ApiSongRequestPatchBody,
  ApiSongRequestPendingCount,
  ApiStationState,
  SongRequestStatus,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_STATION_WRITE } from "../lib/auth.js";
import { getClientIp } from "../lib/rate-limit.js";
import { assertAssetPlayableInVault } from "../lib/library-vault.js";
import { consumeSongRequestSubmitBudget } from "../lib/song-request-rate-limit.js";
import { assertSongRequestNotDuplicate, SongRequestRepeatError } from "../lib/song-request-repeat-guard.js";
import { writePlayLog } from "../lib/play-log.js";
import { ensureMainStation, getStationState, MAIN_STATION_ID } from "../services/station-state.js";

const createBody = z.object({
  listenerName: z.string().max(120).optional(),
  listenerContact: z.string().max(200).optional(),
  title: z.string().min(1).max(300),
  artist: z.string().max(300).optional(),
  message: z.string().max(1000).optional(),
});

const patchBody = z.object({
  status: z.enum(["pending", "approved", "rejected", "played"]).optional(),
  assetId: z.string().nullable().optional(),
});

function toApi(row: {
  id: string;
  listenerName: string | null;
  listenerContact: string | null;
  title: string;
  artist: string | null;
  message: string | null;
  status: string;
  assetId: string | null;
  reviewedAt: Date | null;
  enqueuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  asset: { id: string; title: string; artist: string | null } | null;
}): ApiSongRequest {
  return {
    id: row.id,
    listenerName: row.listenerName,
    listenerContact: row.listenerContact,
    title: row.title,
    artist: row.artist,
    message: row.message,
    status: row.status as SongRequestStatus,
    assetId: row.assetId,
    asset: row.asset,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    enqueuedAt: row.enqueuedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const includeAsset = { asset: { select: { id: true, title: true, artist: true } } } as const;

export const requestsRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiSongRequestPendingCount | ApiError }>("/requests/pending-count", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    const pending = await prisma.songRequest.count({ where: { status: "pending" } });
    return { pending };
  });

  app.get<{ Querystring: { status?: string }; Reply: ApiSongRequest[] | ApiError }>(
    "/requests",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const status = (request.query as { status?: string }).status;
      const where =
        status && ["pending", "approved", "rejected", "played"].includes(status)
          ? { status: status as SongRequestStatus }
          : {};
      const rows = await prisma.songRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        include: includeAsset,
      });
      return rows.map(toApi);
    },
  );

  app.get<{ Querystring: { q?: string }; Reply: Array<{ id: string; title: string; artist: string | null }> }>(
    "/requests/match-assets",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const q = String((request.query as { q?: string }).q ?? "").trim();
      if (q.length < 2) return [];
      const rows = await prisma.mediaAsset.findMany({
        where: {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { artist: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { title: "asc" },
        take: 25,
        select: { id: true, title: true, artist: true },
      });
      return rows;
    },
  );

  app.post<{ Body: ApiSongRequestCreateBody; Reply: ApiSongRequest | ApiError }>(
    "/requests",
    async (request, reply) => {
      const ip = getClientIp(request);
      const rl = await consumeSongRequestSubmitBudget(opts.env, ip);
      if (!rl.ok) {
        reply.header("Retry-After", String(rl.retryAfterSec));
        return reply.status(429).send({
          error: `Demasiados pedidos desde esta conexión. Intente de nuevo en ${rl.retryAfterSec} s.`,
        });
      }
      reply.header("RateLimit-Limit", String(opts.env.SONG_REQUEST_MAX_PER_WINDOW));
      reply.header("RateLimit-Remaining", String(rl.remaining));
      reply.header("RateLimit-Reset", String(rl.resetSec));
      const body = createBody.parse(request.body);
      try {
        await assertSongRequestNotDuplicate({ title: body.title, artist: body.artist });
      } catch (e) {
        if (e instanceof SongRequestRepeatError) {
          return reply.status(409).send({ error: e.message });
        }
        throw e;
      }
      const row = await prisma.songRequest.create({
        data: {
          listenerName: body.listenerName?.trim() || null,
          listenerContact: body.listenerContact?.trim() || null,
          title: body.title.trim(),
          artist: body.artist?.trim() || null,
          message: body.message?.trim() || null,
        },
        include: includeAsset,
      });
      return reply.status(201).send(toApi(row));
    },
  );

  app.patch<{ Body: ApiSongRequestPatchBody; Reply: ApiSongRequest | ApiError }>(
    "/requests/:id",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = patchBody.parse(request.body);
      if (body.assetId) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id: body.assetId } });
        if (!asset) return reply.status(404).send({ error: "Pista no encontrada en librería" });
      }
      try {
        const row = await prisma.songRequest.update({
          where: { id },
          data: {
            ...(body.status !== undefined && {
              status: body.status,
              reviewedAt: new Date(),
              reviewedByUserId: request.userId ?? null,
            }),
            ...(body.assetId !== undefined && { assetId: body.assetId }),
          },
          include: includeAsset,
        });
        return toApi(row);
      } catch {
        return reply.status(404).send({ error: "Pedido no encontrado" });
      }
    },
  );

  app.post<{ Reply: ApiStationState | ApiError }>("/requests/:id/enqueue", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    const { id } = request.params as { id: string };
    const reqRow = await prisma.songRequest.findUnique({ where: { id }, include: includeAsset });
    if (!reqRow) return reply.status(404).send({ error: "Pedido no encontrado" });
    if (!reqRow.assetId) {
      return reply.status(400).send({ error: "Vincule una pista de la librería antes de encolar" });
    }
    const asset = await prisma.mediaAsset.findUnique({ where: { id: reqRow.assetId } });
    if (!asset) return reply.status(404).send({ error: "Pista no encontrada en librería" });
    assertAssetPlayableInVault(asset, opts.env);
    await ensureMainStation();
    await prisma.$transaction(async (tx) => {
      const stationRow = await tx.station.findUniqueOrThrow({ where: { id: MAIN_STATION_ID } });
      const count = await tx.playQueueItem.count({ where: { stationId: MAIN_STATION_ID } });
      let insertAt: number;
      if (count === 0) {
        insertAt = 0;
      } else {
        const cur = Math.min(Math.max(0, stationRow.currentPosition), count - 1);
        insertAt = cur + 1;
      }
      const toShift = await tx.playQueueItem.findMany({
        where: { stationId: MAIN_STATION_ID, position: { gte: insertAt } },
        orderBy: { position: "desc" },
      });
      for (const row of toShift) {
        await tx.playQueueItem.update({
          where: { id: row.id },
          data: { position: row.position + 1 },
        });
      }
      await tx.playQueueItem.create({
        data: { stationId: MAIN_STATION_ID, assetId: reqRow.assetId!, position: insertAt },
      });
      await tx.songRequest.update({
        where: { id },
        data: {
          status: "played",
          enqueuedAt: new Date(),
          reviewedAt: reqRow.reviewedAt ?? new Date(),
          reviewedByUserId: request.userId ?? reqRow.reviewedByUserId,
        },
      });
    });
    void writePlayLog({
      action: "QUEUE_APPEND",
      userId: request.userId ?? null,
      assetId: reqRow.assetId,
      details: { source: "song-request", requestId: id, playNext: true },
    });
    return getStationState() as unknown as ApiStationState;
  });
};

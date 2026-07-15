import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  ApiError,
  ApiScheduleApplyActiveBody,
  ApiScheduleApplyActiveResult,
  ApiScheduleBlock,
  ApiScheduleCreateBody,
  ApiSchedulePatchBody,
  ApiScheduleTodayHints,
  ApiStationState,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE, ROLES_STATION_WRITE } from "../lib/auth.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { applyActiveScheduleBlock } from "../services/internal-scheduler.js";
import { MAIN_STATION_ID } from "../services/station-state.js";

function toApiScheduleBlock(
  b: {
    id: string;
    label: string;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    playlistId: string | null;
    priority: number;
    createdAt: Date;
    updatedAt: Date;
    playlist: { id: string; name: string } | null;
  },
): ApiScheduleBlock {
  return {
    id: b.id,
    label: b.label,
    dayOfWeek: b.dayOfWeek,
    startMinute: b.startMinute,
    endMinute: b.endMinute,
    playlistId: b.playlistId,
    priority: b.priority,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    playlist: b.playlist ? { id: b.playlist.id, name: b.playlist.name } : null,
  };
}

const blockBody = z.object({
  label: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  playlistId: z.string().nullable().optional(),
  priority: z.number().int().default(0),
});

const patchBlock = blockBody.partial();

const applyActiveBody = z.object({
  replace: z.boolean().optional(),
  force: z.boolean().optional(),
});

async function blockHintToApi(id: string | null): Promise<ApiScheduleBlock | null> {
  if (!id) return null;
  const row = await prisma.scheduleBlock.findUnique({
    where: { id },
    include: { playlist: { select: { id: true, name: true } } },
  });
  return row ? toApiScheduleBlock(row) : null;
}

export const scheduleRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiScheduleBlock[] }>("/schedule", async () => {
    const rows = await prisma.scheduleBlock.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }, { priority: "desc" }],
      include: { playlist: { select: { id: true, name: true } } },
    });
    return rows.map(toApiScheduleBlock);
  });

  app.get<{ Reply: ApiScheduleTodayHints }>("/schedule/today-hints", async () => {
    const now = new Date();
    const day = now.getDay();
    const startMinute = now.getHours() * 60 + now.getMinutes();
    const blocks = await prisma.scheduleBlock.findMany({
      where: { dayOfWeek: day },
      orderBy: { startMinute: "asc" },
      include: { playlist: { select: { id: true, name: true } } },
    });
    const active = blocks.filter((b) => startMinute >= b.startMinute && startMinute < b.endMinute);
    return {
      dayOfWeek: day,
      minuteNow: startMinute,
      blocks: blocks.map(toApiScheduleBlock),
      active: active.map(toApiScheduleBlock),
    };
  });

  app.post<{ Body: ApiScheduleApplyActiveBody; Reply: ApiScheduleApplyActiveResult | ApiError }>(
    "/schedule/apply-active",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const body = applyActiveBody.parse(request.body ?? {});
      const outcome = await applyActiveScheduleBlock({
        replace: body.replace ?? true,
        force: body.force ?? false,
        userId: request.userId ?? null,
        env: opts.env,
      });
      const block = await blockHintToApi(outcome.block?.id ?? null);
      return {
        applied: outcome.applied,
        reason: outcome.reason,
        block,
        station: (outcome.station as unknown as ApiStationState) ?? null,
      };
    },
  );

  app.post<{ Body: ApiScheduleCreateBody; Reply: ApiScheduleBlock | ApiError | void }>(
    "/schedule",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const body = blockBody.parse(request.body);
    if (body.endMinute <= body.startMinute) {
      return reply.status(400).send({ error: "endMinute debe ser mayor que startMinute" });
    }
    if (body.playlistId) {
      const pl = await prisma.playlist.findUnique({ where: { id: body.playlistId } });
      if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
    }
    const block = await prisma.scheduleBlock.create({
      data: {
        label: body.label,
        dayOfWeek: body.dayOfWeek,
        startMinute: body.startMinute,
        endMinute: body.endMinute,
        playlistId: body.playlistId ?? null,
        priority: body.priority,
      },
      include: { playlist: { select: { id: true, name: true } } },
    });
    return reply.status(201).send(toApiScheduleBlock(block));
    },
  );

  app.patch<{ Body: ApiSchedulePatchBody; Reply: ApiScheduleBlock | ApiError | void }>(
    "/schedule/:id",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = patchBlock.parse(request.body);
    if (body.startMinute !== undefined && body.endMinute !== undefined && body.endMinute <= body.startMinute) {
      return reply.status(400).send({ error: "endMinute debe ser mayor que startMinute" });
    }
    try {
      const block = await prisma.scheduleBlock.update({
        where: { id },
        data: body,
        include: { playlist: { select: { id: true, name: true } } },
      });
      const cleared = await prisma.station.updateMany({
        where: { id: MAIN_STATION_ID, lastAppliedScheduleBlockId: id },
        data: { lastAppliedScheduleBlockId: null },
      });
      if (cleared.count > 0) void broadcastStationState();
      return toApiScheduleBlock(block);
    } catch {
      return reply.status(404).send({ error: "Bloque no encontrado" });
    }
    },
  );

  app.delete<{ Reply: void | ApiError }>("/schedule/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    try {
      await prisma.scheduleBlock.delete({ where: { id } });
      const cleared = await prisma.station.updateMany({
        where: { id: MAIN_STATION_ID, lastAppliedScheduleBlockId: id },
        data: { lastAppliedScheduleBlockId: null },
      });
      if (cleared.count > 0) void broadcastStationState();
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Bloque no encontrado" });
    }
  });
};

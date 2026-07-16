import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  ApiError,
  ApiSchedulerEvent,
  ApiSchedulerEventCreateBody,
  ApiSchedulerEventPatchBody,
  ApiSchedulerRunEntry,
  ApiSchedulerRunNow,
} from "@radioflow/shared";
import type { Prisma } from "@prisma/client";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles } from "../lib/auth.js";
import { runSchedulerEventsTick } from "../services/scheduler-events.js";

const createBody = z.object({
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  actionType: z.enum([
    "PLAY_PLAYLIST",
    "PLAY_ASSET",
    "RUN_COMMAND",
    "GENERATE_AND_PLAY_PLAYLIST",
    "PLAY_AD_BREAK",
    "TIME_ANNOUNCE",
  ]),
  runAt: z.string().datetime().nullable().optional(),
  repeatIntervalMin: z.coerce.number().int().min(0).max(10_080).optional(),
  payload: z.record(z.unknown()),
});

const patchBody = createBody.partial().refine((v) => Object.keys(v).length > 0, { message: "Body vacío" });

function toApi(ev: {
  id: string;
  name: string;
  enabled: boolean;
  actionType: string;
  runAt: Date | null;
  nextRunAt: Date | null;
  repeatIntervalMin: number;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ApiSchedulerEvent {
  return {
    id: ev.id,
    name: ev.name,
    enabled: ev.enabled,
    actionType: ev.actionType as ApiSchedulerEvent["actionType"],
    runAt: ev.runAt ? ev.runAt.toISOString() : null,
    nextRunAt: ev.nextRunAt ? ev.nextRunAt.toISOString() : null,
    repeatIntervalMin: ev.repeatIntervalMin ?? 0,
    payload: (ev.payload ?? {}) as Record<string, unknown>,
    createdAt: ev.createdAt.toISOString(),
    updatedAt: ev.updatedAt.toISOString(),
  };
}

export const schedulerRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiSchedulerEvent[] }>("/scheduler/events", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin", "editor"])) return;
    const rows = await prisma.schedulerEvent.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map(toApi);
  });

  app.get<{ Querystring: { limit?: string }; Reply: ApiSchedulerRunEntry[] }>(
    "/scheduler/runs",
    async (request, reply) => {
      if (!requireRoles(request, reply, ["admin", "editor"])) return;
      const raw = request.query.limit;
      const limit = Math.min(Math.max(raw ? Number.parseInt(raw, 10) || 12 : 12, 1), 50);
      const rows = await prisma.schedulerRun.findMany({
        orderBy: { startedAt: "desc" },
        take: limit,
        include: { event: { select: { name: true } } },
      });
      return rows
        .filter((r) => r.finishedAt != null)
        .map((r) => ({
          id: r.id,
          eventId: r.eventId,
          eventName: r.event.name,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt!.toISOString(),
          error: r.error ?? null,
        }));
    },
  );

  app.post<{ Body: ApiSchedulerEventCreateBody; Reply: ApiSchedulerEvent | ApiError | void }>(
    "/scheduler/events",
    async (request, reply) => {
      if (!requireRoles(request, reply, ["admin", "editor"])) return;
      const body = createBody.parse(request.body);
      const runAt = body.runAt ? new Date(body.runAt) : null;
      const ev = await prisma.schedulerEvent.create({
        data: {
          name: body.name,
          enabled: body.enabled ?? true,
          actionType: body.actionType,
          runAt,
          nextRunAt: runAt,
          repeatIntervalMin: body.repeatIntervalMin ?? 0,
          payload: body.payload as Prisma.InputJsonValue,
        },
      });
      return reply.status(201).send(toApi(ev));
    },
  );

  app.patch<{ Body: ApiSchedulerEventPatchBody; Reply: ApiSchedulerEvent | ApiError | void }>(
    "/scheduler/events/:id",
    async (request, reply) => {
      if (!requireRoles(request, reply, ["admin", "editor"])) return;
      const { id } = request.params as { id: string };
      const body = patchBody.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: "Body inválido" });
      try {
        const runAt = body.data.runAt === undefined ? undefined : body.data.runAt ? new Date(body.data.runAt) : null;
        const ev = await prisma.schedulerEvent.update({
          where: { id },
          data: {
            ...(body.data.name ? { name: body.data.name } : {}),
            ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
            ...(body.data.actionType ? { actionType: body.data.actionType } : {}),
            ...(body.data.payload ? { payload: body.data.payload as Prisma.InputJsonValue } : {}),
            ...(body.data.runAt !== undefined ? { runAt, nextRunAt: runAt } : {}),
            ...(body.data.repeatIntervalMin !== undefined
              ? { repeatIntervalMin: body.data.repeatIntervalMin ?? 0 }
              : {}),
          },
        });
        return toApi(ev);
      } catch {
        return reply.status(404).send({ error: "No encontrado" });
      }
    },
  );

  app.delete<{ Reply: void | ApiError }>("/scheduler/events/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin", "editor"])) return;
    const { id } = request.params as { id: string };
    try {
      await prisma.schedulerEvent.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "No encontrado" });
    }
  });

  app.post<{ Reply: ApiSchedulerRunNow | ApiError | void }>("/scheduler/events/:id/run", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin", "editor"])) return;
    const { id } = request.params as { id: string };
    const ev = await prisma.schedulerEvent.findUnique({ where: { id } });
    if (!ev) return reply.status(404).send({ error: "No encontrado" });

    // fuerza ejecución: setea nextRunAt al pasado y corre un tick
    const forcedAt = new Date();
    await prisma.schedulerEvent.update({ where: { id }, data: { enabled: true, nextRunAt: new Date(0) } });
    await runSchedulerEventsTick(opts.env);

    // Si el tick periódico tenía el candado, el evento lo ejecuta ese tick:
    // esperamos brevemente a que aparezca el run terminado.
    let run = null as Awaited<ReturnType<typeof prisma.schedulerRun.findFirst>>;
    for (let attempt = 0; attempt < 10; attempt++) {
      run = await prisma.schedulerRun.findFirst({
        where: { eventId: id, startedAt: { gte: forcedAt } },
        orderBy: { startedAt: "desc" },
      });
      if (run?.finishedAt) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!run || !run.finishedAt) return reply.status(500).send({ error: "No se pudo ejecutar" });
    return {
      ok: true,
      run: {
        id: run.id,
        eventId: run.eventId,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt.toISOString(),
        error: run.error ?? null,
      },
    };
  });
};


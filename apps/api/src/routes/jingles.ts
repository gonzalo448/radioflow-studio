import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ApiError, ApiJingleSlotsMap } from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_STATION_WRITE } from "../lib/auth.js";
import { JINGLE_PAGE_KEYS } from "../lib/dtmf-actions.js";
import { fireJingleSlot } from "../lib/fire-jingle-slot.js";
import { MAIN_STATION_ID } from "../services/station-state.js";

const SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

const putBody = z.object({
  slots: z.record(z.string().nullable()),
  pageKey: z.enum(["A", "B", "C"]).optional(),
});

const fireBody = z.object({
  slotKey: z.string().min(1).max(1),
  pageKey: z.enum(["A", "B", "C"]).optional(),
  playNext: z.boolean().optional(),
  /** C5: inserta como siguiente y corta lo al aire (skip) si hay pista sonando. */
  playNow: z.boolean().optional(),
});

const copyPageBody = z.object({
  fromPageKey: z.enum(["A", "B", "C"]),
  toPageKey: z.enum(["A", "B", "C"]),
});

function emptySlots(): ApiJingleSlotsMap {
  const out: ApiJingleSlotsMap = {};
  for (const k of SLOT_KEYS) out[k] = null;
  return out;
}

function normalizePageKey(raw: string | undefined): string {
  const p = (raw ?? "A").trim().toUpperCase();
  return (JINGLE_PAGE_KEYS as readonly string[]).includes(p) ? p : "A";
}

export const jinglesRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Querystring: { page?: string }; Reply: ApiJingleSlotsMap }>("/jingles/slots", async (request) => {
    const pageKey = normalizePageKey(request.query.page);
    const rows = await prisma.jingleSlot.findMany({
      where: { stationId: MAIN_STATION_ID, pageKey },
      include: { asset: { select: { id: true, title: true, artist: true } } },
    });
    const map = emptySlots();
    for (const row of rows) {
      if (!(SLOT_KEYS as readonly string[]).includes(row.slotKey)) continue;
      map[row.slotKey] = {
        assetId: row.assetId,
        label: row.label ?? row.asset.title,
        asset: { id: row.asset.id, title: row.asset.title, artist: row.asset.artist },
      };
    }
    return map;
  });

  app.put<{ Body: { slots: Record<string, string | null>; pageKey?: string }; Reply: ApiJingleSlotsMap | ApiError }>(
    "/jingles/slots",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const body = putBody.parse(request.body);
      const pageKey = normalizePageKey(body.pageKey);
      for (const [key, assetId] of Object.entries(body.slots)) {
        if (!(SLOT_KEYS as readonly string[]).includes(key)) continue;
        if (!assetId) {
          await prisma.jingleSlot.deleteMany({ where: { stationId: MAIN_STATION_ID, pageKey, slotKey: key } });
          continue;
        }
        const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
        if (!asset) return reply.status(404).send({ error: `Pista no encontrada para tecla ${key}` });
        await prisma.jingleSlot.upsert({
          where: { stationId_pageKey_slotKey: { stationId: MAIN_STATION_ID, pageKey, slotKey: key } },
          create: {
            stationId: MAIN_STATION_ID,
            pageKey,
            slotKey: key,
            assetId,
            label: asset.title,
          },
          update: { assetId, label: asset.title },
        });
      }
      const rows = await prisma.jingleSlot.findMany({
        where: { stationId: MAIN_STATION_ID, pageKey },
        include: { asset: { select: { id: true, title: true, artist: true } } },
      });
      const map = emptySlots();
      for (const row of rows) {
        map[row.slotKey] = {
          assetId: row.assetId,
          label: row.label ?? row.asset.title,
          asset: { id: row.asset.id, title: row.asset.title, artist: row.asset.artist },
        };
      }
      return map;
    },
  );

  app.post<{ Body: z.infer<typeof fireBody> }>("/jingles/fire", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
    const body = fireBody.parse(request.body);
    const result = await fireJingleSlot({
      slotKey: body.slotKey,
      pageKey: body.pageKey,
      playNext: body.playNext,
      playNow: body.playNow,
      userId: request.userId ?? null,
      env: opts.env,
    });
    if (!result.ok) return reply.status(400).send({ error: result.error });
    return result;
  });

  app.post<{ Body: z.infer<typeof copyPageBody>; Reply: ApiJingleSlotsMap | ApiError }>(
    "/jingles/copy-page",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_STATION_WRITE)) return;
      const body = copyPageBody.parse(request.body);
      if (body.fromPageKey === body.toPageKey) {
        return reply.status(400).send({ error: "Origen y destino deben ser distintos" });
      }
      const rows = await prisma.jingleSlot.findMany({
        where: { stationId: MAIN_STATION_ID, pageKey: body.fromPageKey },
      });
      await prisma.jingleSlot.deleteMany({
        where: { stationId: MAIN_STATION_ID, pageKey: body.toPageKey },
      });
      for (const row of rows) {
        await prisma.jingleSlot.create({
          data: {
            stationId: MAIN_STATION_ID,
            pageKey: body.toPageKey,
            slotKey: row.slotKey,
            assetId: row.assetId,
            label: row.label,
          },
        });
      }
      const copied = await prisma.jingleSlot.findMany({
        where: { stationId: MAIN_STATION_ID, pageKey: body.toPageKey },
        include: { asset: { select: { id: true, title: true, artist: true } } },
      });
      const map = emptySlots();
      for (const row of copied) {
        map[row.slotKey] = {
          assetId: row.assetId,
          label: row.label ?? row.asset.title,
          asset: { id: row.asset.id, title: row.asset.title, artist: row.asset.artist },
        };
      }
      return map;
    },
  );
};

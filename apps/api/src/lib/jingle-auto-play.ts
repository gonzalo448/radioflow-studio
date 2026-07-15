import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import { ensureMainStation } from "../services/station-state.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { logAutomation } from "./automation-log.js";
import { deferredSpotInsertAt } from "./deferred-spot-insert.js";

const SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

function normalizePageKey(raw: string | null | undefined): "A" | "B" | "C" {
  const p = (raw ?? "A").trim().toUpperCase();
  return p === "B" ? "B" : p === "C" ? "C" : "A";
}

function parseSlotKeysJson(raw: string | null | undefined): string[] {
  try {
    const j = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter((x) => typeof x === "string" && (SLOT_KEYS as readonly string[]).includes(x));
  } catch {
    return [];
  }
}

function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  if (arr.length === 1) return arr[0]!;
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export type ScheduleJingleAutoResult = {
  ok: boolean;
  inserted: number;
  deferred?: boolean;
  error?: string;
};

async function insertJingleAutoPlaceholder(stationId: string): Promise<number> {
  await prisma.$transaction(async (tx) => {
    // Evita apilar placeholders pendientes.
    await tx.playQueueItem.deleteMany({ where: { stationId, kind: "jingle_auto" } });

    const remaining = await tx.playQueueItem.findMany({
      where: { stationId },
      orderBy: { position: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i]!.position !== i) {
        await tx.playQueueItem.update({ where: { id: remaining[i]!.id }, data: { position: i } });
      }
    }

    const station = await tx.station.findUniqueOrThrow({ where: { id: stationId } });
    const insertAt = deferredSpotInsertAt(station.currentPosition, remaining);

    const toShift = await tx.playQueueItem.findMany({
      where: { stationId, position: { gte: insertAt } },
      orderBy: { position: "desc" },
    });
    for (const row of toShift) {
      await tx.playQueueItem.update({ where: { id: row.id }, data: { position: row.position + 1 } });
    }

    await tx.playQueueItem.create({
      data: {
        stationId,
        assetId: null,
        position: insertAt,
        kind: "jingle_auto",
        label: "Jingle automático (al salir al aire)",
      },
    });
  });
  return 1;
}

/** Programa un placeholder `jingle_auto` tras la canción al aire (resuelve al llegar). */
export async function scheduleJingleAutoAfterCurrent(env: Env): Promise<ScheduleJingleAutoResult> {
  await ensureMainStation();
  const inserted = await insertJingleAutoPlaceholder("main");
  logAutomation("jingle_auto_scheduled", { deferred: true });
  void broadcastStationState();
  return { ok: true, inserted, deferred: true };
}

export type ResolveJingleAutoResult = {
  ok: boolean;
  slotKey?: string;
  assetId?: string;
  error?: string;
};

/** Expande marcador `jingle_auto` eligiendo una ranura del cart wall configurada. */
export async function resolveJingleAutoQueueItem(env: Env, queueItemId: string): Promise<ResolveJingleAutoResult> {
  const item = await prisma.playQueueItem.findUnique({ where: { id: queueItemId } });
  if (!item || item.kind !== "jingle_auto") return { ok: false, error: "No hay marcador de jingle en esa fila" };

  const settings = await getOrCreateSettings();
  const pageKey = normalizePageKey(settings.jingleAutoPageKey);
  const slotKeys = parseSlotKeysJson(settings.jingleAutoSlotKeysJson);
  if (slotKeys.length === 0) {
    await prisma.playQueueItem.delete({ where: { id: queueItemId } });
    void broadcastStationState();
    return { ok: false, error: "Configure al menos una tecla para jingles automáticos" };
  }

  const rows = await prisma.jingleSlot.findMany({
    where: { stationId: "main", pageKey, slotKey: { in: slotKeys } },
    select: { slotKey: true, assetId: true },
  });

  const candidates = rows.filter((r) => r.assetId);
  if (candidates.length === 0) {
    await prisma.playQueueItem.delete({ where: { id: queueItemId } });
    void broadcastStationState();
    return { ok: false, error: "No hay audios asignados a esas teclas" };
  }

  const avoidAssetId = settings.jingleAutoLastAssetId ?? null;
  const avoidSlotKey = settings.jingleAutoLastSlotKey ?? null;

  const preferred = candidates.filter((c) => c.assetId !== avoidAssetId && c.slotKey !== avoidSlotKey);
  const pickFrom = preferred.length > 0 ? preferred : candidates;
  const chosen = pickRandom(pickFrom);
  if (!chosen) return { ok: false, error: "Sin candidatos" };

  await prisma.$transaction(async (tx) => {
    await tx.playQueueItem.update({
      where: { id: queueItemId },
      data: { kind: "track", assetId: chosen.assetId, label: `Jingle · ${pageKey}${chosen.slotKey}` },
    });
    await tx.appSettings.update({
      where: { id: "global" },
      data: {
        jingleAutoLastAssetId: chosen.assetId,
        jingleAutoLastSlotKey: chosen.slotKey,
        jingleAutoTracksSinceLast: 0,
      },
    });
  });
  void broadcastStationState();
  logAutomation("jingle_auto_resolved", { slotKey: chosen.slotKey, pageKey }, chosen.assetId);
  return { ok: true, slotKey: chosen.slotKey, assetId: chosen.assetId };
}

export async function resolveJingleAutoIfCurrent(env: Env): Promise<ResolveJingleAutoResult | null> {
  await ensureMainStation();
  const station = await prisma.station.findUniqueOrThrow({ where: { id: "main" } });
  const row = await prisma.playQueueItem.findFirst({
    where: { stationId: "main", position: station.currentPosition },
  });
  if (!row || row.kind !== "jingle_auto") return null;
  return resolveJingleAutoQueueItem(env, row.id);
}


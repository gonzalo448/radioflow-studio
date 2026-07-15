import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import { ensureMainStation } from "../services/station-state.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { logAutomation } from "./automation-log.js";
import { deferredSpotInsertAt } from "./deferred-spot-insert.js";
import { mediaRootAbs, relativeToMediaRoot } from "./media-path.js";
import {
  exactMinuteSlotKey,
  isScheduledSpotInterval,
  parseScheduledSpotSlotKey,
  timeAnnounceMaxLatenessMin,
} from "./scheduled-spot-interval.js";
import {
  listTimeAnnounceClips,
  planTimeAnnounce,
  type TimeAnnounceFolderSummary,
  type TimeAnnouncePlan,
} from "./time-announce-resolve.js";

const VAULT_PREFIX = "uploads/time-announce";
/** Locuciones suelen estar más bajas que música normalizada; boost fijo. */
const ANNOUNCE_GAIN_DB = 4;
const SLOT_LABEL_PREFIX = "time_announce_slot:";

export function encodeTimeAnnounceSlotLabel(slotKey: string): string {
  return `${SLOT_LABEL_PREFIX}${slotKey}`;
}

export function parseTimeAnnounceSlotLabel(label: string | null | undefined): string | null {
  if (!label?.startsWith(SLOT_LABEL_PREFIX)) return null;
  const key = label.slice(SLOT_LABEL_PREFIX.length).trim();
  return key.length > 0 ? key : null;
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".wav") return "audio/wav";
  if (e === ".flac") return "audio/flac";
  if (e === ".ogg" || e === ".oga") return "audio/ogg";
  if (e === ".m4a" || e === ".aac") return "audio/mp4";
  return "audio/mpeg";
}

/** Copia el clip a la bóveda y asegura MediaAsset sin cues (audio completo) + ganancia. */
async function ensureVaultAssetForClip(
  env: Env,
  absPath: string,
  fileName: string,
): Promise<string> {
  const destDir = path.join(mediaRootAbs(env), ...VAULT_PREFIX.split("/"));
  await mkdir(destDir, { recursive: true });
  const safeName = fileName.replace(/[^\w.\-áéíóúüñÁÉÍÓÚÜÑ ]+/gi, "_");
  const destAbs = path.join(destDir, safeName);
  const rel = relativeToMediaRoot(destAbs, env).split(path.sep).join("/");

  const existing = await prisma.mediaAsset.findFirst({ where: { path: rel } });
  if (existing) {
    const patch: {
      genre: string;
      playbackGainDb: number;
      cueStartSec: null;
      cueEndSec: null;
      artist: string;
    } = {
      genre: "time-announce",
      playbackGainDb: Math.max(existing.playbackGainDb ?? 0, ANNOUNCE_GAIN_DB),
      cueStartSec: null,
      cueEndSec: null,
      artist: "Locución horaria",
    };
    await prisma.mediaAsset.update({ where: { id: existing.id }, data: patch });
    return existing.id;
  }

  try {
    await copyFile(absPath, destAbs);
  } catch (err) {
    const again = await prisma.mediaAsset.findFirst({ where: { path: rel } });
    if (again) return again.id;
    throw err;
  }

  const base = path.basename(safeName, path.extname(safeName));
  const asset = await prisma.mediaAsset.create({
    data: {
      title: `Locución · ${base}`,
      artist: "Locución horaria",
      path: rel,
      mimeType: mimeFromExt(path.extname(safeName)),
      genre: "time-announce",
      playbackGainDb: ANNOUNCE_GAIN_DB,
      cueStartSec: null,
      cueEndSec: null,
    },
  });
  return asset.id;
}

export async function summarizeTimeAnnounceFolder(folderAbs: string): Promise<TimeAnnounceFolderSummary> {
  const clips = listTimeAnnounceClips(folderAbs);
  return {
    folderAbs,
    hourFiles: clips.filter((c) => c.kind === "hour").length,
    hourExactFiles: clips.filter((c) => c.kind === "hour_exact").length,
    minuteFiles: clips.filter((c) => c.kind === "minute").length,
    totalAudio: clips.length,
  };
}

export type PlayTimeAnnounceResult = {
  ok: boolean;
  hour: number;
  minute: number;
  inserted: number;
  assetIds: string[];
  fileNames: string[];
  missing: string[];
  deferred?: boolean;
  error?: string;
};

async function insertTimeAnnouncePlaceholder(stationId: string, slotKey: string): Promise<number> {
  await prisma.$transaction(async (tx) => {
    // Evita apilar varios placeholders pendientes.
    await tx.playQueueItem.deleteMany({
      where: { stationId, kind: "time_announce" },
    });

    const remaining = await tx.playQueueItem.findMany({
      where: { stationId },
      orderBy: { position: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i]!.position !== i) {
        await tx.playQueueItem.update({
          where: { id: remaining[i]!.id },
          data: { position: i },
        });
      }
    }

    const station = await tx.station.findUniqueOrThrow({ where: { id: stationId } });
    const insertAt = deferredSpotInsertAt(station.currentPosition, remaining);

    const toShift = await tx.playQueueItem.findMany({
      where: { stationId, position: { gte: insertAt } },
      orderBy: { position: "desc" },
    });
    for (const row of toShift) {
      await tx.playQueueItem.update({
        where: { id: row.id },
        data: { position: row.position + 1 },
      });
    }

    await tx.playQueueItem.create({
      data: {
        stationId,
        assetId: null,
        position: insertAt,
        kind: "time_announce",
        // slot embebido: al salir al aire se anuncia ESTA hora, no el reloj tardío
        label: encodeTimeAnnounceSlotLabel(slotKey),
      },
    });
  });
  return 1;
}

/**
 * Programa la locución para después de la canción al aire.
 * La hora anunciada es la del slot programado (no el reloj al salir al aire).
 */
export async function scheduleTimeAnnounceAfterCurrent(
  env: Env,
  opts?: { folderAbs?: string | null; slotKey?: string | null; now?: Date },
): Promise<PlayTimeAnnounceResult> {
  const settings = await getOrCreateSettings();
  const folderAbs = (opts?.folderAbs ?? settings.timeAnnounceFolderAbs ?? "").trim();
  if (!folderAbs) {
    return {
      ok: false,
      hour: 0,
      minute: 0,
      inserted: 0,
      assetIds: [],
      fileNames: [],
      missing: [],
      error: "Configure la carpeta de locución horaria (explorador de Windows).",
    };
  }

  const now = opts?.now ?? new Date();
  const slotKey = (opts?.slotKey ?? exactMinuteSlotKey(now)).trim();
  const slotAt = parseScheduledSpotSlotKey(slotKey) ?? now;

  const probe = planTimeAnnounce(folderAbs, slotAt);
  if (probe.clips.length === 0 && probe.missing.length >= 2) {
    // Carpeta vacía / sin nomenclatura — avisar ya.
    return {
      ok: false,
      hour: probe.hour,
      minute: probe.minute,
      inserted: 0,
      assetIds: [],
      fileNames: [],
      missing: probe.missing,
      error: `La carpeta no tiene clips reconocibles (HRS__/MIN__).`,
    };
  }

  await ensureMainStation();
  const inserted = await insertTimeAnnouncePlaceholder("main", slotKey);
  void broadcastStationState();
  logAutomation("time_announce", { phase: "scheduled", slotKey, hour: probe.hour, minute: probe.minute });

  return {
    ok: true,
    hour: probe.hour,
    minute: probe.minute,
    inserted,
    assetIds: [],
    fileNames: [],
    missing: [],
    deferred: true,
  };
}

/**
 * Resuelve clips del reloj local e inserta pistas ya materializadas
 * (uso inmediato / append al final, sin esperar canción).
 */
export async function playTimeAnnounceNow(
  env: Env,
  opts?: { folderAbs?: string | null; afterCurrent?: boolean; now?: Date },
): Promise<PlayTimeAnnounceResult> {
  if (opts?.afterCurrent !== false) {
    return scheduleTimeAnnounceAfterCurrent(env, {
      folderAbs: opts?.folderAbs,
      slotKey: exactMinuteSlotKey(opts?.now ?? new Date()),
      now: opts?.now,
    });
  }

  const settings = await getOrCreateSettings();
  const folderAbs = (opts?.folderAbs ?? settings.timeAnnounceFolderAbs ?? "").trim();
  if (!folderAbs) {
    return {
      ok: false,
      hour: 0,
      minute: 0,
      inserted: 0,
      assetIds: [],
      fileNames: [],
      missing: [],
      error: "Configure la carpeta de locución horaria (explorador de Windows).",
    };
  }

  const plan: TimeAnnouncePlan = planTimeAnnounce(folderAbs, opts?.now ?? new Date());
  if (plan.clips.length === 0) {
    return {
      ok: false,
      hour: plan.hour,
      minute: plan.minute,
      inserted: 0,
      assetIds: [],
      fileNames: [],
      missing: plan.missing,
      error: `No hay clips para ${String(plan.hour).padStart(2, "0")}:${String(plan.minute).padStart(2, "0")}. Falta: ${plan.missing.join(", ")}`,
    };
  }

  const assetIds: string[] = [];
  const fileNames: string[] = [];
  for (const clip of plan.clips) {
    const id = await ensureVaultAssetForClip(env, clip.absPath, clip.fileName);
    assetIds.push(id);
    fileNames.push(clip.fileName);
  }

  await ensureMainStation();
  const last = await prisma.playQueueItem.findFirst({
    where: { stationId: "main" },
    orderBy: { position: "desc" },
  });
  let pos = (last?.position ?? -1) + 1;
  let inserted = 0;
  for (const assetId of assetIds) {
    await prisma.playQueueItem.create({
      data: { stationId: "main", assetId, position: pos, kind: "track" },
    });
    pos += 1;
    inserted += 1;
  }
  void broadcastStationState();

  return {
    ok: true,
    hour: plan.hour,
    minute: plan.minute,
    inserted,
    assetIds,
    fileNames,
    missing: plan.missing,
  };
}

export type ResolveTimeAnnounceResult = {
  ok: boolean;
  hour?: number;
  minute?: number;
  fileNames?: string[];
  error?: string;
};

/**
 * Cuando el marcador `time_announce` está al aire: anuncia la hora del reloj
 * del PC en el momento de reproducir (no la del slot programado). Así, si el
 * spot se atrasó (p. ej. slot :45 pero suena a las :47), se dicen las :47.
 * Si el retraso supera la gracia del intervalo, descarta el marcador.
 */
export async function resolveTimeAnnounceQueueItem(
  env: Env,
  queueItemId: string,
  now = new Date(),
): Promise<ResolveTimeAnnounceResult> {
  const item = await prisma.playQueueItem.findUnique({ where: { id: queueItemId } });
  if (!item || item.kind !== "time_announce") {
    return { ok: false, error: "No hay marcador de locución horaria en esa fila" };
  }

  const settings = await getOrCreateSettings();
  const folderAbs = (settings.timeAnnounceFolderAbs ?? "").trim();
  if (!folderAbs) {
    await prisma.playQueueItem.delete({ where: { id: queueItemId } });
    void broadcastStationState();
    return { ok: false, error: "Sin carpeta de locución configurada" };
  }

  const slotKey =
    parseTimeAnnounceSlotLabel(item.label) ??
    (isScheduledSpotInterval(settings.timeAnnounceIntervalMin) && settings.timeAnnounceIntervalMin > 0
      ? null
      : exactMinuteSlotKey(now));
  const slotAt = slotKey ? parseScheduledSpotSlotKey(slotKey) : null;

  if (slotAt) {
    const latenessMin = (now.getTime() - slotAt.getTime()) / 60_000;
    const intervalRaw = settings.timeAnnounceIntervalMin ?? 0;
    const maxLate = timeAnnounceMaxLatenessMin(
      isScheduledSpotInterval(intervalRaw) ? intervalRaw : 0,
    );
    if (latenessMin > maxLate) {
      await prisma.playQueueItem.delete({ where: { id: queueItemId } });
      void broadcastStationState();
      logAutomation(
        "time_announce",
        { phase: "skipped_late", slotKey, latenessMin: Math.round(latenessMin), maxLate },
        null,
      );
      return {
        ok: false,
        hour: now.getHours(),
        minute: now.getMinutes(),
        error: `Locución del slot ${slotKey} descartada: llegó ${Math.round(latenessMin)} min tarde (máx. ${maxLate})`,
      };
    }
  }

  // Hora hablada = reloj actual (no el slot :45 si ya son :47).
  const plan = planTimeAnnounce(folderAbs, now);
  if (plan.clips.length === 0) {
    await prisma.playQueueItem.delete({ where: { id: queueItemId } });
    void broadcastStationState();
    return {
      ok: false,
      hour: plan.hour,
      minute: plan.minute,
      error: `Sin clips para ${String(plan.hour).padStart(2, "0")}:${String(plan.minute).padStart(2, "0")}`,
    };
  }

  const assetIds: string[] = [];
  const fileNames: string[] = [];
  for (const clip of plan.clips) {
    assetIds.push(await ensureVaultAssetForClip(env, clip.absPath, clip.fileName));
    fileNames.push(clip.fileName);
  }

  const stationId = item.stationId;
  const basePos = item.position;
  const extra = assetIds.length - 1;

  await prisma.$transaction(async (tx) => {
    if (extra > 0) {
      const toShift = await tx.playQueueItem.findMany({
        where: { stationId, position: { gt: basePos } },
        orderBy: { position: "desc" },
      });
      for (const row of toShift) {
        await tx.playQueueItem.update({
          where: { id: row.id },
          data: { position: row.position + extra },
        });
      }
    }

    // Primera pista sustituye al marcador
    await tx.playQueueItem.update({
      where: { id: queueItemId },
      data: {
        kind: "track",
        assetId: assetIds[0]!,
        label: `Locución ${String(plan.hour).padStart(2, "0")}:${String(plan.minute).padStart(2, "0")}`,
      },
    });

    for (let i = 1; i < assetIds.length; i++) {
      await tx.playQueueItem.create({
        data: {
          stationId,
          assetId: assetIds[i]!,
          position: basePos + i,
          kind: "track",
          label: null,
        },
      });
    }
  });

  void broadcastStationState();
  logAutomation(
    "time_announce",
    { hour: plan.hour, minute: plan.minute, fileNames, assetIds, slotKey: slotKey ?? null },
    assetIds[0] ?? null,
  );
  return {
    ok: true,
    hour: plan.hour,
    minute: plan.minute,
    fileNames,
  };
}

/** Si la posición actual es un marcador time_announce, lo expande con el reloj del PC. */
export async function resolveTimeAnnounceIfCurrent(env: Env): Promise<ResolveTimeAnnounceResult | null> {
  await ensureMainStation();
  const station = await prisma.station.findUniqueOrThrow({ where: { id: "main" } });
  const row = await prisma.playQueueItem.findFirst({
    where: { stationId: "main", position: station.currentPosition },
  });
  if (!row || row.kind !== "time_announce") return null;
  return resolveTimeAnnounceQueueItem(env, row.id, new Date());
}

import type { Station } from "@prisma/client";
import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { ensureMainStation, repairStationQueuePosition } from "./station-state.js";
import { removePlayedQueueUpTo } from "./station-queue.js";
import { finishedPositionAfterSkip } from "../lib/station-skip-math.js";
import { maybeTriggerQueueItemDtmf } from "../lib/queue-item-dtmf-trigger.js";
import { resolveTimeAnnounceQueueItem } from "../lib/time-announce-play.js";
import { resolveStationIntroQueueItem } from "../lib/station-intro-play.js";
import { resolveJingleAutoQueueItem } from "../lib/jingle-auto-play.js";
import { scheduleJingleAutoAfterCurrent } from "../lib/jingle-auto-play.js";
import { getOrCreateSettings } from "./app-settings.js";
import { runAutoDjRefillTick } from "./autodj-refill.js";

type SkipInput = {
  stationId: string;
  env?: Env;
};

type SkipResult = {
  station: Station;
  nowItem: { assetId: string | null; kind: string; queueItemId: string } | null;
  logDetails: { from: number; to: number; removedPlayed?: number };
};

async function rowAtPosition(stationId: string, position: number) {
  return prisma.playQueueItem.findFirst({
    where: { stationId, position },
  });
}

export async function skipStation(input: SkipInput): Promise<SkipResult> {
  await ensureMainStation();
  await repairStationQueuePosition(input.stationId);

  const station = await prisma.station.findUniqueOrThrow({ where: { id: input.stationId } });
  const from = station.currentPosition;

  const queue = await prisma.playQueueItem.findMany({
    where: { stationId: input.stationId },
    orderBy: { position: "asc" },
  });

  const current = from >= 0 && from < queue.length ? queue[from] : null;

  // Marcador diferido: resuelve al llegar al aire (misma posición).
  if (current?.kind === "time_announce" && input.env) {
    await resolveTimeAnnounceQueueItem(input.env, current.id, new Date());
    const refreshed = await prisma.station.findUniqueOrThrow({ where: { id: input.stationId } });
    const nowRow = await rowAtPosition(input.stationId, from);
    return {
      station: refreshed,
      nowItem: nowRow
        ? { assetId: nowRow.assetId, kind: nowRow.kind, queueItemId: nowRow.id }
        : null,
      logDetails: { from, to: from },
    };
  }

  if (current?.kind === "station_intro" && input.env) {
    await resolveStationIntroQueueItem(input.env, current.id);
    const refreshed = await prisma.station.findUniqueOrThrow({ where: { id: input.stationId } });
    const nowRow = await rowAtPosition(input.stationId, from);
    return {
      station: refreshed,
      nowItem: nowRow
        ? { assetId: nowRow.assetId, kind: nowRow.kind, queueItemId: nowRow.id }
        : null,
      logDetails: { from, to: from },
    };
  }

  if (current?.kind === "jingle_auto" && input.env) {
    await resolveJingleAutoQueueItem(input.env, current.id);
    const refreshed = await prisma.station.findUniqueOrThrow({ where: { id: input.stationId } });
    const nowRow = await rowAtPosition(input.stationId, from);
    return {
      station: refreshed,
      nowItem: nowRow ? { assetId: nowRow.assetId, kind: nowRow.kind, queueItemId: nowRow.id } : null,
      logDetails: { from, to: from },
    };
  }

  // Jingles automáticos por cantidad de canciones:
  // al terminar una pista reproducible, incrementa contador y si llega al umbral,
  // inserta un marcador `jingle_auto` para que suene inmediatamente después.
  if (current && input.env) {
    const settings = await getOrCreateSettings();
    const every = settings.jingleAutoEveryTracks ?? 0;
    if (every > 0 && (current.kind === "track" || current.kind === "voicetrack")) {
      const nextCount = (settings.jingleAutoTracksSinceLast ?? 0) + 1;
      await prisma.appSettings.update({
        where: { id: "global" },
        data: {
          jingleAutoTracksSinceLast: nextCount >= every ? 0 : nextCount,
        },
      });
      if (nextCount >= every) {
        await scheduleJingleAutoAfterCurrent(input.env);
      }
    }
  }

  if (current) {
    await maybeTriggerQueueItemDtmf({ kind: current.kind, label: current.label });
  }

  // Borrar lo ya sonado (pista/locución/intro al aire y anteriores); la siguiente queda en #0.
  const finishedAt = finishedPositionAfterSkip(from, Boolean(current));
  const prune =
    finishedAt >= 0
      ? await removePlayedQueueUpTo(input.stationId, finishedAt)
      : { removed: 0, remaining: queue.length };

  const updated = await prisma.station.findUniqueOrThrow({ where: { id: input.stationId } });
  const to = 0;

  let nowRow = await rowAtPosition(input.stationId, to);

  // Al aterrizar en el marcador: expandir con la hora del slot programado.
  if (nowRow?.kind === "time_announce" && input.env) {
    await resolveTimeAnnounceQueueItem(input.env, nowRow.id, new Date());
    nowRow = await rowAtPosition(input.stationId, to);
  }

  if (nowRow?.kind === "station_intro" && input.env) {
    await resolveStationIntroQueueItem(input.env, nowRow.id);
    nowRow = await rowAtPosition(input.stationId, to);
  }

  if (nowRow?.kind === "jingle_auto" && input.env) {
    await resolveJingleAutoQueueItem(input.env, nowRow.id);
    nowRow = await rowAtPosition(input.stationId, to);
  }

  // Cabina / listas de pistas: rellenar cola antes de entregar el siguiente ítem.
  if (input.env) {
    const refill = await runAutoDjRefillTick(input.env);
    if (refill.added > 0 && !nowRow) {
      nowRow = await rowAtPosition(input.stationId, to);
      if (nowRow?.kind === "time_announce") {
        await resolveTimeAnnounceQueueItem(input.env, nowRow.id, new Date());
        nowRow = await rowAtPosition(input.stationId, to);
      }
      if (nowRow?.kind === "station_intro") {
        await resolveStationIntroQueueItem(input.env, nowRow.id);
        nowRow = await rowAtPosition(input.stationId, to);
      }
      if (nowRow?.kind === "jingle_auto") {
        await resolveJingleAutoQueueItem(input.env, nowRow.id);
        nowRow = await rowAtPosition(input.stationId, to);
      }
    }
  }

  const nowItem = nowRow
    ? { assetId: nowRow.assetId, kind: nowRow.kind, queueItemId: nowRow.id }
    : null;

  return {
    station: updated,
    nowItem,
    logDetails: { from, to, removedPlayed: prune.removed },
  };
}

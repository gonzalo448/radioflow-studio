import type { Env } from "../config.js";
import type { QueueEntryKind } from "@radioflow/shared";
import { isSpotLikeAsset } from "@radioflow/shared";
import { prisma } from "../db.js";
import { logAutomation } from "../lib/automation-log.js";
import {
  UNKNOWN_DURATION_GRACE_SEC,
  applyCrossfadeToSegmentNeed,
  playableDurationFromMeta,
} from "../lib/headless-segment-duration.js";
import { readAudioDurationSeconds } from "../lib/library-check-tracks.js";
import { readDurationSecondsWithFfprobe } from "../lib/ffprobe-duration.js";
import { resolveAssetFilePath } from "../lib/media-path.js";
import { logAndBroadcastSkip } from "./station-events.js";
import { syncNowPlayingTracker } from "./now-playing.js";
import { skipStation } from "./station-skip.js";
import { maybeTriggerQueueItemDtmf } from "../lib/queue-item-dtmf-trigger.js";
import { getStationState, MAIN_STATION_ID } from "./station-state.js";
import { executePlaylistCmdLabel } from "./execute-playlist-cmd.js";

/**
 * A3: si no hay cues ni durationSec ni ffprobe/metadata, no inventamos 240 s.
 * Gracia corta y luego skip (evita atascar el aire en headless).
 */

type ProbeCacheEntry = { durationSec: number | null; atMs: number };
const probeCache = new Map<string, ProbeCacheEntry>();
const PROBE_CACHE_TTL_MS = 5 * 60_000;
const PROBE_NEGATIVE_TTL_MS = 60_000;

let lastClientHeartbeatMs = 0;
/** Última posición reportada por la UI (s); sirve al ceder el reloj al headless. */
let lastClientCurrentSec: number | null = null;
/** El tick anterior lo gobernaba la UI: al pasar a headless hay que anclar el reloj de nuevo. */
let lastTickWasClient = false;
let segmentAnchor: { queueItemId: string; startedAtMs: number; loggedUnknown?: boolean } | null =
  null;

/** Presencia de cliente UI (cualquier heartbeat). `playing` ya no condiciona el stale. */
export function touchPlayoutClientHeartbeat(
  _playing = true,
  currentSec?: number | null,
): void {
  lastClientHeartbeatMs = Date.now();
  if (currentSec != null && Number.isFinite(currentSec) && currentSec >= 0) {
    lastClientCurrentSec = currentSec;
  }
}

export function resetHeadlessPlayoutSegment(): void {
  segmentAnchor = null;
  lastClientCurrentSec = null;
}

export function headlessPlayoutStatus(env: Env): {
  serverDriving: boolean;
  clientActive: boolean;
  segmentQueueItemId: string | null;
} {
  const clientActive = Date.now() - lastClientHeartbeatMs < env.HEADLESS_PLAYOUT_CLIENT_STALE_MS;
  return {
    serverDriving: env.HEADLESS_PLAYOUT_POLL_MS > 0 && !clientActive,
    clientActive,
    segmentQueueItemId: segmentAnchor?.queueItemId ?? null,
  };
}

async function probeAndMaybePersistDuration(
  env: Env,
  assetId: string,
  storedPath: string,
): Promise<number | null> {
  const now = Date.now();
  const cached = probeCache.get(assetId);
  if (cached) {
    const ttl = cached.durationSec != null ? PROBE_CACHE_TTL_MS : PROBE_NEGATIVE_TTL_MS;
    if (now - cached.atMs < ttl) return cached.durationSec;
  }

  const abs = resolveAssetFilePath(storedPath, env);
  if (!abs) {
    probeCache.set(assetId, { durationSec: null, atMs: now });
    return null;
  }

  const measured =
    (await readAudioDurationSeconds(abs, env)) ??
    // A3: en headless siempre intentar ffprobe si metadata no da duración (aunque AUDIO_FFPROBE_ENABLED=0).
    (await readDurationSecondsWithFfprobe(abs, env.FFPROBE_PATH));
  probeCache.set(assetId, { durationSec: measured, atMs: now });

  if (measured != null && measured > 0) {
    try {
      await prisma.mediaAsset.update({
        where: { id: assetId },
        data: { durationSec: Math.round(measured) },
      });
    } catch {
      /* no bloquear headless si el update falla */
    }
  }
  return measured;
}

type SegmentNeed = {
  /** Segundos hasta el skip; 0 = salta ya. */
  needSec: number;
  source: "meta" | "probe" | "unknown_grace" | "instant";
};

async function resolveSegmentNeed(
  env: Env,
  kind: QueueEntryKind,
  pauseSec: number | null,
  asset: {
    id: string;
    path: string;
    durationSec: number | null;
    cueStartSec?: number | null;
    cueEndSec?: number | null;
  } | null,
  crossfadeSec: number,
  noOverlap: boolean,
  vtIsBridged: boolean,
): Promise<SegmentNeed | null> {
  if (
    kind === "marker" ||
    kind === "dtmf" ||
    kind === "cmd" ||
    kind === "time_announce" ||
    kind === "station_intro" ||
    kind === "jingle_auto"
  ) {
    return { needSec: 0, source: "instant" };
  }
  if (kind === "hour_marker") {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return { needSec: Math.max(0, (next.getTime() - now.getTime()) / 1000), source: "instant" };
  }
  if (kind === "pause") {
    return { needSec: Math.max(0, pauseSec ?? 0), source: "instant" };
  }
  if (kind === "voicetrack" && vtIsBridged) {
    return { needSec: 0, source: "instant" };
  }
  if (kind !== "track" && kind !== "voicetrack") return null;
  if (!asset) {
    return { needSec: UNKNOWN_DURATION_GRACE_SEC, source: "unknown_grace" };
  }

  let playable = playableDurationFromMeta(asset.durationSec, asset.cueStartSec, asset.cueEndSec);
  let source: SegmentNeed["source"] = "meta";

  if (playable == null) {
    const probed = await probeAndMaybePersistDuration(env, asset.id, asset.path);
    if (probed != null && probed > 0) {
      const start =
        asset.cueStartSec != null && Number.isFinite(asset.cueStartSec) && asset.cueStartSec >= 0
          ? asset.cueStartSec
          : 0;
      playable = Math.max(0.5, probed - start);
      source = "probe";
    }
  }

  if (playable == null) {
    return { needSec: UNKNOWN_DURATION_GRACE_SEC, source: "unknown_grace" };
  }

  return {
    needSec: applyCrossfadeToSegmentNeed(playable, crossfadeSec, noOverlap),
    source,
  };
}

/** Avanza la cola al aire sin UI (modo AUTO) cuando no hay heartbeat reciente del cliente. */
export async function runHeadlessPlayoutTick(env: Env): Promise<void> {
  if (env.HEADLESS_PLAYOUT_POLL_MS <= 0) return;

  const state = await getStationState();
  const { station, queue, currentQueueEntry } = state;

  if (station.mode !== "AUTO") {
    resetHeadlessPlayoutSegment();
    return;
  }

  if (!currentQueueEntry || queue.length === 0) {
    resetHeadlessPlayoutSegment();
    return;
  }

  const clientActive = Date.now() - lastClientHeartbeatMs < env.HEADLESS_PLAYOUT_CLIENT_STALE_MS;
  if (clientActive) {
    lastTickWasClient = true;
    if (segmentAnchor?.queueItemId !== currentQueueEntry.id) {
      segmentAnchor = { queueItemId: currentQueueEntry.id, startedAtMs: Date.now() };
    }
    return;
  }

  // Al ceder de UI → headless: no reutilizar el ancla de cuando la UI estaba al mando
  // (elapsed ya consumido → skip inmediato / canciones “saltando”).
  if (segmentAnchor?.queueItemId !== currentQueueEntry.id || lastTickWasClient) {
    const offsetSec = Math.max(0, lastClientCurrentSec ?? 0);
    segmentAnchor = {
      queueItemId: currentQueueEntry.id,
      startedAtMs: Date.now() - offsetSec * 1000,
    };
    lastTickWasClient = false;
    lastClientCurrentSec = null;
  }

  const kind = currentQueueEntry.kind as QueueEntryKind;
  const crossfade = station.cabCrossfadeSec ?? 4;
  const nextRow = queue[station.currentPosition + 1];
  const prevRow = queue[station.currentPosition - 1];
  const nextIsSpot = Boolean(
    nextRow &&
      (nextRow.kind === "time_announce" ||
        nextRow.kind === "station_intro" ||
        nextRow.kind === "jingle_auto" ||
        isSpotLikeAsset(nextRow.asset)),
  );
  /** Un spot al aire (jingle/locución) suena completo: sin adelantar el skip. */
  const currentIsSpot = kind === "track" && isSpotLikeAsset(currentQueueEntry.asset);
  const vtIsBridged =
    kind === "voicetrack" &&
    Boolean(prevRow && prevRow.kind === "track" && prevRow.asset) &&
    Boolean(nextRow && nextRow.kind === "track" && nextRow.asset);

  const resolved = await resolveSegmentNeed(
    env,
    kind,
    currentQueueEntry.pauseSec,
    currentQueueEntry.asset
      ? {
          id: currentQueueEntry.asset.id,
          path: currentQueueEntry.asset.path,
          durationSec: currentQueueEntry.asset.durationSec ?? null,
          cueStartSec: currentQueueEntry.asset.cueStartSec,
          cueEndSec: currentQueueEntry.asset.cueEndSec,
        }
      : null,
    crossfade,
    nextIsSpot || currentIsSpot,
    vtIsBridged,
  );
  if (!resolved) return;

  if (resolved.source === "unknown_grace" && segmentAnchor && !segmentAnchor.loggedUnknown) {
    segmentAnchor.loggedUnknown = true;
    logAutomation(
      "headless_playout",
      {
        phase: "unknown_duration_grace",
        queueItemId: currentQueueEntry.id,
        assetId: currentQueueEntry.asset?.id ?? null,
        graceSec: UNKNOWN_DURATION_GRACE_SEC,
      },
      null,
    );
  }

  const elapsedSec = (Date.now() - segmentAnchor!.startedAtMs) / 1000;
  if (elapsedSec < resolved.needSec) return;

  await maybeTriggerQueueItemDtmf({
    kind: currentQueueEntry.kind,
    label: currentQueueEntry.label,
  });

  if (kind === "cmd") {
    const exec = await executePlaylistCmdLabel(currentQueueEntry.label, env);
    if (!exec.shouldSkip) {
      segmentAnchor = null;
      return;
    }
  }

  const result = await skipStation({ stationId: MAIN_STATION_ID, env });
  segmentAnchor = null;
  syncNowPlayingTracker(result.nowItem?.assetId ?? null, {
    source: "headless-playout",
    durationSource: resolved.source,
  });

  await logAndBroadcastSkip({
    userId: null,
    assetId: result.nowItem?.assetId ?? null,
    details: {
      ...result.logDetails,
      source: "headless-playout",
      durationSource: resolved.source,
      needSec: resolved.needSec,
    },
  });
}

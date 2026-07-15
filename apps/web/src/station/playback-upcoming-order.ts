import type { ApiPlaybackQueueEntry, ApiStationAsset, ApiStationQueueItem } from "@radioflow/shared";

type AssetDur = ApiStationAsset & { durationSec?: number | null };

function queueIndexOf(queue: ApiStationQueueItem[], playQueueItemId: string): number {
  return queue.findIndex((r) => r.id === playQueueItemId);
}

/** Spots diferidos: deben sonar en orden de parrilla; Cr.p. no puede saltarlos. */
export function isDeferredSpotKind(kind: string): boolean {
  return kind === "time_announce" || kind === "station_intro" || kind === "jingle_auto";
}

/** Pistas ya materializadas de locución/intro/jingle (no mezclar encima de música). */
export function isAnnounceGenreAsset(asset: { genre?: string | null } | null | undefined): boolean {
  const g = asset?.genre ?? "";
  return g === "time-announce" || g === "station-intro" || g === "jingle-auto";
}

export function isAnnounceOrDeferredQueueRow(row: ApiStationQueueItem | undefined): boolean {
  if (!row) return false;
  if (isDeferredSpotKind(row.kind)) return true;
  if ((row.kind === "track" || row.kind === "voicetrack") && isAnnounceGenreAsset(row.asset)) return true;
  return false;
}

/**
 * True si entre `curPos` y la siguiente canción de biblioteca hay un spot
 * (marcador diferido o pista de locución/intro/jingle).
 */
export function hasDeferredSpotBeforeNextTrack(
  queue: ApiStationQueueItem[],
  curPos: number,
): boolean {
  for (let i = curPos + 1; i < queue.length; i++) {
    const r = queue[i]!;
    if (isAnnounceOrDeferredQueueRow(r)) return true;
    if ((r.kind === "track" || r.kind === "voicetrack") && r.asset) return false;
  }
  return false;
}

/** Primera pista que aún no sonó: Cr.p. con índice > posición actual, si no la fila siguiente en parrilla.
 * Excepción: un spot diferido en `curPos+1` tiene prioridad absoluta (no saltarlo con Cr.p.). */
export function logicalNextQueueRow(
  queue: ApiStationQueueItem[],
  curPos: number,
  playbackQ: ApiPlaybackQueueEntry[],
): ApiStationQueueItem | undefined {
  const linearNext = queue[curPos + 1];
  if (linearNext && isDeferredSpotKind(linearNext.kind)) return linearNext;

  const sorted = [...playbackQ].sort((a, b) => a.sortIndex - b.sortIndex);
  const byId = new Map(queue.map((r) => [r.id, r]));

  for (const entry of sorted) {
    const row = byId.get(entry.playQueueItemId);
    if (!row) continue;
    if (queueIndexOf(queue, row.id) > curPos) return row;
  }

  return linearNext;
}

/** Siguiente fila con audio reproducible (salta pausas/marcadores para prefetch).
 * Si lo próximo es locución/intro/jingle (marcador o pista), no hay prefetch:
 * la canción actual termina sola y recién después suena el spot (sin mezclar). */
export function logicalNextPlayableQueueRow(
  queue: ApiStationQueueItem[],
  curPos: number,
  playbackQ: ApiPlaybackQueueEntry[],
): ApiStationQueueItem | undefined {
  if (hasDeferredSpotBeforeNextTrack(queue, curPos)) return undefined;

  const upcoming = buildPlaybackUpcomingOrdered(queue, curPos, playbackQ);
  for (const r of upcoming) {
    if (isAnnounceOrDeferredQueueRow(r)) return undefined;
    if ((r.kind === "track" || r.kind === "voicetrack") && r.asset) return r;
  }
  return undefined;
}

/** Lista completa “siguientes” respetando spots diferidos, luego Cr.p., sin duplicar ids. */
export function buildPlaybackUpcomingOrdered(
  queue: ApiStationQueueItem[],
  curPos: number,
  playbackQ: ApiPlaybackQueueEntry[],
): ApiStationQueueItem[] {
  // Posición huérfana (p. ej. tras borrar pistas): tratar como “nada al aire” y listar desde el inicio.
  const effectivePos =
    queue.length === 0 ? 0 : curPos >= queue.length || curPos < -1 ? -1 : curPos;
  const byId = new Map(queue.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: ApiStationQueueItem[] = [];

  const push = (row: ApiStationQueueItem | undefined) => {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
  };

  // Primero la parrilla lineal desde curPos+1 hasta (e incluyendo) spots diferidos,
  // para que la UI y el prefetch no antepongan Cr.p. a una locución/intro.
  for (let i = effectivePos + 1; i < queue.length; i++) {
    const row = queue[i]!;
    push(row);
    if (isDeferredSpotKind(row.kind)) {
      // Tras el bloque de spots diferidos consecutivos, seguir con Cr.p. / resto.
      let j = i + 1;
      while (j < queue.length && isDeferredSpotKind(queue[j]!.kind)) {
        push(queue[j]);
        j += 1;
      }
      break;
    }
    if ((row.kind === "track" || row.kind === "voicetrack") && row.asset) break;
  }

  push(logicalNextQueueRow(queue, Math.max(0, effectivePos), playbackQ));

  const pqSorted = [...playbackQ].sort((a, b) => a.sortIndex - b.sortIndex);
  for (const e of pqSorted) {
    const row = byId.get(e.playQueueItemId);
    if (row && queueIndexOf(queue, row.id) > Math.max(0, effectivePos)) push(row);
  }

  for (let i = effectivePos + 1; i < queue.length; i++) push(queue[i]);

  return out;
}

export function buildPlaybackUpcomingFirstN(
  queue: ApiStationQueueItem[],
  curPos: number,
  playbackQ: ApiPlaybackQueueEntry[],
  n: number,
): ApiStationQueueItem[] {
  return buildPlaybackUpcomingOrdered(queue, curPos, playbackQ).slice(0, n);
}

export function sumUpcomingDurationSec(rows: ApiStationQueueItem[]): number | null {
  let t = 0;
  let n = 0;
  for (const r of rows) {
    if (r.kind === "pause" && r.pauseSec != null && r.pauseSec > 0) {
      t += r.pauseSec;
      n += 1;
      continue;
    }
    if (r.kind !== "track" && r.kind !== "voicetrack") continue;
    if (!r.asset) continue;
    const d = (r.asset as AssetDur).durationSec;
    if (d != null && d > 0) {
      t += d;
      n += 1;
    }
  }
  return n > 0 ? t : null;
}

import type { ApiPlaylistItem } from "@radioflow/shared";

/** Ítems que generan una o más entradas en la cola al volcar la lista. */
export function isSyncablePlaylistItem(item: ApiPlaylistItem): boolean {
  // Las notas no van a cola. track_list y container sí se expanden a pistas/comandos.
  return item.kind !== "note";
}

/** Hay al menos un origen que puede producir audio al aire (pista fija o lista de pistas). */
export function playlistHasAirContent(items: ApiPlaylistItem[]): boolean {
  return items.some(
    (it) =>
      ((it.kind === "track" || it.kind === "voicetrack") && Boolean(it.asset)) ||
      it.kind === "track_list" ||
      it.kind === "container",
  );
}

/** Índice en cola al aire para una fila de playlist (las notas no van a cola). */
export function queuePositionForPlaylistIndex(items: ApiPlaylistItem[], playlistIndex: number): number {
  if (playlistIndex < 0 || playlistIndex >= items.length) return 0;
  if (!isSyncablePlaylistItem(items[playlistIndex]!)) return 0;
  let qPos = 0;
  for (let i = 0; i < playlistIndex; i++) {
    if (isSyncablePlaylistItem(items[i]!)) qPos++;
  }
  return qPos;
}

/** Fila de playlist que corresponde a la posición actual en cola. */
export function playlistIndexForQueuePosition(items: ApiPlaylistItem[], queuePos: number): number | null {
  let q = 0;
  for (let i = 0; i < items.length; i++) {
    if (!isSyncablePlaylistItem(items[i]!)) continue;
    if (q === queuePos) return i;
    q++;
  }
  return null;
}

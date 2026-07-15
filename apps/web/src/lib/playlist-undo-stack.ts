import { useCallback, useMemo, useRef, useState } from "react";
import type { ApiPlaylistDetail, ApiPlaylistItem } from "@radioflow/shared";
import { apiFetch } from "./api";

const MAX_UNDO = 20;

export type PlaylistSnapshotItem = {
  kind: ApiPlaylistItem["kind"];
  assetId?: string | null;
  label?: string | null;
  pauseSec?: number | null;
  trackListSpec?: ApiPlaylistItem["trackListSpec"];
};

function toSnapshot(items: ApiPlaylistItem[]): PlaylistSnapshotItem[] {
  return items.map((it) => ({
    kind: it.kind,
    assetId: it.asset?.id ?? null,
    label: it.label,
    pauseSec: it.pauseSec,
    trackListSpec: it.trackListSpec ?? null,
  }));
}

function snapshotsEqual(a: PlaylistSnapshotItem[], b: PlaylistSnapshotItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const o = b[i]!;
    return (
      row.kind === o.kind &&
      row.assetId === o.assetId &&
      row.label === o.label &&
      row.pauseSec === o.pauseSec &&
      JSON.stringify(row.trackListSpec ?? null) === JSON.stringify(o.trackListSpec ?? null)
    );
  });
}

export function usePlaylistUndoStack(playlistId: string | undefined, token: string | null) {
  const undoRef = useRef<PlaylistSnapshotItem[][]>([]);
  const redoRef = useRef<PlaylistSnapshotItem[][]>([]);
  const [rev, setRev] = useState(0);

  const bump = useCallback(() => setRev((n) => n + 1), []);

  const pushSnapshot = useCallback(
    (detail: ApiPlaylistDetail) => {
      if (!playlistId || detail.id !== playlistId) return;
      const snap = toSnapshot(detail.items);
      const last = undoRef.current[undoRef.current.length - 1];
      if (last && snapshotsEqual(last, snap)) return;
      undoRef.current = [...undoRef.current.slice(-(MAX_UNDO - 1)), snap];
      redoRef.current = [];
      bump();
    },
    [playlistId, bump],
  );

  const beforeMutation = useCallback(
    (detail: ApiPlaylistDetail | null) => {
      if (!detail || !playlistId || detail.id !== playlistId) return;
      pushSnapshot(detail);
    },
    [playlistId, pushSnapshot],
  );

  const restore = useCallback(
    async (snap: PlaylistSnapshotItem[]) => {
      if (!token || !playlistId) return null;
      return apiFetch<ApiPlaylistDetail>(`/api/playlists/${encodeURIComponent(playlistId)}/items/restore`, {
        method: "PUT",
        token,
        body: JSON.stringify({ items: snap }),
      });
    },
    [playlistId, token],
  );

  const undo = useCallback(
    async (current: ApiPlaylistDetail | null, reload: () => Promise<void>) => {
      if (!current || undoRef.current.length === 0) return;
      const prev = undoRef.current.pop()!;
      redoRef.current = [...redoRef.current, toSnapshot(current.items)];
      await restore(prev);
      bump();
      await reload();
    },
    [restore, bump],
  );

  const redo = useCallback(
    async (current: ApiPlaylistDetail | null, reload: () => Promise<void>) => {
      if (!current || redoRef.current.length === 0) return;
      const next = redoRef.current.pop()!;
      undoRef.current = [...undoRef.current, toSnapshot(current.items)];
      await restore(next);
      bump();
      await reload();
    },
    [restore, bump],
  );

  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  return useMemo(
    () => ({
      pushSnapshot,
      beforeMutation,
      undo,
      redo,
      canUndo,
      canRedo,
      rev,
    }),
    [pushSnapshot, beforeMutation, undo, redo, canUndo, canRedo, rev],
  );
}

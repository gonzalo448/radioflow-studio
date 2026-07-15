import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** API expuesta por la vista de playlist hacia la barra de menús. */
export type PlaylistMenuEditor = {
  playlistId: string;
  playlistName: string;
  canEdit: boolean;
  itemIds: string[];
  selectedItemIds: string[];
  assetIdByItemId: (itemId: string) => string | undefined;
  titleByItemId: (itemId: string) => string | undefined;
  selectAll: () => void;
  selectNone: () => void;
  invertSelection: () => void;
  setSelection: (itemIds: string[]) => void;
  removeItems: (itemIds: string[]) => Promise<void>;
  reorder: (orderedItemIds: string[]) => Promise<void>;
  shuffleOrder: () => Promise<void>;
  reload: () => Promise<void>;
  focusFind: () => void;
  /** Playout / menú Lista */
  openCatalogFill?: (kind: "genre" | "artist" | "folder" | "playlist") => void;
  openGenerator?: () => void;
  openTrackList?: () => void;
  syncMetadata?: () => Promise<void>;
  showMissingInVault?: () => void;
  focusLibrary?: () => void;
  createNewTab?: () => Promise<void>;
  insertCommand?: (
    kind: "pause" | "marker" | "note" | "hour_marker" | "dtmf",
    opts?: { pauseSec?: number; label?: string },
  ) => Promise<void>;
  /** Captura snapshot para deshacer antes de una mutación desde el menú. */
  prepareEdit?: () => void;
  /** Vuelca la lista a la cola de cabina y reproduce. */
  playToAir?: (opts?: { replace?: boolean; startIndex?: number }) => Promise<void>;
  isPlayout?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  undo?: () => Promise<void>;
  redo?: () => Promise<void>;
};

type Ctx = {
  editor: PlaylistMenuEditor | null;
  setEditor: (next: PlaylistMenuEditor | null) => void;
};

const PlaylistMenuBridgeContext = createContext<Ctx | null>(null);

export function PlaylistMenuBridgeProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] = useState<PlaylistMenuEditor | null>(null);
  const value = useMemo(() => ({ editor, setEditor }), [editor]);
  return <PlaylistMenuBridgeContext.Provider value={value}>{children}</PlaylistMenuBridgeContext.Provider>;
}

export function usePlaylistMenuBridge(): Ctx {
  const v = useContext(PlaylistMenuBridgeContext);
  if (!v) throw new Error("usePlaylistMenuBridge fuera de PlaylistMenuBridgeProvider");
  return v;
}

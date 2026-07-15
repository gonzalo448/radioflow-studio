import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { apiUrl } from "../lib/api-base";
import { libraryCoverUrl } from "../lib/library-cover-url";
import type { CabBusMeterFrame } from "../station/CabReferencePlayer";
import { useStationAirPlayback } from "../station/StationAirPlaybackContext";
import { formatPauseRemaining, pauseCountdownProgress } from "../station/pause-countdown";
import { useAirAudioMeter } from "../station/useAirAudioMeter";
import { AirQualityBanner } from "../station/AirQualityBanner";
import { formatOnAirLabel } from "../station/on-air-display";
import { useStationLive } from "../station/StationLiveContext";
import type {
  ApiLibraryBrowseLabel,
  ApiLibraryCheckTracksResult,
  ApiLibraryFolderRow,
  ApiPlaylistAddCommandBody,
  ApiPlaylistDetail,
  ApiPlaylistGenerateResult,
  ApiPlaylistReorderBody,
  ApiStationAsset,
} from "@radioflow/shared";
import { DND_LIBRARY_ASSET_MIME, parseLibraryAssetDrag } from "../lib/library-dnd";
import {
  PL_ITEMS_TAB_DND,
  parsePlItemsTabDrag,
  setPlItemsTabDrag,
  type PlItemsTabDragPayload,
} from "../lib/playout-tab-dnd";
import {
  DND_NATIVE_PATHS_MIME,
  isLocalAudioFile,
  notifyStationPlay,
  notifyStationRefresh,
  uploadManyToLibrary,
} from "../lib/local-audio-import";
import {
  filesFromAbsolutePaths,
  isNativeAudioPath,
  isRadioflowDesktop,
  parseNativePathsDrag,
} from "../lib/desktop-native";
import { PlayoutLibraryPicker } from "../components/playout/PlayoutLibraryPicker";
import {
  PlayoutCatalogFillDialog,
  type CatalogFillKind,
} from "../components/playout/PlayoutCatalogFillDialog";
import { TrackListInsertDialog } from "../components/playlist/TrackListInsertDialog";
import { PlaylistGeneratorDialog } from "../components/playlist/PlaylistGeneratorDialog";
import {
  PlaylistTabContextMenu,
  playlistTabContrastColor,
} from "../components/playout/PlaylistTabContextMenu";
import { PlaylistTabNameDialog } from "../components/playout/PlaylistTabNameDialog";
import { usePlaylistMenuBridge } from "../playlist/PlaylistMenuBridgeContext";
import { usePlaylistUndoStack } from "../lib/playlist-undo-stack";
import {
  playlistHasAirContent,
  playlistIndexForQueuePosition,
  queuePositionForPlaylistIndex,
} from "../lib/playlist-queue-index";
import {
  isCommandPlaylistKind,
  queueEntryDurationSec,
  queueEntryKindLabel,
  queueEntryTitle,
} from "../lib/queue-entry-display";

type Pl = { id: string; name: string; tabColor?: string | null };

type TabNameDialogState =
  | { mode: "create" }
  | { mode: "rename"; id: string; name: string };

type TabContextMenuState = {
  id: string;
  name: string;
  tabColor: string | null;
  x: number;
  y: number;
};

const PL_ROW_DND = "application/x-radioflow-pl-row";

/** Campos extra que la API suele incluir al serializar el asset completo. */
type AssetExtra = ApiStationAsset & {
  album?: string | null;
  coverPath?: string | null;
  durationSec?: number | null;
  genre?: string | null;
  mimeType?: string | null;
  semanticNote?: string | null;
  playbackGainDb?: number | null;
  releaseYear?: number | null;
  audioBitrateKbps?: number | null;
  audioSampleRateHz?: number | null;
  audioChannels?: number | null;
};

function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function fmtDur(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Pico lineal suavizado (0–1) → nivel % para VU horizontal de cabina (aprox. dBFS). */
function cabPeak01ToVuLevel(peak01: number): number {
  if (!Number.isFinite(peak01) || peak01 <= 0) return 0;
  const p = Math.min(1, peak01);
  const db = 20 * Math.log10(Math.max(p, 1e-8));
  const floor = -48;
  const ceil = -5;
  const t = (db - floor) / (ceil - floor);
  return Math.max(0, Math.min(100, Math.round(t * 100)));
}

export function StationPage() {
  const location = useLocation();
  const { token, user } = useAuth();
  const { state, loadError, refresh } = useStationLive();
  const {
    dockMuted,
    setDockMuted,
    airPlayback,
    useCabEngine: globalUseCabEngine,
    play: playAir,
    pause: pauseAir,
    getLeadAudio,
    airAudioRef,
    subscribeMeterFrame,
    pauseForPreview,
    onAirDisplay,
    pauseCountdown,
    listenThroughActive,
    monitorMode,
    setMonitorMode,
    listenThroughAvailable,
  } = useStationAirPlayback();
  const [playlists, setPlaylists] = useState<Pl[]>([]);
  const [plPick, setPlPick] = useState("");
  const [activePlDetail, setActivePlDetail] = useState<ApiPlaylistDetail | null>(null);
  const [plBusy, setPlBusy] = useState(false);
  const [catalogFillKind, setCatalogFillKind] = useState<CatalogFillKind | null>(null);
  const [trackListOpen, setTrackListOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [tabNameDialog, setTabNameDialog] = useState<TabNameDialogState | null>(null);
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null);
  const [tabActionBusy, setTabActionBusy] = useState(false);
  const [libraryGenres, setLibraryGenres] = useState<string[]>([]);
  const [libraryArtists, setLibraryArtists] = useState<ApiLibraryBrowseLabel[]>([]);
  const [libraryFolders, setLibraryFolders] = useState<ApiLibraryFolderRow[]>([]);
  const [listFilter, setListFilter] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [selectedPlItemIds, setSelectedPlItemIds] = useState<string[]>([]);
  const [tabDropPlId, setTabDropPlId] = useState<string | null>(null);
  const [plDragIdx, setPlDragIdx] = useState<number | null>(null);
  const [plDropHoverIdx, setPlDropHoverIdx] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** Fila seleccionada en la tabla: metadatos y audio de vista previa (null = pista al aire). */
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  /** Si la imagen de carátula falla al cargar, mostrar inicial. */
  const [coverLoadFailed, setCoverLoadFailed] = useState(false);
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  const queueRegionRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const libraryPanelRef = useRef<HTMLElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const rbVuPeakLRef = useRef<HTMLDivElement | null>(null);
  const rbVuPeakRRef = useRef<HTMLDivElement | null>(null);
  const [cabinaClock, setCabinaClock] = useState(() => new Date());
  const [queueDropActive, setQueueDropActive] = useState(false);

  const canEditPlaylist = user?.role === "admin" || user?.role === "editor";
  const canOperate = Boolean(token);

  const { setEditor } = usePlaylistMenuBridge();
  const undoStack = usePlaylistUndoStack(plPick, token);
  const activePlRef = useRef<ApiPlaylistDetail | null>(null);

  useEffect(() => {
    apiFetch<{ genres: string[] }>("/api/library/genres")
      .then((r) => setLibraryGenres(r.genres))
      .catch(() => setLibraryGenres([]));
    apiFetch<{ pathFolders: ApiLibraryFolderRow[]; artists: ApiLibraryBrowseLabel[] }>("/api/library/browse")
      .then((r) => {
        setLibraryArtists(r.artists);
        setLibraryFolders(r.pathFolders);
      })
      .catch(() => {
        setLibraryArtists([]);
        setLibraryFolders([]);
      });
  }, []);

  useEffect(() => {
    const pl = new URLSearchParams(location.search).get("pl");
    if (pl) setPlPick(pl);
  }, [location.search]);

  const reloadPlaylists = useCallback(async () => {
    try {
      const rows = await apiFetch<Pl[]>("/api/playlists");
      setPlaylists(rows);
      return rows;
    } catch {
      setPlaylists([]);
      return [] as Pl[];
    }
  }, []);

  useEffect(() => {
    void reloadPlaylists().then((rows) => {
      if (rows.length > 0 && !plPick) setPlPick(rows[0].id);
    });
  }, [plPick, reloadPlaylists]);

  const loadActivePlaylist = useCallback(async (id: string) => {
    if (!id) {
      setActivePlDetail(null);
      return;
    }
    try {
      const d = await apiFetch<ApiPlaylistDetail>(`/api/playlists/${encodeURIComponent(id)}`);
      setActivePlDetail(d);
    } catch {
      setActivePlDetail(null);
    }
  }, []);

  useEffect(() => {
    if (!plPick) return;
    void loadActivePlaylist(plPick);
    setSelectedPlItemIds([]);
  }, [loadActivePlaylist, plPick]);

  const plItems = activePlDetail?.items ?? [];
  const filterQ = listFilter.trim().toLowerCase();
  const visiblePlRows = useMemo(() => {
    if (!filterQ) return plItems.map((row, idx) => ({ row, idx }));
    return plItems
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => {
        if (isCommandPlaylistKind(row.kind)) {
          const hay = `${row.label ?? ""} ${row.kind} ${queueEntryKindLabel(row.kind)}`.toLowerCase();
          return hay.includes(filterQ);
        }
        if (!row.asset) return false;
        const a = row.asset as AssetExtra;
        const hay = `${a.title} ${a.artist ?? ""} ${a.genre ?? ""} ${a.path}`.toLowerCase();
        return hay.includes(filterQ);
      });
  }, [filterQ, plItems]);

  const curPos = state?.station.currentPosition ?? 0;
  const queue = state?.queue ?? [];
  const onAirPlIdx = useMemo(() => playlistIndexForQueuePosition(plItems, curPos), [plItems, curPos]);
  const airForCover = state
    ? (state.nowPlaying ??
      (queue[curPos]?.kind === "track" || queue[curPos]?.kind === "voicetrack" ? queue[curPos]?.asset : null) ??
      null)
    : null;
  const previewForCover =
    state && selectedRowIdx !== null && plItems[selectedRowIdx] && !isCommandPlaylistKind(plItems[selectedRowIdx].kind)
      ? plItems[selectedRowIdx].asset
      : null;
  const coverAsset = (previewForCover ?? airForCover) as AssetExtra | null;
  const coverResetKey = coverAsset ? `${coverAsset.id}:${coverAsset.coverPath ?? ""}` : "";

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [curPos, state?.queue.length]);

  useEffect(() => {
    if (state && selectedRowIdx !== null && selectedRowIdx >= plItems.length) {
      setSelectedRowIdx(null);
    }
  }, [state, selectedRowIdx, plItems.length]);

  useEffect(() => {
    setCoverLoadFailed(false);
  }, [coverResetKey]);

  useEffect(() => {
    const id = window.setInterval(() => setCabinaClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (selectedRowIdx !== null) pauseForPreview();
  }, [selectedRowIdx, pauseForPreview]);

  const dockAssetIdForMuteReset =
    state && selectedRowIdx !== null && plItems[selectedRowIdx] && !isCommandPlaylistKind(plItems[selectedRowIdx].kind)
      ? plItems[selectedRowIdx].asset?.id
      : state
        ? (state.nowPlaying?.id ??
          (queue[curPos]?.kind === "track" || queue[curPos]?.kind === "voicetrack"
            ? queue[curPos]?.asset?.id
            : undefined))
        : undefined;

  useEffect(() => {
    setDockMuted(false);
  }, [dockAssetIdForMuteReset]);

  const addAssetsToActivePlaylist = useCallback(
    async (assetIds: string[]) => {
      if (!token || !plPick || assetIds.length === 0 || !canEditPlaylist) return;
      setPlBusy(true);
      try {
        await apiFetch(`/api/playlists/${encodeURIComponent(plPick)}/items/batch`, {
          method: "POST",
          token,
          body: JSON.stringify({ assetIds }),
        });
        await loadActivePlaylist(plPick);
        setMsg(`${assetIds.length} pista(s) añadida(s) a «${activePlDetail?.name ?? "lista"}».`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo añadir a la lista");
      } finally {
        setPlBusy(false);
      }
    },
    [activePlDetail?.name, canEditPlaylist, loadActivePlaylist, plPick, token],
  );

  const playPlaylistFromIndex = useCallback(
    async (index: number) => {
      if (!token || !plPick || !activePlDetail?.items.length) return;
      if (!playlistHasAirContent(activePlDetail.items)) {
        setMsg(
          "Esta lista no tiene pistas ni listas de pistas para poner al aire. Agregue canciones o use «Agregar lista de pistas…».",
        );
        return;
      }
      setSelectedRowIdx(null);
      setPlBusy(true);
      try {
        await apiFetch("/api/station/queue-from-playlist", {
          method: "POST",
          token,
          body: JSON.stringify({ playlistId: plPick, replace: true }),
        });
        if (index > 0) {
          const qPos = queuePositionForPlaylistIndex(activePlDetail.items, index);
          await apiFetch("/api/station", {
            method: "PATCH",
            token,
            body: JSON.stringify({ currentPosition: qPos }),
          });
        }
        notifyStationRefresh();
        await refresh();
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await playAir();
        notifyStationPlay();
        setMsg(`Al aire: «${activePlDetail.name}». Use Pausar/Siguiente abajo.`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo iniciar la reproducción");
      } finally {
        setPlBusy(false);
      }
    },
    [activePlDetail, plPick, playAir, refresh, token],
  );

  const createPlaylistTab = useCallback(async () => {
    if (!token || !canEditPlaylist) return;
    setTabNameDialog({ mode: "create" });
  }, [canEditPlaylist, token]);

  const submitTabNameDialog = useCallback(
    async (name: string) => {
      if (!token || !canEditPlaylist || !tabNameDialog) return;
      setTabActionBusy(true);
      try {
        if (tabNameDialog.mode === "create") {
          const pl = await apiFetch<{ id: string; name: string }>("/api/playlists", {
            method: "POST",
            token,
            body: JSON.stringify({ name }),
          });
          await reloadPlaylists();
          setPlPick(pl.id);
          setSelectedRowIdx(null);
          setSelectedPlItemIds([]);
          setMsg(`Lista «${pl.name}» creada.`);
        } else {
          if (name === tabNameDialog.name) {
            setTabNameDialog(null);
            return;
          }
          await apiFetch(`/api/playlists/${encodeURIComponent(tabNameDialog.id)}`, {
            method: "PATCH",
            token,
            body: JSON.stringify({ name }),
          });
          await reloadPlaylists();
          if (plPick === tabNameDialog.id) await loadActivePlaylist(tabNameDialog.id);
        }
        setTabNameDialog(null);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo guardar el nombre");
      } finally {
        setTabActionBusy(false);
      }
    },
    [canEditPlaylist, loadActivePlaylist, plPick, reloadPlaylists, tabNameDialog, token],
  );

  const renamePlaylistTab = useCallback(
    (id: string, currentName: string) => {
      if (!token || !canEditPlaylist) return;
      setTabNameDialog({ mode: "rename", id, name: currentName });
    },
    [canEditPlaylist, token],
  );

  const deletePlaylistTab = useCallback(
    async (id: string, name: string) => {
      if (!token || !canEditPlaylist) return;
      if (!window.confirm(`¿Suprimir la lista «${name}»? Esta acción no se puede deshacer.`)) return;
      setTabActionBusy(true);
      try {
        await apiFetch(`/api/playlists/${encodeURIComponent(id)}`, { method: "DELETE", token });
        const rows = await reloadPlaylists();
        if (plPick === id) {
          setPlPick(rows[0]?.id ?? "");
          setActivePlDetail(null);
          setSelectedRowIdx(null);
          setSelectedPlItemIds([]);
        }
        setMsg(`Lista «${name}» eliminada.`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo eliminar la lista");
      } finally {
        setTabActionBusy(false);
      }
    },
    [canEditPlaylist, plPick, reloadPlaylists, token],
  );

  const setPlaylistTabColor = useCallback(
    async (id: string, tabColor: string | null) => {
      if (!token || !canEditPlaylist) return;
      try {
        await apiFetch(`/api/playlists/${encodeURIComponent(id)}`, {
          method: "PATCH",
          token,
          body: JSON.stringify({ tabColor }),
        });
        setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, tabColor } : p)));
        if (plPick === id) {
          setActivePlDetail((cur) => (cur ? { ...cur, tabColor } : cur));
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo cambiar el color");
      }
    },
    [canEditPlaylist, plPick, token],
  );

  const reorderPlItems = useCallback(
    async (orderedItemIds: string[]) => {
      if (!token || !plPick || !canEditPlaylist) return;
      undoStack.beforeMutation(activePlRef.current);
      setPlBusy(true);
      try {
        const body: ApiPlaylistReorderBody = { orderedItemIds };
        const updated = await apiFetch<ApiPlaylistDetail>(
          `/api/playlists/${encodeURIComponent(plPick)}/items/reorder`,
          { method: "PUT", token, body: JSON.stringify(body) },
        );
        setActivePlDetail(updated);
        setSelectedRowIdx((cur) => {
          if (cur == null) return cur;
          const itemId = activePlDetail?.items[cur]?.id;
          if (!itemId) return cur;
          const next = orderedItemIds.indexOf(itemId);
          return next >= 0 ? next : null;
        });
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo reordenar la lista");
      } finally {
        setPlBusy(false);
      }
    },
    [activePlDetail?.items, canEditPlaylist, plPick, token, undoStack],
  );

  const movePlItem = useCallback(
    (idx: number, dir: -1 | 1) => {
      if (!activePlDetail || idx + dir < 0 || idx + dir >= activePlDetail.items.length) return;
      const order = activePlDetail.items.map((i) => i.id);
      const t = order[idx];
      order[idx] = order[idx + dir];
      order[idx + dir] = t;
      void reorderPlItems(order);
      setSelectedRowIdx(idx + dir);
    },
    [activePlDetail, reorderPlItems],
  );

  const onPlRowDragStart = useCallback(
    (e: React.DragEvent, idx: number) => {
      if (!canEditPlaylist || !activePlDetail || !plPick) return;
      e.dataTransfer.setData(PL_ROW_DND, String(idx));
      const row = activePlDetail.items[idx];
      if (!row) return;
      const itemIds =
        selectedPlItemIds.includes(row.id) && selectedPlItemIds.length > 0
          ? activePlDetail.items.filter((i) => selectedPlItemIds.includes(i.id)).map((i) => i.id)
          : [row.id];
      setPlItemsTabDrag(e, { sourcePlaylistId: plPick, itemIds });
      e.dataTransfer.effectAllowed = "copyMove";
      setPlDragIdx(idx);
    },
    [activePlDetail, canEditPlaylist, plPick, selectedPlItemIds],
  );

  const onPlRowDragOver = useCallback((e: React.DragEvent, idx: number) => {
    if (e.dataTransfer.types.includes(PL_ITEMS_TAB_DND)) return;
    if (!e.dataTransfer.types.includes(PL_ROW_DND)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setPlDropHoverIdx(idx);
  }, []);

  const onPlRowDrop = useCallback(
    (e: React.DragEvent, dropIdx: number) => {
      if (e.dataTransfer.types.includes(PL_ITEMS_TAB_DND)) return;
      if (!e.dataTransfer.types.includes(PL_ROW_DND)) return;
      e.preventDefault();
      e.stopPropagation();
      const fromRaw = e.dataTransfer.getData(PL_ROW_DND);
      const fromIdx = Number.parseInt(fromRaw, 10);
      setPlDragIdx(null);
      setPlDropHoverIdx(null);
      if (!Number.isFinite(fromIdx) || fromIdx === dropIdx || !activePlDetail) return;
      const order = activePlDetail.items.map((i) => i.id);
      const [moved] = order.splice(fromIdx, 1);
      order.splice(dropIdx, 0, moved);
      void reorderPlItems(order);
      if (selectedRowIdx === fromIdx) setSelectedRowIdx(dropIdx);
      else if (selectedRowIdx != null && fromIdx < selectedRowIdx && dropIdx >= selectedRowIdx) {
        setSelectedRowIdx(selectedRowIdx - 1);
      } else if (selectedRowIdx != null && fromIdx > selectedRowIdx && dropIdx <= selectedRowIdx) {
        setSelectedRowIdx(selectedRowIdx + 1);
      }
    },
    [activePlDetail, reorderPlItems, selectedRowIdx],
  );

  const transferItemsToTab = useCallback(
    async (targetPlId: string, payload: PlItemsTabDragPayload, copy: boolean) => {
      if (!token || !canEditPlaylist || targetPlId === payload.sourcePlaylistId) return;
      setPlBusy(true);
      try {
        const updated = await apiFetch<ApiPlaylistDetail>(
          `/api/playlists/${encodeURIComponent(targetPlId)}/items/transfer`,
          {
            method: "POST",
            token,
            body: JSON.stringify({
              sourcePlaylistId: payload.sourcePlaylistId,
              itemIds: payload.itemIds,
              mode: copy ? "copy" : "move",
            }),
          },
        );
        await reloadPlaylists();
        if (payload.sourcePlaylistId === plPick) await loadActivePlaylist(plPick);
        setPlPick(targetPlId);
        setActivePlDetail(updated);
        setSelectedRowIdx(null);
        setSelectedPlItemIds([]);
        setMsg(
          `${payload.itemIds.length} pista(s) ${copy ? "copiada(s)" : "movida(s)"} a «${updated.name}».`,
        );
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo transferir entre listas");
      } finally {
        setPlBusy(false);
      }
    },
    [canEditPlaylist, loadActivePlaylist, plPick, reloadPlaylists, token],
  );

  const onTabDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    if (!e.dataTransfer.types.includes(PL_ITEMS_TAB_DND)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.shiftKey ? "copy" : "move";
    setTabDropPlId(tabId);
  }, []);

  const onTabDrop = useCallback(
    (e: React.DragEvent, tabId: string) => {
      e.preventDefault();
      setTabDropPlId(null);
      const payload = parsePlItemsTabDrag(e);
      if (payload) void transferItemsToTab(tabId, payload, e.shiftKey);
    },
    [transferItemsToTab],
  );

  const onCatalogFillConfirm = useCallback(
    async (opts: {
      kind: CatalogFillKind;
      mode: "fill" | "new" | "append";
      value: string;
      renameTab: boolean;
    }) => {
      if (!token || !canEditPlaylist) return;
      const { kind, mode, value, renameTab } = opts;
      setPlBusy(true);
      try {
        if (kind === "playlist") {
          if (mode === "new") {
            setPlPick(value);
            setSelectedRowIdx(null);
            setSelectedPlItemIds([]);
            await loadActivePlaylist(value);
            setCatalogFillKind(null);
            setMsg("Lista origen abierta en pestaña.");
            return;
          }
          if (!plPick) {
            setMsg("Seleccione una pestaña destino.");
            return;
          }
          if (
            mode === "fill" &&
            activePlDetail &&
            activePlDetail.items.length > 0 &&
            !window.confirm(
              `¿Reemplazar las ${activePlDetail.items.length} pista(s) de «${activePlDetail.name}» con la otra lista?`,
            )
          ) {
            return;
          }
          const updated = await apiFetch<ApiPlaylistDetail>(
            `/api/playlists/${encodeURIComponent(plPick)}/merge-from-playlist`,
            {
              method: "POST",
              token,
              body: JSON.stringify({ sourcePlaylistId: value, replace: mode === "fill" }),
            },
          );
          setActivePlDetail(updated);
          await reloadPlaylists();
          setSelectedRowIdx(null);
          setSelectedPlItemIds([]);
          setCatalogFillKind(null);
          setMsg(
            mode === "fill"
              ? `Lista reemplazada con ${updated.items.length} pista(s).`
              : `Añadidas pistas — ${updated.items.length} en total.`,
          );
          return;
        }

        const label =
          kind === "genre"
            ? value
            : kind === "artist"
              ? value === "__none__"
                ? "Sin artista"
                : value
              : (value.split("/").filter(Boolean).pop() ?? value);

        if (mode === "fill" && plPick) {
          if (
            activePlDetail &&
            activePlDetail.items.length > 0 &&
            !window.confirm(
              `¿Reemplazar las ${activePlDetail.items.length} pista(s) de «${activePlDetail.name}» por «${label}»?`,
            )
          ) {
            return;
          }
          const path =
            kind === "genre" ? "fill-from-genre" : kind === "artist" ? "fill-from-artist" : "fill-from-folder";
          const body =
            kind === "genre"
              ? { genre: value, renameToGenre: renameTab }
              : kind === "artist"
                ? { artist: value, renameToArtist: renameTab }
                : { pathPrefix: value, renameToFolder: renameTab };
          const updated = await apiFetch<ApiPlaylistDetail>(
            `/api/playlists/${encodeURIComponent(plPick)}/${path}`,
            { method: "POST", token, body: JSON.stringify(body) },
          );
          setActivePlDetail(updated);
          await reloadPlaylists();
          setSelectedRowIdx(null);
          setSelectedPlItemIds([]);
          setCatalogFillKind(null);
          setMsg(`Lista actualizada con ${updated.items.length} pista(s) de «${label}».`);
          return;
        }

        if (kind === "genre") {
          const detail = await apiFetch<ApiPlaylistDetail>("/api/playlists/from-genre", {
            method: "POST",
            token,
            body: JSON.stringify({
              genre: value,
              name: renameTab ? label : `Género: ${label}`,
            }),
          });
          await reloadPlaylists();
          setPlPick(detail.id);
          setActivePlDetail(detail);
          setSelectedRowIdx(null);
          setSelectedPlItemIds([]);
          setCatalogFillKind(null);
          setMsg(`Pestaña nueva con ${detail.items.length} pista(s) de «${label}».`);
          return;
        }

        const tabName = renameTab ? label : kind === "artist" ? `Artista: ${label}` : `Carpeta: ${label}`;
        const pl = await apiFetch<{ id: string; name: string }>("/api/playlists", {
          method: "POST",
          token,
          body: JSON.stringify({ name: tabName }),
        });
        const fillPath = kind === "artist" ? "fill-from-artist" : "fill-from-folder";
        const fillBody =
          kind === "artist"
            ? { artist: value, renameToArtist: false }
            : { pathPrefix: value, renameToFolder: false };
        const updated = await apiFetch<ApiPlaylistDetail>(
          `/api/playlists/${encodeURIComponent(pl.id)}/${fillPath}`,
          { method: "POST", token, body: JSON.stringify(fillBody) },
        );
        await reloadPlaylists();
        setPlPick(pl.id);
        setActivePlDetail(updated);
        setSelectedRowIdx(null);
        setSelectedPlItemIds([]);
        setCatalogFillKind(null);
        setMsg(`Pestaña «${updated.name}» con ${updated.items.length} pista(s).`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo completar la operación");
      } finally {
        setPlBusy(false);
      }
    },
    [activePlDetail, canEditPlaylist, loadActivePlaylist, plPick, reloadPlaylists, token],
  );

  const enqueueFromLibraryDrag = useCallback(
    async (assetIds: string[]) => {
      if (!token || assetIds.length === 0) return;
      if (plPick && canEditPlaylist) {
        await addAssetsToActivePlaylist(assetIds);
        return;
      }
      try {
        for (const assetId of assetIds) {
          await apiFetch("/api/station/queue", {
            method: "POST",
            token,
            body: JSON.stringify({ assetId }),
          });
        }
        setMsg(
          assetIds.length === 1
            ? "Pista añadida desde la librería"
            : `${assetIds.length} pistas añadidas desde la librería`,
        );
        notifyStationRefresh();
        await refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo encolar desde la librería");
      }
    },
    [addAssetsToActivePlaylist, canEditPlaylist, plPick, token, refresh],
  );

  const importFilesToActivePlaylist = useCallback(
    async (files: File[]) => {
      if (!token || !plPick || files.length === 0 || !canEditPlaylist) return;
      setPlBusy(true);
      try {
        const ids = await uploadManyToLibrary(token, files);
        await apiFetch(`/api/playlists/${encodeURIComponent(plPick)}/items/batch`, {
          method: "POST",
          token,
          body: JSON.stringify({ assetIds: ids }),
        });
        await loadActivePlaylist(plPick);
        setMsg(`${ids.length} archivo(s) importados a la lista abierta.`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo importar a la lista");
      } finally {
        setPlBusy(false);
      }
    },
    [canEditPlaylist, loadActivePlaylist, plPick, token],
  );

  const onQueueDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!token) return;
      const types = [...e.dataTransfer.types];
      if (types.includes(PL_ROW_DND) || types.includes(PL_ITEMS_TAB_DND)) return;
      const accept =
        types.includes(DND_LIBRARY_ASSET_MIME) ||
        types.includes(DND_NATIVE_PATHS_MIME) ||
        types.includes("text/plain") ||
        types.includes("Files");
      if (!accept) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setQueueDropActive(true);
    },
    [token],
  );

  const onQueueDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setQueueDropActive(false);
      const ids = parseLibraryAssetDrag(e);
      if (ids?.length) {
        void enqueueFromLibraryDrag(ids);
        return;
      }
      if (!canEditPlaylist || !plPick || plBusy) return;
      void (async () => {
        const fromOs = Array.from(e.dataTransfer.files).filter((f) => isLocalAudioFile(f));
        if (fromOs.length > 0) {
          await importFilesToActivePlaylist(fromOs);
          return;
        }
        const nativePaths = parseNativePathsDrag(e)?.filter((p) => isNativeAudioPath(p));
        if (nativePaths?.length && isRadioflowDesktop()) {
          const files = await filesFromAbsolutePaths(nativePaths);
          const audio = files.filter((f) => isLocalAudioFile(f));
          if (audio.length > 0) await importFilesToActivePlaylist(audio);
        }
      })();
    },
    [canEditPlaylist, enqueueFromLibraryDrag, importFilesToActivePlaylist, plBusy, plPick],
  );

  const skip = useCallback(async () => {
    if (!token) {
      setMsg("Inicia sesión para avanzar la cola");
      return;
    }
    try {
      await apiFetch("/api/station/skip", { method: "POST", token });
      setMsg(null);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }, [token, refresh]);

  const onCabBusMeterFrame = useCallback((s: CabBusMeterFrame) => {
    const levelL = cabPeak01ToVuLevel(s.peak01L ?? s.peak01);
    const levelR = cabPeak01ToVuLevel(s.peak01R ?? s.peak01);
    const elL = rbVuPeakLRef.current;
    const elR = rbVuPeakRRef.current;
    if (elL) elL.style.width = `${levelL}%`;
    if (elR) elR.style.width = `${levelR}%`;
  }, []);

  useEffect(() => subscribeMeterFrame(onCabBusMeterFrame), [subscribeMeterFrame, onCabBusMeterFrame]);

  const queueForVu = state?.queue ?? [];
  const curPosForVu = state?.station.currentPosition ?? 0;
  const airForVu = state
    ? ((state.nowPlaying ??
        (queueForVu[curPosForVu]?.kind === "track" || queueForVu[curPosForVu]?.kind === "voicetrack"
          ? queueForVu[curPosForVu]?.asset
          : null)) as
        | AssetExtra
        | null
        | undefined)
    : null;
  const vuDrivenByCabEngine = Boolean(state && selectedRowIdx === null && airForVu && globalUseCabEngine);

  const dockAssetForMeter: AssetExtra | null =
    state && selectedRowIdx !== null && plItems[selectedRowIdx] && !isCommandPlaylistKind(plItems[selectedRowIdx].kind)
      ? (plItems[selectedRowIdx].asset as AssetExtra)
      : (airForVu ?? null);

  const vuNativeMeter = Boolean(
    state && dockAssetForMeter && (selectedRowIdx !== null || state.station.cabWebAudioEngine === false),
  );

  useAirAudioMeter(
    selectedRowIdx !== null ? previewAudioRef : airAudioRef,
    vuNativeMeter,
    dockMuted,
    `${dockAssetForMeter?.id ?? "none"}-${selectedRowIdx ?? "air"}`,
    onCabBusMeterFrame,
  );

  useEffect(() => {
    if (vuDrivenByCabEngine || vuNativeMeter) return;
    const z = (el: HTMLDivElement | null) => {
      if (el) el.style.height = "0%";
    };
    z(rbVuPeakLRef.current);
    z(rbVuPeakRRef.current);
  }, [vuDrivenByCabEngine, vuNativeMeter]);

  useEffect(() => {
    const onCabina = location.pathname === "/station" || location.pathname.endsWith("/station");
    if (!onCabina) return;

    const handler = (e: KeyboardEvent) => {
      if (loadError || !state) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (selectedRowIdx !== null) {
          const a = previewAudioRef.current;
          if (!a) return;
          if (a.paused) void a.play().catch(() => {});
          else a.pause();
          return;
        }
        const lead = getLeadAudio();
        if (!lead || lead.paused) void playAir().catch(() => {});
        else pauseAir();
        return;
      }

      if (e.code === "MediaTrackNext" || (e.ctrlKey && e.key === "ArrowRight")) {
        e.preventDefault();
        if (!token) return;
        void skip();
      }

      if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setDockMuted((m) => !m);
        return;
      }

      if (e.code === "KeyG" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        queueRegionRef.current?.focus({ preventScroll: true });
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loadError, state, location.pathname, token, selectedRowIdx, skip, playAir, pauseAir, getLeadAudio]);

  const removeManyPlItems = useCallback(
    async (itemIds: string[]) => {
      if (!token || !plPick || !canEditPlaylist || itemIds.length === 0) return;
      undoStack.beforeMutation(activePlRef.current);
      setPlBusy(true);
      try {
        for (const itemId of itemIds) {
          await apiFetch(`/api/playlists/${encodeURIComponent(plPick)}/items/${encodeURIComponent(itemId)}`, {
            method: "DELETE",
            token,
          });
        }
        setSelectedPlItemIds([]);
        setSelectedRowIdx(null);
        await loadActivePlaylist(plPick);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al quitar pistas");
      } finally {
        setPlBusy(false);
      }
    },
    [canEditPlaylist, loadActivePlaylist, plPick, token, undoStack],
  );

  const shufflePlOrder = useCallback(async () => {
    if (!activePlDetail || activePlDetail.items.length < 2) return;
    undoStack.beforeMutation(activePlRef.current);
    const order = activePlDetail.items.map((i) => i.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    await reorderPlItems(order);
  }, [activePlDetail, reorderPlItems, undoStack]);

  const syncPlMetadata = useCallback(async () => {
    if (!token || !activePlDetail || activePlDetail.items.length === 0) return;
    const assetIds = [
      ...new Set(
        activePlDetail.items.filter((i) => !isCommandPlaylistKind(i.kind) && i.asset).map((i) => i.asset!.id),
      ),
    ].slice(0, 200);
    setPlBusy(true);
    try {
      const result = await apiFetch<{ updated: number; failures: { id: string; error: string }[] }>(
        "/api/library/sync-metadata-bulk",
        { method: "POST", token, body: JSON.stringify({ assetIds }) },
      );
      if (plPick) await loadActivePlaylist(plPick);
      setMsg(
        `Metadatos recargados: ${result.updated} pista(s)${result.failures.length ? ` · ${result.failures.length} error(es)` : ""}.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudieron recargar metadatos");
    } finally {
      setPlBusy(false);
    }
  }, [activePlDetail, loadActivePlaylist, plPick, token]);

  const showMissingPlFiles = useCallback(async () => {
    if (!token || !activePlDetail) return;
    const assetIds = activePlDetail.items
      .filter((i) => !isCommandPlaylistKind(i.kind) && i.asset)
      .map((i) => i.asset!.id);
    if (assetIds.length === 0) {
      window.alert("La lista está vacía.");
      return;
    }
    try {
      const result = await apiFetch<ApiLibraryCheckTracksResult>("/api/library/check-tracks", {
        method: "POST",
        token,
        body: JSON.stringify({
          assetIds,
          compareTitles: false,
          compareArtists: false,
          compareAlbums: false,
        }),
      });
      const missing = result.issues.filter((i) => i.issues.includes("missing_file"));
      if (missing.length === 0) {
        window.alert("Todas las pistas de la lista existen en la bóveda.");
        return;
      }
      const lines = missing.slice(0, 40).map((m) => `· ${m.title} — ${m.path}`);
      window.alert(
        `Archivos inexistentes (${missing.length}):\n\n${lines.join("\n")}${missing.length > 40 ? "\n…" : ""}`,
      );
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo comprobar archivos");
    }
  }, [activePlDetail, token]);

  const insertPlCommand = useCallback(
    async (kind: ApiPlaylistAddCommandBody["kind"], opts?: { pauseSec?: number; label?: string }) => {
      if (!token || !plPick || !canEditPlaylist) return;
      undoStack.beforeMutation(activePlRef.current);
      const insertAfterItemId =
        selectedPlItemIds.length > 0 ? selectedPlItemIds[selectedPlItemIds.length - 1]! : null;
      setPlBusy(true);
      try {
        const updated = await apiFetch<ApiPlaylistDetail>(
          `/api/playlists/${encodeURIComponent(plPick)}/items/command`,
          {
            method: "POST",
            token,
            body: JSON.stringify({
              kind,
              pauseSec: opts?.pauseSec,
              label: opts?.label,
              insertAfterItemId,
            }),
          },
        );
        setActivePlDetail(updated);
        setMsg(`Comando insertado en «${activePlDetail?.name ?? "lista"}».`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo insertar el comando");
      } finally {
        setPlBusy(false);
      }
    },
    [activePlDetail?.name, canEditPlaylist, plPick, selectedPlItemIds, token, undoStack],
  );

  const selectedPlKey = selectedPlItemIds.join(",");
  activePlRef.current = activePlDetail;

  useEffect(() => {
    if (!activePlDetail || !plPick) {
      setEditor(null);
      return;
    }
    const editable = !!(canEditPlaylist && token);
    setEditor({
      playlistId: plPick,
      playlistName: activePlDetail.name,
      canEdit: editable,
      isPlayout: true,
      itemIds: activePlDetail.items.map((i) => i.id),
      selectedItemIds: [...selectedPlItemIds],
      assetIdByItemId: (itemId) => {
        const item = activePlDetail.items.find((i) => i.id === itemId);
        return item?.kind === "track" || item?.kind === "voicetrack" ? item.asset?.id : undefined;
      },
      titleByItemId: (itemId) => {
        const item = activePlDetail.items.find((i) => i.id === itemId);
        if (!item) return undefined;
        if (isCommandPlaylistKind(item.kind) || !item.asset) return queueEntryTitle(item);
        const a = item.asset;
        return [a.artist, a.title].filter(Boolean).join(" · ") || a.title;
      },
      selectAll: () => setSelectedPlItemIds(activePlDetail.items.map((i) => i.id)),
      selectNone: () => {
        setSelectedPlItemIds([]);
        setSelectedRowIdx(null);
      },
      invertSelection: () => {
        const all = activePlDetail.items.map((i) => i.id);
        setSelectedPlItemIds((prev) => {
          const set = new Set(prev);
          return all.filter((id) => !set.has(id));
        });
      },
      setSelection: (ids) => setSelectedPlItemIds(ids),
      removeItems: (itemIds) => removeManyPlItems(itemIds),
      reorder: (ordered) => reorderPlItems(ordered),
      shuffleOrder: shufflePlOrder,
      reload: () => loadActivePlaylist(plPick),
      focusFind: () => {
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.focus(), 0);
      },
      openCatalogFill: (kind) => setCatalogFillKind(kind),
      openGenerator: () => setGeneratorOpen(true),
      openTrackList: () => setTrackListOpen(true),
      syncMetadata: syncPlMetadata,
      showMissingInVault: () => void showMissingPlFiles(),
      focusLibrary: () => libraryPanelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      createNewTab: createPlaylistTab,
      insertCommand: insertPlCommand,
      prepareEdit: () => undoStack.beforeMutation(activePlRef.current),
      playToAir: async (opts) => {
        await playPlaylistFromIndex(opts?.startIndex ?? selectedRowIdx ?? 0);
      },
      canUndo: undoStack.canUndo,
      canRedo: undoStack.canRedo,
      undo: () => undoStack.undo(activePlRef.current, () => loadActivePlaylist(plPick)),
      redo: () => undoStack.redo(activePlRef.current, () => loadActivePlaylist(plPick)),
    });
    return () => setEditor(null);
  }, [
    activePlDetail,
    canEditPlaylist,
    createPlaylistTab,
    insertPlCommand,
    loadActivePlaylist,
    playPlaylistFromIndex,
    plPick,
    removeManyPlItems,
    reorderPlItems,
    selectedPlKey,
    selectedRowIdx,
    setEditor,
    shufflePlOrder,
    showMissingPlFiles,
    syncPlMetadata,
    token,
    undoStack,
  ]);

  async function removePlaylistItem(itemId: string) {
    if (!token || !plPick || !canEditPlaylist) {
      setMsg("Inicia sesión como editor para quitar ítems");
      return;
    }
    try {
      await apiFetch(`/api/playlists/${encodeURIComponent(plPick)}/items/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
        token,
      });
      setMsg(null);
      await loadActivePlaylist(plPick);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  if (loadError) {
    return (
      <section className="rb-cabin rb-cabin--error">
        <p className="error">{loadError}</p>
        <button type="button" className="btn" onClick={() => void refresh()}>
          Reintentar
        </button>
      </section>
    );
  }
  if (!state) return <p className="rb-cabin-loading muted">Cargando estación…</p>;

  const airAsset = (onAirDisplay.onAir as AssetExtra | null) ?? null;
  const dockAsset =
    selectedRowIdx !== null && plItems[selectedRowIdx] && !isCommandPlaylistKind(plItems[selectedRowIdx].kind)
      ? (plItems[selectedRowIdx].asset as AssetExtra)
      : airAsset;
  const dockIsPreview = selectedRowIdx !== null;

  const heroTitle =
    onAirDisplay.commandEntry
      ? queueEntryTitle(onAirDisplay.commandEntry)
      : airAsset?.title?.trim() || "— Sin pista en emisión —";
  const heroArtist =
    onAirDisplay.commandEntry
      ? queueEntryKindLabel(onAirDisplay.commandEntry.kind)
      : state?.queue[curPos]?.kind === "voicetrack"
        ? "Voicetrack"
        : airAsset?.artist?.trim() || "";
  const prevCardText = formatOnAirLabel(onAirDisplay.prev);
  const nextCardText = onAirDisplay.nextRow
    ? queueEntryTitle(onAirDisplay.nextRow)
    : "—";

  const pauseActive = Boolean(pauseCountdown && onAirDisplay.commandEntry?.kind === "pause");

  const effAirDuration =
    !dockIsPreview && airAsset
      ? airPlayback.duration > 0
        ? airPlayback.duration
        : airAsset.durationSec && airAsset.durationSec > 0
          ? airAsset.durationSec
          : 0
      : 0;
  const thisRemainSec =
    !dockIsPreview && effAirDuration > 0 ? Math.max(0, effAirDuration - airPlayback.current) : null;

  const airProgPct = pauseActive && pauseCountdown
    ? pauseCountdownProgress(pauseCountdown)
    : !dockIsPreview && effAirDuration > 0
      ? Math.min(100, (airPlayback.current / effAirDuration) * 100)
      : 0;
  const cabinDateStr = cabinaClock.toLocaleString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  return (
    <div className="rb-cabin">
      <AirQualityBanner />

      <section className="rb-strip" aria-label="Estado de emisión">
        <div className="rb-strip-clock mono">{cabinDateStr}</div>
        <div className="rb-card rb-card-prev">
          <div className="rb-card-k">Pista anterior</div>
          <div className="rb-card-main">{prevCardText}</div>
        </div>
        <div className={`rb-card rb-card-air${pauseActive ? " rb-card-air--pause" : ""}`}>
          <div className="rb-card-k">En el aire</div>
          <div className="rb-card-title">{heroTitle}</div>
          {heroArtist ? <div className="rb-card-sub">{heroArtist}</div> : null}
          {pauseActive && pauseCountdown ? (
            <div className="rb-card-pause-countdown mono" aria-live="polite" aria-atomic="true">
              {formatPauseRemaining(pauseCountdown.remainingSec)}
            </div>
          ) : null}
          <div className="rb-card-prog">
            <div
              className={`rb-card-prog-fill${pauseActive ? " rb-card-prog-fill--pause" : ""}`}
              style={{ width: `${airProgPct}%` }}
            />
          </div>
          <div className="rb-card-times mono small">
            {pauseActive && pauseCountdown ? (
              <>
                Pausa · rest. {formatPauseRemaining(pauseCountdown.remainingSec)} /{" "}
                {formatPauseRemaining(pauseCountdown.totalSec)}
              </>
            ) : !dockIsPreview && airAsset ? (
              <>
                {fmtDur(airPlayback.current)} / {fmtDur(effAirDuration || airAsset.durationSec)}
                {thisRemainSec != null ? ` · rest. ${fmtDur(thisRemainSec)}` : ""}
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="rb-card rb-card-next">
          <div className="rb-card-k">Pista siguiente</div>
          <div className="rb-card-main">{nextCardText}</div>
        </div>
        {airAsset && !dockIsPreview ? (
          <div
            className="rb-strip-badge rb-strip-badge--live"
            title={
              listenThroughActive
                ? "Monitor = aire público (mismo mount Icecast que oyentes)"
                : "Referencia local en este equipo (el aire público es el encoder)"
            }
          >
            {listenThroughActive ? "AIRE" : "AL AIRE"}
          </div>
        ) : (
          <div className="rb-strip-badge rb-strip-badge--idle" title="Sin pista de referencia al aire">
            STBY
          </div>
        )}
      </section>

      {msg ? <p className="rb-msg error">{msg}</p> : null}

      <div className="rb-body">
        <aside className="rb-col rb-col-left" ref={libraryPanelRef}>
          <PlayoutLibraryPicker
            token={token}
            canWrite={canEditPlaylist && canOperate}
            busy={plBusy}
            onAddAssets={(ids) => void addAssetsToActivePlaylist(ids)}
          />
          <div
            className="rb-vu"
            aria-label="Nivel de referencia de audio"
            title="Barras L/R desde el bus de referencia (aprox. dBFS; no es medición broadcast calibrada)."
          >
            <div className="rb-vu-head">
              <span className="rb-vu-title">Nivel</span>
              <div className="rb-vu-scale-h mono" aria-hidden>
                <span>-30</span>
                <span>-15</span>
                <span>0</span>
              </div>
            </div>
            <div className="rb-vu-row">
              <span className="rb-vu-ch">L</span>
              <div className="rb-vu-meter" aria-hidden>
                <div ref={rbVuPeakLRef} className="rb-vu-peak" style={{ width: "0%" }} />
              </div>
            </div>
            <div className="rb-vu-row">
              <span className="rb-vu-ch">R</span>
              <div className="rb-vu-meter rb-vu-meter-r" aria-hidden>
                <div ref={rbVuPeakRRef} className="rb-vu-peak rb-vu-peak-r" style={{ width: "0%" }} />
              </div>
            </div>
          </div>
        </aside>

        <main className="rb-col rb-col-center">
          <div className="rb-pl-tabs" role="tablist" aria-label="Listas de reproducción">
            {playlists.length === 0 ? (
              <span className="muted small">Sin listas — pulse + para crear una</span>
            ) : (
              playlists.slice(0, 24).map((p) => {
                const color = p.tabColor?.trim() || null;
                const tabStyle = color
                  ? {
                      background: color,
                      color: playlistTabContrastColor(color),
                      borderColor: color,
                    }
                  : undefined;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={plPick === p.id}
                    className={`rb-pl-tab${plPick === p.id ? " rb-pl-tab--on" : ""}${tabDropPlId === p.id ? " rb-pl-tab--drop" : ""}${color ? " rb-pl-tab--colored" : ""}`}
                    style={tabStyle}
                    title={
                      canEditPlaylist
                        ? `${p.name} · clic derecho: renombrar, suprimir, color · soltar pistas aquí (Shift=copiar)`
                        : p.name
                    }
                    onClick={() => {
                      setPlPick(p.id);
                      setSelectedRowIdx(null);
                      setSelectedPlItemIds([]);
                    }}
                    onDoubleClick={() => renamePlaylistTab(p.id, p.name)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTabCtxMenu({
                        id: p.id,
                        name: p.name,
                        tabColor: color,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    onDragOver={(e) => onTabDragOver(e, p.id)}
                    onDragLeave={() => {
                      if (tabDropPlId === p.id) setTabDropPlId(null);
                    }}
                    onDrop={(e) => onTabDrop(e, p.id)}
                  >
                    {p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name}
                  </button>
                );
              })
            )}
            {canEditPlaylist && token ? (
              <button
                type="button"
                className="rb-pl-tab rb-pl-tab--add"
                onClick={() => void createPlaylistTab()}
                title="Nueva lista de reproducción"
              >
                +
              </button>
            ) : null}
            {canEditPlaylist && token ? (
              <button
                type="button"
                className="rb-pl-tab rb-pl-tab--genre"
                onClick={() => setCatalogFillKind("folder")}
                title="Rellenar lista desde carpeta, género, artista u otra lista"
              >
                ♫ Catálogo
              </button>
            ) : null}
            {canEditPlaylist && token ? (
              <Link to="/playlists" className="rb-pl-tab rb-pl-tab--add" title="Abrir otra lista guardada">
                Abrir…
              </Link>
            ) : null}
          </div>

          <PlaylistTabNameDialog
            open={tabNameDialog !== null}
            title={tabNameDialog?.mode === "rename" ? "Cambiar el nombre" : "Nueva lista de reproducción"}
            initialName={
              tabNameDialog?.mode === "rename"
                ? tabNameDialog.name
                : `Lista ${playlists.length + 1}`
            }
            confirmLabel={tabNameDialog?.mode === "rename" ? "Renombrar" : "Crear"}
            busy={tabActionBusy}
            onClose={() => {
              if (!tabActionBusy) setTabNameDialog(null);
            }}
            onConfirm={(name) => void submitTabNameDialog(name)}
          />

          <PlaylistTabContextMenu
            open={tabCtxMenu !== null}
            x={tabCtxMenu?.x ?? 0}
            y={tabCtxMenu?.y ?? 0}
            playlistName={tabCtxMenu?.name ?? ""}
            currentColor={tabCtxMenu?.tabColor ?? null}
            canEdit={canEditPlaylist}
            onClose={() => setTabCtxMenu(null)}
            onRename={() => {
              if (!tabCtxMenu) return;
              renamePlaylistTab(tabCtxMenu.id, tabCtxMenu.name);
            }}
            onDelete={() => {
              if (!tabCtxMenu) return;
              void deletePlaylistTab(tabCtxMenu.id, tabCtxMenu.name);
            }}
            onPickColor={(color) => {
              if (!tabCtxMenu) return;
              void setPlaylistTabColor(tabCtxMenu.id, color);
            }}
          />

          {canEditPlaylist && token && plPick ? (
            <div className="rb-pl-toolbar" role="toolbar" aria-label="Acciones de la lista">
              <button
                type="button"
                className="btn btn-compact"
                disabled={plBusy}
                onClick={() => libraryPanelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
                title="Busque pistas a la izquierda y añádalas (doble clic o botón)"
              >
                Manual
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={plBusy}
                onClick={() => setCatalogFillKind("folder")}
                title="Añadir todas las pistas de una carpeta, género o artista"
              >
                Carpeta / género
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={plBusy}
                onClick={() => setTrackListOpen(true)}
                title="Bloque dinámico: 1 pista de lista o carpeta cada vez que llega su turno"
              >
                Lista de pistas
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={plBusy}
                onClick={() => setGeneratorOpen(true)}
                title="Rotación por categorías (música, jingle, anuncio…) y duración"
              >
                Generador Pro
              </button>
              <button
                type="button"
                className="btn primary btn-compact"
                disabled={!canOperate || !activePlDetail || !playlistHasAirContent(activePlDetail.items) || plBusy}
                onClick={() => void playPlaylistFromIndex(selectedRowIdx ?? 0)}
                title="Esta lista pasa a ser la secuencia al aire"
              >
                {plBusy ? "…" : "Reproducir"}
              </button>
            </div>
          ) : null}

          <div className="rb-pl-toolbar rb-pl-toolbar--meta" role="toolbar" aria-label="Cabina">
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => void refresh()}
              title="Sincronizar estación y lista con el servidor"
            >
              Actualizar
            </button>
            <button
              type="button"
              className={`btn btn-compact${findOpen || listFilter.trim() ? " primary" : ""}`}
              onClick={() => {
                setFindOpen((v) => {
                  const next = !v;
                  if (next) window.setTimeout(() => findInputRef.current?.focus(), 0);
                  return next;
                });
              }}
              title="Buscar en la lista (Ctrl+F)"
              aria-pressed={findOpen || Boolean(listFilter.trim())}
            >
              Buscar
            </button>
          </div>

          {activePlDetail ? (
            <p
              className="rb-pl-tab-hint muted small"
              title="Arrastre desde la librería; Reproducir o doble clic para al aire"
            >
              «{activePlDetail.name}» · {activePlDetail.items.length} ítem(s)
            </p>
          ) : null}
          {activePlDetail &&
          playlistHasAirContent(activePlDetail.items) &&
          (queue.length === 0 || state?.station.activePlaylistId !== plPick) ? (
            <div className="playlist-air-banner" role="status">
              <p>
                «{activePlDetail.name}» aún no está al aire. Pulse <strong>Reproducir</strong> para emitirla.
              </p>
              <button
                type="button"
                className="btn primary btn-compact"
                disabled={!canOperate || plBusy}
                onClick={() => void playPlaylistFromIndex(selectedRowIdx ?? 0)}
              >
                Reproducir ahora
              </button>
            </div>
          ) : null}

          {findOpen || listFilter.trim() ? (
          <div className="rb-pl-find-bar">
            <label className="rb-pl-find-label small muted" htmlFor="rb-pl-find">
              Buscar en la lista
            </label>
            <input
              id="rb-pl-find"
              ref={findInputRef}
              className="rb-pl-find-input"
              type="search"
              placeholder="Título, artista, género…"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              onBlur={() => {
                if (!listFilter.trim()) setFindOpen(false);
              }}
            />
            {listFilter.trim() ? (
              <button type="button" className="btn btn-compact ghost" onClick={() => setListFilter("")}>
                Limpiar
              </button>
            ) : null}
          </div>
          ) : null}

          <PlayoutCatalogFillDialog
            open={catalogFillKind !== null}
            kind={catalogFillKind ?? "genre"}
            genres={libraryGenres}
            artists={libraryArtists}
            folders={libraryFolders}
            playlists={playlists}
            activePlaylistId={plPick || null}
            busy={plBusy}
            onClose={() => setCatalogFillKind(null)}
            onConfirm={(opts) => void onCatalogFillConfirm(opts)}
          />

          {token && plPick ? (
            <TrackListInsertDialog
              open={trackListOpen}
              token={token}
              playlistId={plPick}
              insertAfterItemId={selectedPlItemIds.at(-1) ?? null}
              onClose={() => setTrackListOpen(false)}
              onInserted={(detail) => {
                setActivePlDetail(detail);
                setTrackListOpen(false);
                setMsg("Lista de pistas añadida a la secuencia.");
              }}
            />
          ) : null}

          {token ? (
            <PlaylistGeneratorDialog
              open={generatorOpen}
              token={token}
              onClose={() => setGeneratorOpen(false)}
              onGenerated={(result: ApiPlaylistGenerateResult) => {
                setGeneratorOpen(false);
                void (async () => {
                  await reloadPlaylists();
                  setPlPick(result.playlistId);
                  setSelectedRowIdx(null);
                  setMsg(`Lista generada: «${result.name}» (${result.trackCount} pistas). Pulse Reproducir para al aire.`);
                })();
              }}
            />
          ) : null}

          <div
            ref={queueRegionRef}
            tabIndex={-1}
            className={`playlist-table-scroll playlist-queue-focus-root rb-table-wrap${queueDropActive ? " playlist-queue-focus-root--drop-active" : ""}`}
            role="region"
            aria-label="Playlist activa"
            onDragOver={onQueueDragOver}
            onDragLeave={() => setQueueDropActive(false)}
            onDrop={onQueueDrop}
          >
            <table className="playlist-table">
              <thead>
                <tr>
                  <th className="col-grip" aria-label="Orden" />
                  <th className="col-idx">#</th>
                  <th className="col-artist">Artista</th>
                  <th className="col-title">Título</th>
                  <th className="col-dur">Dur.</th>
                  <th className="col-genre">Género</th>
                  <th className="col-file">Archivo</th>
                  <th className="col-act" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {!activePlDetail ? (
                  <tr>
                    <td colSpan={8} className="playlist-empty muted">
                      {playlists.length === 0
                        ? "Cree una pestaña de lista (+) y añada pistas desde la biblioteca musical."
                        : "Cargando lista…"}
                    </td>
                  </tr>
                ) : plItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="playlist-empty muted">
                      Lista vacía. Use la barra Manual · Lista de pistas · Generador Pro, o arrastre pistas desde la
                      librería a la izquierda / <Link to="/explorador">Explorador</Link>.
                    </td>
                  </tr>
                ) : visiblePlRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="playlist-empty muted">
                      Ninguna pista coincide con «{listFilter.trim()}».
                    </td>
                  </tr>
                ) : (
                  visiblePlRows.map(({ row, idx }) => {
                    const isCommand = isCommandPlaylistKind(row.kind);
                    const isVoicetrack = row.kind === "voicetrack";
                    const a = row.asset as AssetExtra | null;
                    const isOnAir = idx === onAirPlIdx;
                    const isMultiSelected = selectedPlItemIds.includes(row.id);
                    const filterDim =
                      filterQ &&
                      (isCommand
                        ? !`${row.label ?? ""} ${row.kind}`.toLowerCase().includes(filterQ)
                        : !`${a?.title ?? ""} ${a?.artist ?? ""}`.toLowerCase().includes(filterQ));
                    return (
                      <tr
                        key={row.id}
                        ref={isOnAir ? activeRowRef : undefined}
                        aria-selected={selectedRowIdx === idx || isMultiSelected}
                        className={`playlist-row playlist-row--clickable${isCommand ? " playlist-row--command" : ""}${isVoicetrack ? " playlist-row--voicetrack" : ""}${isOnAir ? " playlist-row--current" : ""}${selectedRowIdx === idx || isMultiSelected ? " playlist-row--selected" : ""}${plDropHoverIdx === idx ? " playlist-row--drop-target" : ""}${plDragIdx === idx ? " playlist-row--dragging" : ""}${filterDim ? " playlist-row--dimmed" : ""}`}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            setSelectedPlItemIds((prev) =>
                              prev.includes(row.id) ? prev.filter((id) => id !== row.id) : [...prev, row.id],
                            );
                            setSelectedRowIdx(idx);
                            return;
                          }
                          if (e.shiftKey && selectedRowIdx !== null && activePlDetail) {
                            const from = Math.min(selectedRowIdx, idx);
                            const to = Math.max(selectedRowIdx, idx);
                            setSelectedPlItemIds(activePlDetail.items.slice(from, to + 1).map((i) => i.id));
                            setSelectedRowIdx(idx);
                            return;
                          }
                          setSelectedPlItemIds([row.id]);
                          setSelectedRowIdx(idx);
                        }}
                        onDoubleClick={() => {
                          if (!canOperate) return;
                          void playPlaylistFromIndex(idx);
                        }}
                        onDragOver={(e) => onPlRowDragOver(e, idx)}
                        onDrop={(e) => onPlRowDrop(e, idx)}
                        onDragLeave={() => {
                          if (plDropHoverIdx === idx) setPlDropHoverIdx(null);
                        }}
                        title={canOperate ? "Doble clic: reproducir desde aquí" : undefined}
                      >
                        <td className="col-grip" onClick={(e) => e.stopPropagation()}>
                          {canEditPlaylist ? (
                            <span
                              className="playlist-row-grip"
                              draggable
                              title="Arrastrar para reordenar o mover a otra pestaña"
                              onDragStart={(e) => onPlRowDragStart(e, idx)}
                              onDragEnd={() => {
                                setPlDragIdx(null);
                                setPlDropHoverIdx(null);
                              }}
                            >
                              ⋮⋮
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="mono col-idx">{idx + 1}</td>
                        <td className="col-artist">
                          {isCommand ? (
                            <span className="playlist-cmd-badge">{queueEntryKindLabel(row.kind)}</span>
                          ) : isVoicetrack ? (
                            <span className="playlist-cmd-badge playlist-cmd-badge--vt">VT</span>
                          ) : (
                            (a?.artist ?? "—")
                          )}
                        </td>
                        <td className="col-title">{isCommand ? queueEntryTitle(row) : queueEntryTitle(row)}</td>
                        <td className="mono col-dur">{fmtDur(queueEntryDurationSec(row))}</td>
                        <td className="col-genre small muted">{isCommand ? "—" : (a?.genre ?? "—")}</td>
                        <td className="col-file mono small" title={isCommand ? undefined : a?.path}>
                          {isCommand ? "—" : basename(a?.path ?? "")}
                        </td>
                        <td className="col-act" onClick={(e) => e.stopPropagation()}>
                          {canEditPlaylist ? (
                            <div className="rb-pl-row-actions">
                              <button
                                type="button"
                                className="btn btn-table"
                                disabled={idx === 0 || plBusy}
                                title="Subir"
                                onClick={() => movePlItem(idx, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="btn btn-table"
                                disabled={idx >= plItems.length - 1 || plBusy}
                                title="Bajar"
                                onClick={() => movePlItem(idx, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="btn btn-table"
                                disabled={!token}
                                onClick={() => void removePlaylistItem(row.id)}
                              >
                                Quitar
                              </button>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <footer className="station-player-dock rb-dock" aria-label="Reproductor y metadatos">
            <div className="station-player-dock-head">
              <div className="station-player-dock-head-top">
                <div>
                  <strong className="station-player-dock-title">
                    {dockIsPreview
                      ? "Vista previa"
                      : pauseActive
                        ? "Pausa al aire"
                        : "Pista al aire"}
                  </strong>
                  {dockIsPreview ? (
                    <span className="muted small station-player-dock-sub">
                      Fila {selectedRowIdx !== null ? selectedRowIdx + 1 : ""} ·{" "}
                      <button type="button" className="btn-linkish" onClick={() => setSelectedRowIdx(null)}>
                        Volver a pista al aire
                      </button>
                    </span>
                  ) : pauseActive && pauseCountdown ? (
                    <span className="muted small station-player-dock-sub station-player-dock-sub--pause">
                      {pauseCountdown.label} · avance automático en{" "}
                      <strong className="mono">{formatPauseRemaining(pauseCountdown.remainingSec)}</strong>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {pauseActive && pauseCountdown ? (
              <div className="station-player-dock-body station-player-dock-body--pause">
                <div className="station-pause-dock-icon" aria-hidden>
                  ⏸
                </div>
                <div className="station-pause-dock-copy">
                  <p className="station-pause-dock-title">{pauseCountdown.label}</p>
                  <p className="station-pause-dock-countdown mono" aria-live="polite">
                    {formatPauseRemaining(pauseCountdown.remainingSec)}
                  </p>
                  <p className="muted small">La emisión continuará sola al llegar a cero.</p>
                </div>
              </div>
            ) : dockAsset ? (
              <div className="station-player-dock-body station-player-dock-body--broadcast">
                <div className="station-broadcast-cover-slot">
                  <div className="station-broadcast-field-label">Carátula</div>
                  <div className="station-player-cover" aria-hidden>
                    {(dockAsset as AssetExtra).coverPath && !coverLoadFailed && libraryCoverUrl(dockAsset.id, (dockAsset as AssetExtra).coverPath) ? (
                      <img
                        className="station-player-cover-img"
                        src={libraryCoverUrl(dockAsset.id, (dockAsset as AssetExtra).coverPath)!}
                        alt=""
                        loading="lazy"
                        onError={() => setCoverLoadFailed(true)}
                      />
                    ) : (
                      <span className="station-player-cover-letter">
                        {(dockAsset.title || "?").trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="station-broadcast-meta">
                  <div className="station-broadcast-meta-primary">
                    <dl className="station-broadcast-dl">
                      <dt>Artista</dt>
                      <dd>{dockAsset.artist?.trim() || "—"}</dd>
                      <dt>Título</dt>
                      <dd className="station-broadcast-track-title">{dockAsset.title}</dd>
                      <dt>Álbum</dt>
                      <dd>{dockAsset.album?.trim() || "—"}</dd>
                    </dl>
                  </div>
                  <div className="station-broadcast-meta-secondary">
                    <dl className="station-broadcast-dl">
                      <dt>Año</dt>
                      <dd>{(dockAsset as AssetExtra).releaseYear ?? "—"}</dd>
                      <dt>Género</dt>
                      <dd>{dockAsset.genre?.trim() || "—"}</dd>
                    </dl>
                  </div>
                </div>
                <div className="station-player-audio-wrap">
                  {dockIsPreview ? (
                    <audio
                      ref={previewAudioRef}
                      key={dockAsset.id}
                      className="station-player-audio"
                      controls
                      src={apiUrl(`/api/library/assets/${dockAsset.id}/stream`)}
                      preload="metadata"
                    />
                  ) : (
                    <p className="muted small station-air-global-hint">
                      {listenThroughActive
                        ? "Monitor = aire: oye el mismo mount que los oyentes (latencia Icecast normal). El encoder avanza la cola al fin de pista."
                        : "La referencia al aire sigue sonando aunque cambie a Librería u otro menú. Use Reproducir / Pausar abajo."}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted small station-player-dock-empty">No hay pista en emisión ni cola en esta posición.</p>
            )}
          </footer>
        </main>

      </div>

      <div className="rb-transport" aria-label="Controles de transporte">
        <button
          type="button"
          className="btn primary btn-compact"
          disabled={!canOperate || !activePlDetail || !playlistHasAirContent(activePlDetail.items) || plBusy}
          onClick={() => void playPlaylistFromIndex(selectedRowIdx ?? 0)}
          title="Esta lista pasa a ser la secuencia al aire"
        >
          {plBusy ? "…" : "Reproducir lista"}
        </button>
        <button
          type="button"
          className="btn btn-compact"
          onClick={() => void playAir()}
          disabled={(!dockAsset && !listenThroughActive) || dockIsPreview}
          title="Continuar el audio ya al aire"
        >
          Continuar
        </button>
        <button
          type="button"
          className="btn btn-compact"
          onClick={pauseAir}
          disabled={(!dockAsset && !listenThroughActive) || dockIsPreview}
          title="Pausar referencia al aire"
        >
          Pausar
        </button>
        <button
          type="button"
          className={`btn btn-compact${dockMuted ? " primary" : ""}`}
          onClick={() => setDockMuted((m) => !m)}
          disabled={!dockAsset && !listenThroughActive}
          aria-pressed={dockMuted}
          title="Silenciar solo la referencia en el navegador (M)"
        >
          {dockMuted ? "Sonido" : "Silenciar"}
        </button>
        {listenThroughAvailable || monitorMode === "local" ? (
          <button
            type="button"
            className={`btn btn-compact${listenThroughActive ? " primary" : ""}`}
            onClick={() => setMonitorMode(monitorMode === "air" ? "local" : "air")}
            title={
              listenThroughActive
                ? "Pasar a monitor local (Web Audio). El clock del aire sigue siendo el encoder."
                : listenThroughAvailable
                  ? "Monitor = aire público (recomendado cuando hay emisión)"
                  : "Forzado a local; active Emitir + encoder para oír el mount"
            }
            aria-pressed={listenThroughActive}
          >
            {listenThroughActive ? "Monitor = aire" : "Monitor local"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn primary btn-compact"
          onClick={() => void skip()}
          disabled={!token || !queue.length}
          title={!queue.length ? "La cola está vacía" : "Pasar a la siguiente pista en la cola"}
        >
          Siguiente
        </button>
        <div className="rb-transport-vol">
          <span className="muted small">Ref.</span>
          <span className="mono small">{dockMuted ? "mute" : "on"}</span>
        </div>
      </div>
    </div>
  );

}

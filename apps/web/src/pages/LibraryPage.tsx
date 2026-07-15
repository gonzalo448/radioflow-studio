import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { LibraryBrowseTree, type LibraryBrowseMode } from "../components/library/LibraryBrowseTree";
import { LibraryUserFoldersPanel } from "../components/library/LibraryUserFoldersPanel";
import { MusicLibraryMenuBar } from "../components/library/MusicLibraryMenuBar";
import { MusicLibraryAutoUpdateDialog } from "../components/library/MusicLibraryAutoUpdateDialog";
import { LibraryCustomFieldsDialog } from "../components/library/LibraryCustomFieldsDialog";
import { MusicLibraryAssetDetailDialog } from "../components/library/MusicLibraryAssetDetailDialog";
import {
  MusicLibraryToolsDialog,
  type MusicLibraryToolMode,
} from "../components/library/MusicLibraryToolsDialog";
import { MusicLoadMethodsPanel, type MusicLoadMethodsHandle } from "../components/MusicLoadMethodsPanel";
import { getStoredActiveFolder, setStoredActiveFolder, userLibraryFolders } from "../lib/library-active-folder";
import { folderDisplayName } from "../lib/library-folder";
import { canEditPlaylistsAccess, canWriteLibraryAccess } from "../lib/station-access";
import { useAuth } from "../auth/AuthContext";
import { allowsWebPanel } from "../lib/installable-client";
import { apiFetch } from "../lib/api";
import { apiUrl } from "../lib/api-base";
import { fetchLibraryAssetsPage, LIBRARY_UI_PAGE_SIZE } from "../lib/fetch-library-assets";
import { libraryCoverUrl } from "../lib/library-cover-url";
import { setLibraryAssetDrag } from "../lib/library-dnd";
import { DesktopFolderExplorer } from "../components/DesktopFolderExplorer";
import {
  isLocalAudioFile,
  notifyLibraryChanged,
  notifyStationRefresh,
  notifyStationPlay,
  uploadManyToLibrary,
  importNativePathsToLibrary,
  formatImportSummaryMessage,
} from "../lib/local-audio-import";
import {
  filesFromAbsolutePaths,
  isNativeAudioPath,
  isRadioflowDesktop,
  parseNativePathsDrag,
} from "../lib/desktop-native";
import type {
  ApiLibraryAsset,
  ApiLibraryBrowseLabel,
  ApiLibraryBrowseResponse,
  ApiLibraryFolderRow,
  ApiLibraryListQuery,
  ApiLibraryCheckTracksResult,
  ApiLibraryProcessJobDetail,
  ApiLibraryProcessJobEnqueueResult,
  ApiLibraryProcessSyncMetadataResult,
  ApiLibraryStats,
  ApiLibrarySyncMetadataBulkResult,
  ApiLibraryVerifyResult,
  ApiLibraryBulkDeleteResult,
  ApiPlaylistDetail,
  ApiSemanticSearchHit,
} from "@radioflow/shared";

type LibraryRow = ApiLibraryAsset & { createdAt?: string };
type SortKey = NonNullable<ApiLibraryListQuery["sort"]>;

function fmtDur(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtTotalMin(totalSec: number | null | undefined): string {
  if (totalSec == null || totalSec <= 0) return "";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

function msgIsSuccess(msg: string): boolean {
  return (
    msg.startsWith("Metadatos") ||
    msg.startsWith("Actualizando") ||
    msg.startsWith("Pista añadida") ||
    msg.includes("añadida(s) al final") ||
    msg.startsWith("Listo:") ||
    msg.includes("programada(s)") ||
    msg.startsWith("Borradas") ||
    msg.startsWith("Pista borrada") ||
    msg.startsWith("Importadas") ||
    msg.startsWith("Playlist") ||
    msg.startsWith("Comprobación") ||
    msg.startsWith("Simulación") ||
    msg.startsWith("Verificación") ||
    msg.includes("encolado")
  );
}

function suggestPlaylistName(opts: {
  pathPrefix: string;
  genre: string;
  artistFilter: string;
  albumFilter: string;
  selectedCount: number;
}): string {
  if (opts.selectedCount > 0) return `Selección (${opts.selectedCount})`;
  if (opts.pathPrefix) return folderDisplayName(opts.pathPrefix);
  if (opts.genre) return `Género: ${opts.genre}`;
  if (opts.artistFilter === "__none__") return "Sin artista";
  if (opts.artistFilter) return `Artista: ${opts.artistFilter}`;
  if (opts.albumFilter) return `Álbum: ${opts.albumFilter}`;
  return "Nueva playlist";
}

function processJobKindLabel(kind: string): string {
  switch (kind) {
    case "sync_metadata":
      return "Actualizando metadatos";
    case "loudness_batch":
      return "Normalizando loudness";
    case "bpm_detect":
      return "Detectando BPM";
    case "trim_silence":
      return "Procesando silencios";
    case "transcode_mp3":
      return "Convirtiendo a MP3";
    case "time_stretch":
      return "Time stretch";
    default:
      return "Procesando biblioteca";
  }
}

function formatProcessJobDone(d: ApiLibraryProcessJobDetail): string {
  if (d.kind === "sync_metadata" && d.result) {
    const res = d.result as ApiLibraryProcessSyncMetadataResult;
    return `Metadatos actualizados: ${res.updated} de ${res.total}.${res.failures ? ` ${res.failures} con error.` : ""}`;
  }
  return `${processJobKindLabel(d.kind)} completado.`;
}

export function LibraryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, user } = useAuth();
  const [assets, setAssets] = useState<LibraryRow[]>([]);
  const [matchedTotal, setMatchedTotal] = useState(0);
  const [listPage, setListPage] = useState(0);
  const [liveQ, setLiveQ] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [genre, setGenre] = useState("");
  const [artistFilter, setArtistFilter] = useState("");
  const [albumFilter, setAlbumFilter] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [browseMode, setBrowseMode] = useState<LibraryBrowseMode>("path");
  const [browseGenres, setBrowseGenres] = useState<ApiLibraryBrowseLabel[]>([]);
  const [browseArtists, setBrowseArtists] = useState<ApiLibraryBrowseLabel[]>([]);
  const [browseAlbums, setBrowseAlbums] = useState<ApiLibraryBrowseLabel[]>([]);
  const [folders, setFolders] = useState<ApiLibraryFolderRow[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(() => getStoredActiveFolder());
  const [genres, setGenres] = useState<string[]>([]);
  const [stats, setStats] = useState<ApiLibraryStats | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("artist");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [cabinaBusyId, setCabinaBusyId] = useState<string | null>(null);
  const [cabinaBulkBusy, setCabinaBulkBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [toolMode, setToolMode] = useState<MusicLibraryToolMode>(null);
  const [autoUpdateOpen, setAutoUpdateOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toolsBusy, setToolsBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<ApiLibraryCheckTracksResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<ApiLibraryVerifyResult | null>(null);
  const [processJobId, setProcessJobId] = useState<string | null>(null);
  const [processJobDetail, setProcessJobDetail] = useState<ApiLibraryProcessJobDetail | null>(null);
  const lastCompletedJobRef = useRef<string | null>(null);
  const loadMethodsRef = useRef<MusicLoadMethodsHandle>(null);

  const detailAsset = useMemo(
    () => (detailAssetId ? assets.find((a) => a.id === detailAssetId) ?? null : null),
    [assets, detailAssetId],
  );

  const canTrackInfo = selectedIds.size === 1;
  const canCustomFields = selectedIds.size > 0;
  const canWrite = canWriteLibraryAccess(user?.role);
  const canCabina = canWrite;
  const canPlaylist = canEditPlaylistsAccess(user?.role);

  const load = useCallback(
    async (overrides?: {
      q?: string;
      genre?: string;
      artist?: string;
      album?: string;
      pathPrefix?: string;
      page?: number;
    }) => {
      setLoading(true);
      setMsg(null);
      try {
        const q = overrides?.q ?? searchQ;
        const g = overrides?.genre ?? genre;
        const a = overrides?.artist ?? artistFilter;
        const al = overrides?.album ?? albumFilter;
        const p = overrides?.pathPrefix ?? pathPrefix;
        const page = overrides?.page ?? listPage;
        let data: LibraryRow[];
        let total = 0;
        if (semanticSearch && q.trim()) {
          const semParams = new URLSearchParams();
          semParams.set("q", q.trim());
          if (g.trim()) semParams.set("genre", g.trim());
          if (a.trim()) semParams.set("artist", a.trim());
          if (al.trim()) semParams.set("album", al.trim());
          if (p.trim()) semParams.set("pathPrefix", p.trim());
          data = await apiFetch<ApiSemanticSearchHit[]>(`/api/semantic/search?${semParams.toString()}`);
          total = data.length;
        } else {
          const pageResult = await fetchLibraryAssetsPage<LibraryRow>({
            q: q.trim() || undefined,
            genre: g.trim() || undefined,
            artist: a.trim() || undefined,
            album: al.trim() || undefined,
            pathPrefix: p.trim() || undefined,
            sort: sortKey,
            order: sortOrder,
            take: LIBRARY_UI_PAGE_SIZE,
            skip: page * LIBRARY_UI_PAGE_SIZE,
          });
          data = pageResult.items;
          total = pageResult.total;
          if (data.length === 0 && page > 0 && total > 0) {
            const lastPage = Math.max(0, Math.ceil(total / LIBRARY_UI_PAGE_SIZE) - 1);
            if (lastPage !== page) {
              setListPage(lastPage);
              return;
            }
          }
        }
        setAssets(data);
        setMatchedTotal(total);
        setSelectedIds(new Set());
        const [s, browse] = await Promise.all([
          apiFetch<ApiLibraryStats>("/api/library/stats"),
          apiFetch<ApiLibraryBrowseResponse>("/api/library/browse"),
        ]);
        setStats(s);
        setFolders(userLibraryFolders(browse.pathFolders));
        setBrowseGenres(browse.genres);
        setBrowseArtists(browse.artists);
        setBrowseAlbums(browse.albums ?? []);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al cargar");
        setAssets([]);
        setMatchedTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [albumFilter, artistFilter, genre, listPage, pathPrefix, searchQ, semanticSearch, sortKey, sortOrder],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    apiFetch<{ genres: string[] }>("/api/library/genres")
      .then((r) => setGenres(r.genres))
      .catch(() => setGenres([]));
  }, []);

  useEffect(() => {
    if (!token || !processJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await apiFetch<ApiLibraryProcessJobDetail>(
          `/api/library/process-jobs/${encodeURIComponent(processJobId)}`,
          { token },
        );
        if (cancelled) return;
        setProcessJobDetail(d);
        if (d.status === "completed" && lastCompletedJobRef.current !== d.id) {
          lastCompletedJobRef.current = d.id;
          notifyLibraryChanged();
          void load();
          setMsg(formatProcessJobDone(d));
        }
        if (d.status === "failed" && lastCompletedJobRef.current !== d.id) {
          lastCompletedJobRef.current = d.id;
          setMsg(d.error ?? `${processJobKindLabel(d.kind)} falló.`);
        }
      } catch {
        if (!cancelled) setProcessJobDetail(null);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load, processJobId, token]);

  useEffect(() => {
    if (!token) return;
    void apiFetch<ApiLibraryProcessJobDetail[]>("/api/library/process-jobs?take=8", { token })
      .then((rows) => {
        const active = rows.find((j) => j.status === "pending" || j.status === "running");
        if (active) setProcessJobId((cur) => cur ?? active.id);
      })
      .catch(() => {});
  }, [token]);

  const processJobActive = useMemo(() => {
    if (!processJobDetail) return false;
    return processJobDetail.status === "pending" || processJobDetail.status === "running";
  }, [processJobDetail]);

  const processPct = useMemo(() => {
    if (!processJobDetail || processJobDetail.progressTotal <= 0) return 0;
    return Math.min(100, Math.round((processJobDetail.progressCurrent / processJobDetail.progressTotal) * 100));
  }, [processJobDetail]);

  const hasLibraryView = Boolean(pathPrefix || genre || artistFilter || albumFilter || selectedIds.size > 0);

  const toolScope = useMemo(() => {
    if (selectedIds.size > 0) {
      return { label: "Selección actual", assetIds: [...selectedIds] };
    }
    if (pathPrefix) return { label: `Carpeta: ${folderDisplayName(pathPrefix)}`, assetIds: assets.map((a) => a.id) };
    if (genre) return { label: `Género: ${genre}`, assetIds: assets.map((a) => a.id) };
    if (artistFilter) {
      return {
        label: artistFilter === "__none__" ? "Sin artista" : `Artista: ${artistFilter}`,
        assetIds: assets.map((a) => a.id),
      };
    }
    if (albumFilter) return { label: `Álbum: ${albumFilter}`, assetIds: assets.map((a) => a.id) };
    if (assets.length > 0) return { label: "Vista actual", assetIds: assets.map((a) => a.id) };
    return { label: "Toda la biblioteca", assetIds: [] as string[] };
  }, [albumFilter, artistFilter, assets, genre, pathPrefix, selectedIds]);

  useEffect(() => {
    const tool = searchParams.get("tool");
    if (tool === "process" || tool === "check" || tool === "verify") {
      setToolMode(tool);
      setCheckResult(null);
      setVerifyResult(null);
    }
    if (tool === "auto-update") setAutoUpdateOpen(true);
  }, [searchParams]);

  const openTool = useCallback(
    (mode: Exclude<MusicLibraryToolMode, null>) => {
      setToolMode(mode);
      setCheckResult(null);
      setVerifyResult(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tool", mode);
        return next;
      });
    },
    [setSearchParams],
  );

  const closeTool = useCallback(() => {
    setToolMode(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("tool");
      return next;
    });
  }, [setSearchParams]);

  const runProcessJob = useCallback(
    async (opts: {
      kind: "loudness_batch" | "bpm_detect" | "trim_silence" | "transcode_mp3";
      apply: boolean;
      targetLufs: number;
    }) => {
      if (!token || toolScope.assetIds.length === 0) return;
      if (
        opts.apply &&
        (opts.kind === "trim_silence" || opts.kind === "transcode_mp3") &&
        !window.confirm(
          opts.kind === "trim_silence"
            ? "¿Recortar silencios en las pistas seleccionadas? Modifica los archivos en la bóveda."
            : "¿Convertir las pistas seleccionadas a MP3 192 kbps? Puede reemplazar archivos en la bóveda.",
        )
      ) {
        return;
      }
      setToolsBusy(true);
      try {
        const ids = toolScope.assetIds.slice(0, 200);
        let body: Record<string, unknown>;
        switch (opts.kind) {
          case "loudness_batch":
            body = { kind: "loudness_batch", assetIds: ids, targetLufs: opts.targetLufs, apply: opts.apply };
            break;
          case "bpm_detect":
            body = {
              kind: "bpm_detect",
              assetIds: ids,
              policy: { preferEmbeddedTags: true, analyzeAudio: true },
            };
            break;
          case "trim_silence":
            body = { kind: "trim_silence", assetIds: ids, apply: opts.apply };
            break;
          case "transcode_mp3":
            body = { kind: "transcode_mp3", assetIds: ids, apply: opts.apply, policy: { bitrateKbps: 192 } };
            break;
        }
        const r = await apiFetch<{ jobId: string }>("/api/library/process-jobs", {
          method: "POST",
          token,
          body: JSON.stringify(body),
        });
        lastCompletedJobRef.current = null;
        setProcessJobId(r.jobId);
        setProcessJobDetail(null);
        setMsg(`${processJobKindLabel(opts.kind)} encolado (${toolScope.assetIds.length} pista(s)).`);
        closeTool();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo encolar el job");
      } finally {
        setToolsBusy(false);
      }
    },
    [closeTool, token, toolScope.assetIds],
  );

  const runCheckTracks = useCallback(
    async (opts: { compareArtists: boolean; compareAlbums: boolean }) => {
      if (!token) return;
      setToolsBusy(true);
      try {
        const body =
          toolScope.assetIds.length > 0
            ? {
                assetIds: toolScope.assetIds.slice(0, 200),
                compareArtists: opts.compareArtists,
                compareAlbums: opts.compareAlbums,
              }
            : { maxInspect: 600, compareArtists: opts.compareArtists, compareAlbums: opts.compareAlbums };
        const r = await apiFetch<ApiLibraryCheckTracksResult>("/api/library/check-tracks", {
          method: "POST",
          token,
          body: JSON.stringify(body),
        });
        setCheckResult(r);
        setMsg(`Comprobación: ${r.withIssues} incidencia(s) en ${r.inspected} pista(s).`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al comprobar pistas");
      } finally {
        setToolsBusy(false);
      }
    },
    [token, toolScope.assetIds],
  );

  const runVerifyLibrary = useCallback(
    async (dryRun: boolean) => {
      if (!token) return;
      if (!dryRun && !window.confirm("¿Eliminar del catálogo las entradas cuyo archivo ya no existe en la bóveda?")) {
        return;
      }
      setToolsBusy(true);
      try {
        const r = await apiFetch<ApiLibraryVerifyResult>("/api/library/verify", {
          method: "POST",
          token,
          body: JSON.stringify({ dryRun }),
        });
        setVerifyResult(r);
        notifyLibraryChanged();
        if (!dryRun) await load();
        setMsg(
          dryRun
            ? `Simulación: ${r.orphanCount} huérfana(s) de ${r.inspected} revisadas.`
            : `Verificación: eliminadas ${r.removed} entrada(s) huérfana(s).`,
        );
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al verificar biblioteca");
      } finally {
        setToolsBusy(false);
      }
    },
    [load, token],
  );

  const sendToCabina = useCallback(
    async (assetId: string) => {
      if (!token || !canCabina) return;
      setCabinaBusyId(assetId);
      try {
        let wasIdle = false;
        try {
          const st = await apiFetch<{ queue: unknown[] }>("/api/station", { token });
          wasIdle = (st.queue?.length ?? 0) === 0;
        } catch {
          /* */
        }
        // playNext: aparecen en «Siguientes» justo después de la pista al aire.
        await apiFetch("/api/station/queue", {
          method: "POST",
          token,
          body: JSON.stringify({ assetId, playNext: true }),
        });
        notifyStationRefresh();
        if (wasIdle) notifyStationPlay();
        setMsg("Pista añadida como siguiente en la cola de cabina.");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo enviar a cabina");
      } finally {
        setCabinaBusyId(null);
      }
    },
    [canCabina, token],
  );

  const sendSelectionToCabina = useCallback(async () => {
    if (!token || selectedIds.size === 0) return;
    setCabinaBulkBusy(true);
    try {
      let wasIdle = false;
      try {
        const st = await apiFetch<{ queue: unknown[] }>("/api/station", { token });
        wasIdle = (st.queue?.length ?? 0) === 0;
      } catch {
        /* */
      }
      const assetIds = [...selectedIds];
      // Preferir bulk (1 broadcast). Si la API aún no tiene la ruta, fallback playNext en orden inverso.
      const CHUNK = 200;
      const chunks: string[][] = [];
      for (let i = 0; i < assetIds.length; i += CHUNK) {
        chunks.push(assetIds.slice(i, i + CHUNK));
      }
      let usedBulk = false;
      try {
        for (const chunk of [...chunks].reverse()) {
          await apiFetch("/api/station/queue-bulk", {
            method: "POST",
            token,
            body: JSON.stringify({ assetIds: chunk, playNext: true }),
          });
        }
        usedBulk = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (!/not found|404|ruta no encontrada/i.test(msg)) throw e;
      }
      if (!usedBulk) {
        for (const assetId of [...assetIds].reverse()) {
          await apiFetch("/api/station/queue", {
            method: "POST",
            token,
            body: JSON.stringify({ assetId, playNext: true }),
          });
        }
      }
      notifyStationRefresh();
      if (wasIdle) notifyStationPlay();
      setMsg(`${assetIds.length} pista(s) añadidas como siguientes en la cola de cabina.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al enviar selección");
    } finally {
      setCabinaBulkBusy(false);
    }
  }, [selectedIds, token]);

  const syncMetadataBulk = useCallback(
    async (ids: string[]) => {
      if (!token || ids.length === 0) return;
      setMetadataBusy(true);
      try {
        const r = await apiFetch<ApiLibrarySyncMetadataBulkResult>("/api/library/sync-metadata-bulk", {
          method: "POST",
          token,
          body: JSON.stringify({ assetIds: ids.slice(0, 200) }),
        });
        setMsg(`Metadatos actualizados: ${r.updated} pista(s).`);
        notifyLibraryChanged();
        await load();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al sincronizar metadatos");
      } finally {
        setMetadataBusy(false);
      }
    },
    [load, token],
  );

  const updateMetadata = useCallback(async () => {
    if (!token) return;
    const selection = [...selectedIds];
    if (selection.length > 0 && selection.length <= 25) {
      await syncMetadataBulk(selection);
      return;
    }
    const scope =
      selection.length > 0
        ? `${selection.length} seleccionadas`
        : pathPrefix || genre || artistFilter || albumFilter
          ? `vista filtrada (${assets.length})`
          : `toda la librería (${stats?.totalTracks ?? "?"})`;
    if (!window.confirm(`Actualizar metadatos desde archivos.\n\nÁmbito: ${scope}\n\nPuede seguir usando la aplicación.`)) return;
    setMetadataBusy(true);
    try {
      const body =
        selection.length > 0
          ? { kind: "sync_metadata" as const, mode: "asset_ids" as const, assetIds: selection.slice(0, 200) }
          : {
              kind: "sync_metadata" as const,
              mode: "library" as const,
              ...(pathPrefix || genre || artistFilter || albumFilter
                ? {
                    filters: {
                      ...(searchQ.trim() ? { q: searchQ.trim() } : {}),
                      ...(genre ? { genre } : {}),
                      ...(artistFilter ? { artist: artistFilter } : {}),
                      ...(albumFilter ? { album: albumFilter } : {}),
                      ...(pathPrefix ? { pathPrefix } : {}),
                    },
                  }
                : {}),
            };
      const r = await apiFetch<ApiLibraryProcessJobEnqueueResult>("/api/library/process-jobs", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      lastCompletedJobRef.current = null;
      setProcessJobId(r.jobId);
      setProcessJobDetail(null);
      setMsg(`Actualizando metadatos (${scope})…`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo iniciar la actualización");
    } finally {
      setMetadataBusy(false);
    }
  }, [
    albumFilter,
    artistFilter,
    assets.length,
    genre,
    pathPrefix,
    searchQ,
    selectedIds,
    stats?.totalTracks,
    syncMetadataBulk,
    token,
  ]);

  const createPlaylistFromView = useCallback(async () => {
    if (!token || !canPlaylist) return;
    if (!hasLibraryView && matchedTotal === 0 && assets.length === 0) {
      setMsg("Elija una carpeta, género, artista o seleccione pistas primero.");
      return;
    }
    const defaultName = suggestPlaylistName({
      pathPrefix,
      genre,
      artistFilter,
      albumFilter,
      selectedCount: selectedIds.size,
    });
    const name = window.prompt("Nombre de la playlist", defaultName)?.trim();
    if (!name) return;
    setPlaylistBusy(true);
    try {
      const body =
        selectedIds.size > 0
          ? { name, assetIds: [...selectedIds] }
          : {
              name,
              ...(searchQ.trim() ? { q: searchQ.trim() } : {}),
              ...(pathPrefix ? { pathPrefix } : {}),
              ...(genre ? { genre } : {}),
              ...(artistFilter ? { artist: artistFilter } : {}),
              ...(albumFilter ? { album: albumFilter } : {}),
            };
      const pl = await apiFetch<ApiPlaylistDetail>("/api/playlists/from-library-view", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setMsg(`Playlist «${pl.name}» creada con ${pl.items.length} pista(s).`);
      navigate(`/station?pl=${encodeURIComponent(pl.id)}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo crear la playlist");
    } finally {
      setPlaylistBusy(false);
    }
  }, [
    albumFilter,
    artistFilter,
    assets.length,
    matchedTotal,
    canPlaylist,
    genre,
    hasLibraryView,
    navigate,
    pathPrefix,
    searchQ,
    selectedIds,
    token,
  ]);

  async function enrichSelectedSemantic() {
    if (!token || !canWrite || selectedIds.size === 0) return;
    if (
      !window.confirm(
        `¿Enriquecer ${selectedIds.size} pista(s) con Ollama (nota + embedding)? Puede tardar varios minutos.`,
      )
    ) {
      return;
    }
    setMetadataBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ ok: number; failed: number }>("/api/semantic/enrich-batch", {
        method: "POST",
        token,
        body: JSON.stringify({ assetIds: [...selectedIds] }),
      });
      setMsg(`Ollama: ${r.ok} enriquecida(s)${r.failed ? ` · ${r.failed} error(es)` : ""}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al enriquecer");
    } finally {
      setMetadataBusy(false);
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setListPage(0);
    setSearchQ(liveQ);
    await load({ q: liveQ, page: 0 });
  }

  function clearFilters() {
    setLiveQ("");
    setSearchQ("");
    setGenre("");
    setArtistFilter("");
    setAlbumFilter("");
    setPathPrefix("");
    setListPage(0);
    void load({ q: "", genre: "", artist: "", album: "", pathPrefix: "", page: 0 });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortOrder("asc");
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortOrder === "asc" ? " ▲" : " ▼";
  }

  function toggleRowSelect(id: string, e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button, input, audio, a, label")) return;
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (e.metaKey || e.ctrlKey) {
        if (n.has(id)) n.delete(id);
        else n.add(id);
      } else {
        n.clear();
        n.add(id);
      }
      return n;
    });
  }

  const deleteAsset = useCallback(
    async (assetId: string) => {
      if (!token) return;
      if (!window.confirm("¿Borrar esta pista?\n\nSe eliminará del catálogo y el archivo de audio del equipo.")) return;
      setDeleteBusy(true);
      try {
        await apiFetch(`/api/library/assets/${encodeURIComponent(assetId)}`, {
          method: "DELETE",
          token,
        });
        notifyLibraryChanged();
        setSelectedIds((prev) => {
          const n = new Set(prev);
          n.delete(assetId);
          return n;
        });
        if (detailAssetId === assetId) setDetailAssetId(null);
        await load();
        setMsg("Pista borrada.");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo eliminar la pista");
      } finally {
        setDeleteBusy(false);
      }
    },
    [detailAssetId, load, token],
  );

  const deleteSelection = useCallback(async () => {
    if (!token || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    if (
      !window.confirm(
        `¿Borrar ${ids.length} pista(s)?\n\nSe eliminarán del catálogo y los archivos de audio del equipo.`,
      )
    ) {
      return;
    }
    setDeleteBusy(true);
    try {
      const chunkSize = 80;
      let deleted = 0;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const r = await apiFetch<ApiLibraryBulkDeleteResult>("/api/library/assets/bulk-delete", {
          method: "POST",
          token,
          body: JSON.stringify({ ids: chunk }),
        });
        deleted += r.deleted;
      }
      notifyLibraryChanged();
      setDetailAssetId(null);
      setSelectedIds(new Set());
      await load();
      setMsg(`Borradas ${deleted} pista(s).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo eliminar la selección");
    } finally {
      setDeleteBusy(false);
    }
  }, [load, selectedIds, token]);

  const selectAllInView = useCallback(() => {
    setSelectedIds(new Set(assets.map((a) => a.id)));
  }, [assets]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const allInViewSelected = assets.length > 0 && assets.every((a) => selectedIds.has(a.id));
  const someInViewSelected = assets.some((a) => selectedIds.has(a.id));
  const serverPaging = !(semanticSearch && searchQ.trim());
  const pagerTotal = Math.max(matchedTotal, listPage * LIBRARY_UI_PAGE_SIZE + assets.length);
  const pagerPages = Math.max(1, Math.ceil(pagerTotal / LIBRARY_UI_PAGE_SIZE));
  const canGoNext = (listPage + 1) * LIBRARY_UI_PAGE_SIZE < pagerTotal;

  const libraryPager =
    serverPaging && (assets.length > 0 || listPage > 0) ? (
      <div className="library-pagination" role="navigation" aria-label="Paginación de pistas">
        <button
          type="button"
          className="btn primary btn-compact"
          disabled={loading || listPage <= 0}
          onClick={() => setListPage((p) => Math.max(0, p - 1))}
        >
          ← Anterior
        </button>
        <span className="library-pagination-label">
          Página <strong>{listPage + 1}</strong> de <strong>{pagerPages}</strong>
          {pagerTotal > 0 ? ` · ${pagerTotal} pista(s)` : null}
        </span>
        <button
          type="button"
          className="btn primary btn-compact"
          disabled={loading || !canGoNext}
          onClick={() => setListPage((p) => p + 1)}
        >
          Siguiente →
        </button>
      </div>
    ) : null;

  const toggleSelectAllInView = useCallback(() => {
    if (allInViewSelected) clearSelection();
    else selectAllInView();
  }, [allInViewSelected, clearSelection, selectAllInView]);

  const openTrackInfo = useCallback(() => {
    const id = [...selectedIds][0];
    if (id) setDetailAssetId(id);
  }, [selectedIds]);

  const importPaths = useCallback(
    async (paths: string[]) => {
      if (!token || paths.length === 0) return;
      const folder = getStoredActiveFolder();
      if (!folder) {
        setMsg("Crea o elige una carpeta en el panel izquierdo antes de importar música.");
        return;
      }
      setImportBusy(true);
      setImportProgress({ done: 0, total: paths.length });
      try {
        const summary = await importNativePathsToLibrary(token, paths, {
          folderPathPrefix: folder,
          onProgress: (done, total) => setImportProgress({ done, total }),
        });
        notifyLibraryChanged();
        setMsg(formatImportSummaryMessage(summary, paths.length));
        setBrowseMode("path");
        setPathPrefix(folder);
        await load({ pathPrefix: folder, genre: "", artist: "", album: "", q: "" });
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al importar");
      } finally {
        setImportBusy(false);
        setImportProgress(null);
      }
    },
    [load, token],
  );

  const importFiles = useCallback(
    async (files: File[]) => {
      if (!token || files.length === 0) return;
      const folder = getStoredActiveFolder();
      if (!folder) {
        setMsg("Crea o elige una carpeta en el panel izquierdo antes de importar música.");
        return;
      }
      setImportBusy(true);
      try {
        await uploadManyToLibrary(token, files, { folderPathPrefix: folder });
        notifyLibraryChanged();
        setMsg(`Importadas ${files.length} pista(s).`);
        await load();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al importar");
      } finally {
        setImportBusy(false);
      }
    },
    [load, token],
  );

  const desktopNative = isRadioflowDesktop();

  const importFromNativeDialog = useCallback(async () => {
    const folder = getStoredActiveFolder();
    if (!folder) {
      setMsg("Crea o elige una carpeta en el panel izquierdo antes de importar música.");
      return;
    }
    try {
      const fsApi = window.radioflow?.nativeFs;
      if (!fsApi?.openAudioDialog) return;
      const paths = await fsApi.openAudioDialog();
      if (paths.length) await importPaths(paths.filter(isNativeAudioPath));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo abrir el diálogo de archivos");
    }
  }, [importPaths]);

  const onMenuAddFiles = useCallback(() => {
    if (desktopNative) void importFromNativeDialog();
    else loadMethodsRef.current?.openMultiFile();
  }, [desktopNative, importFromNativeDialog]);

  const onMenuAddFolder = useCallback(() => {
    if (desktopNative && window.radioflow?.nativeFs?.openAudioFolderDialog) {
      void (async () => {
        const folder = getStoredActiveFolder();
        if (!folder) {
          setMsg("Crea o elige una carpeta en el panel izquierdo antes de importar música.");
          return;
        }
        try {
          const paths = await window.radioflow?.nativeFs?.openAudioFolderDialog();
          if (paths?.length) await importPaths(paths);
          else setMsg("La carpeta elegida no tiene archivos de audio reconocidos.");
        } catch (e) {
          setMsg(e instanceof Error ? e.message : "No se pudo abrir la carpeta");
        }
      })();
      return;
    }
    if (desktopNative) navigate("/explorador");
    else loadMethodsRef.current?.openFolder();
  }, [desktopNative, importPaths, navigate]);

  return (
    <div className="library-page music-library-page">
      <aside className="music-library-sidebar card">
        <header className="music-library-sidebar-head">
          <h1 className="music-library-sidebar-title">Biblioteca musical</h1>
          <p className="muted small music-library-sidebar-lead">
            Importe música desde sus discos con el explorador nativo o <em>Añadir → Archivo(s)</em>.
          </p>
        </header>

        {canWrite ? (
          <MusicLibraryMenuBar
            canWrite={Boolean(token && canWrite)}
            onAddFiles={onMenuAddFiles}
            onAddFolder={onMenuAddFolder}
            onAddM3u={() => loadMethodsRef.current?.openM3u()}
            onProcessTracks={() => openTool("process")}
            onCheckTracks={() => openTool("check")}
            onVerifyLibrary={() => openTool("verify")}
            onUpdateMetadata={() => void updateMetadata()}
            onAutoUpdate={() => setAutoUpdateOpen(true)}
            onTrackInfo={openTrackInfo}
            canTrackInfo={canTrackInfo}
            onCustomFields={() => setCustomFieldsOpen(true)}
            canCustomFields={canCustomFields}
          />
        ) : null}

        {token ? (
          <LibraryUserFoldersPanel
            token={token}
            canWrite={canWrite}
            activePathPrefix={activeFolder}
            onActivePathPrefixChange={(prefix) => {
              setStoredActiveFolder(prefix);
              setActiveFolder(prefix);
              if (prefix) {
                setBrowseMode("path");
                setPathPrefix(prefix);
                setGenre("");
                setArtistFilter("");
                setAlbumFilter("");
                setSearchQ("");
                setLiveQ("");
                setListPage(0);
                void load({ pathPrefix: prefix, genre: "", artist: "", album: "", q: "", page: 0 });
              }
            }}
            onFoldersChanged={() => void load()}
          />
        ) : (
          <p className="muted small library-folder-hint">
            <Link to="/login">Inicia sesión</Link> como editor, DJ o admin para crear carpetas y subir música.
          </p>
        )}

        {!canWrite && token ? (
          <p className="library-viewer-notice error small" role="status">
        Su rol no permite editar la librería. Inicie sesión con su usuario de esta instalación.
          </p>
        ) : null}

        {canWrite && token && stats?.totalTracks === 0 && !loading ? (
          <p className="library-empty-hint small" role="status">
            {desktopNative ? (
              <>
                Empiece en <strong>Sus carpetas</strong> → <strong>Crear carpeta</strong> → explorador abajo o{" "}
                <strong>Añadir → Archivo(s)</strong> (diálogo del sistema).
              </>
            ) : (
              <>
                Use la aplicación instalada para explorar sus discos. En desarrollo web:{" "}
                <Link to="/explorador">Explorador</Link>.
              </>
            )}
          </p>
        ) : null}

        {desktopNative && canWrite && token ? (
          <DesktopFolderExplorer
            canPick={canWrite}
            importBusy={importBusy}
            panelTitle="Discos y carpetas"
            onImportSelectedPaths={(paths) => void importPaths(paths)}
          />
        ) : null}

        <LibraryBrowseTree
          mode={browseMode}
          onModeChange={setBrowseMode}
          pathFolders={folders}
          genres={browseGenres}
          artists={browseArtists}
          albums={browseAlbums}
          pathPrefix={pathPrefix}
          genreKey={genre}
          artistKey={artistFilter}
          albumKey={albumFilter}
          onPathSelect={(prefix) => {
            setBrowseMode("path");
            setPathPrefix(prefix);
            setGenre("");
            setArtistFilter("");
            setAlbumFilter("");
            setSearchQ("");
            setLiveQ("");
            setListPage(0);
            void load({ pathPrefix: prefix, genre: "", artist: "", album: "", q: "", page: 0 });
          }}
          onGenreSelect={(g) => {
            setBrowseMode("genre");
            setGenre(g);
            setPathPrefix("");
            setArtistFilter("");
            setAlbumFilter("");
            setListPage(0);
            void load({ genre: g, pathPrefix: "", artist: "", album: "", page: 0 });
          }}
          onArtistSelect={(key) => {
            setBrowseMode("artist");
            setArtistFilter(key);
            setPathPrefix("");
            setGenre("");
            setAlbumFilter("");
            setListPage(0);
            void load({ artist: key, pathPrefix: "", genre: "", album: "", page: 0 });
          }}
          onAlbumSelect={(al) => {
            setBrowseMode("album");
            setAlbumFilter(al);
            setPathPrefix("");
            setGenre("");
            setArtistFilter("");
            setListPage(0);
            void load({ album: al, pathPrefix: "", genre: "", artist: "", page: 0 });
          }}
        />

        {allowsWebPanel() && canWrite && token ? (
          <MusicLoadMethodsPanel
            ref={loadMethodsRef}
            token={token}
            canWrite={canWrite}
            busy={importBusy}
            allowServerM3uRegister={false}
            onUploadLocalFiles={importFiles}
            onAfterServerImport={() => void load()}
          />
        ) : null}
      </aside>

      <MusicLibraryToolsDialog
        mode={toolMode}
        scope={toolScope}
        busy={toolsBusy}
        checkResult={checkResult}
        verifyResult={verifyResult}
        onClose={closeTool}
        onRunProcess={(opts) => void runProcessJob(opts)}
        onRunCheck={(opts) => void runCheckTracks(opts)}
        onRunVerify={(dryRun) => void runVerifyLibrary(dryRun)}
      />

      {token ? (
        <MusicLibraryAutoUpdateDialog
          open={autoUpdateOpen}
          token={token}
          onClose={() => {
            setAutoUpdateOpen(false);
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete("tool");
              return next;
            });
          }}
          onSaved={() => {
            notifyLibraryChanged();
            void load();
          }}
        />
      ) : null}

      {token && detailAsset ? (
        <MusicLibraryAssetDetailDialog
          asset={detailAsset}
          token={token}
          canWrite={canWrite}
          onClose={() => setDetailAssetId(null)}
          onUpdated={(updated) => {
            setAssets((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
            notifyLibraryChanged();
          }}
          onDeleted={() => {
            setDetailAssetId(null);
            notifyLibraryChanged();
            void load();
          }}
        />
      ) : null}

      {token && customFieldsOpen ? (
        <LibraryCustomFieldsDialog
          open={customFieldsOpen}
          token={token}
          assetIds={[...selectedIds]}
          assets={assets}
          onClose={() => setCustomFieldsOpen(false)}
          onUpdated={() => {
            notifyLibraryChanged();
            void load();
          }}
        />
      ) : null}

      <section
        className="card library-main-card music-library-main"
        onDragOver={(e) => {
          if (!canWrite || !token) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!canWrite || !token || importBusy) return;
          const dropped = Array.from(e.dataTransfer.files).filter(isLocalAudioFile);
          if (dropped.length > 0) void importFiles(dropped);
          else {
            const paths = parseNativePathsDrag(e)?.filter(isNativeAudioPath);
            if (paths?.length && isRadioflowDesktop()) {
              void filesFromAbsolutePaths(paths).then((files) => {
                const audio = files.filter(isLocalAudioFile);
                if (audio.length) void importFiles(audio);
              });
            }
          }
        }}
      >
        <header className="library-page-header">
          <div>
            <h2 className="library-page-title">
              {pathPrefix ? folderDisplayName(pathPrefix) : "Pistas"}
            </h2>
            <p className="library-page-sub muted small">
              {loading
                ? "Cargando…"
                : stats
                  ? `${stats.totalTracks} en catálogo${
                      matchedTotal !== stats.totalTracks ? ` · ${matchedTotal} coinciden` : ""
                    } · mostrando ${assets.length}${
                      matchedTotal > assets.length
                        ? ` (pág. ${listPage + 1}/${Math.max(1, Math.ceil(matchedTotal / LIBRARY_UI_PAGE_SIZE))})`
                        : ""
                    }`
                  : "Catálogo musical"}
              {stats?.totalDurationSec ? ` · ${fmtTotalMin(stats.totalDurationSec)}` : ""}
            </p>
          </div>
          <div className="library-primary-actions">
            {canPlaylist && token ? (
              <button
                type="button"
                className="btn btn-compact"
                disabled={playlistBusy || (!hasLibraryView && matchedTotal === 0 && assets.length === 0)}
                onClick={() => void createPlaylistFromView()}
              >
                {playlistBusy ? "…" : "Crear playlist"}
              </button>
            ) : null}
            {canWrite && token ? (
              <NavLink to="/explorador" className="btn btn-compact ghost">
                Explorador avanzado
              </NavLink>
            ) : null}
            {canWrite && token ? (
              <button
                type="button"
                className="btn btn-compact"
                disabled={metadataBusy || processJobActive}
                onClick={() => void updateMetadata()}
              >
                {metadataBusy ? "…" : "Actualizar metadatos"}
              </button>
            ) : null}
            {canCabina && token ? (
              <button
                type="button"
                className="btn primary btn-compact"
                disabled={selectedIds.size === 0 || cabinaBulkBusy}
                onClick={() => void sendSelectionToCabina()}
              >
                {cabinaBulkBusy ? "…" : `A cabina${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
              </button>
            ) : null}
            {canWrite && token ? (
              <>
                <button
                  type="button"
                  className="btn btn-compact"
                  disabled={assets.length === 0 || loading}
                  onClick={selectAllInView}
                  title="Marca todas las pistas visibles en la tabla"
                >
                  Seleccionar página{assets.length > 0 ? ` (${assets.length})` : ""}
                </button>
                {selectedIds.size > 0 ? (
                  <button
                    type="button"
                    className="btn btn-compact danger"
                    disabled={deleteBusy}
                    onClick={() => void deleteSelection()}
                  >
                    {deleteBusy ? "…" : `Borrar selección (${selectedIds.size})`}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </header>

        {processJobActive && processJobDetail ? (
          <div className="library-sync-progress" role="status" aria-live="polite">
            <p className="small library-sync-progress-title">
              {processJobKindLabel(processJobDetail.kind)}… {processJobDetail.progressCurrent} de{" "}
              {processJobDetail.progressTotal} ({processPct}%)
            </p>
            <div
              className="library-sync-progress-bar"
              role="progressbar"
              aria-valuenow={processPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="library-sync-progress-fill" style={{ width: `${processPct}%` }} />
            </div>
          </div>
        ) : null}

        {importProgress ? (
          <p className="muted small library-import-progress" role="status">
            Importando… {importProgress.done} / {importProgress.total}
          </p>
        ) : null}

        {msg ? <p className={`library-page-msg ${msgIsSuccess(msg) ? "muted" : "error"}`}>{msg}</p> : null}

        <form className="library-filters" onSubmit={onSearch}>
          <input
            className="library-filters-search"
            value={liveQ}
            onChange={(e) => setLiveQ(e.target.value)}
            placeholder="Buscar título, artista, contexto…"
          />
          <label className="library-semantic-toggle muted small" title="Usa embeddings Ollama cuando hay consulta">
            <input
              type="checkbox"
              checked={semanticSearch}
              onChange={(e) => setSemanticSearch(e.target.checked)}
            />
            Semántica
          </label>
          <select
            className="select"
            value={genre}
            onChange={(e) => {
              setListPage(0);
              setGenre(e.target.value);
            }}
          >
            <option value="">Todos los géneros</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-compact">
            Buscar
          </button>
          <button type="button" className="btn btn-compact ghost" onClick={clearFilters}>
            Limpiar
          </button>
          {canWrite && selectedIds.size > 0 ? (
            <button
              type="button"
              className="btn btn-compact"
              disabled={metadataBusy}
              onClick={() => void enrichSelectedSemantic()}
            >
              Ollama ({selectedIds.size})
            </button>
          ) : null}
        </form>

        {(pathPrefix || genre || artistFilter || albumFilter) && (
          <p className="library-active-filters muted small">
            {pathPrefix ? <span className="library-filter-chip">Carpeta: {folderDisplayName(pathPrefix)}</span> : null}
            {genre ? <span className="library-filter-chip">Género: {genre}</span> : null}
            {artistFilter ? (
              <span className="library-filter-chip">
                Artista: {artistFilter === "__none__" ? "(Sin artista)" : artistFilter}
              </span>
            ) : null}
            {albumFilter ? <span className="library-filter-chip">Álbum: {albumFilter}</span> : null}
          </p>
        )}

        <div className="music-library-table-wrap library-table-main">
          <table className="music-library-table">
            <thead>
              <tr>
                <th className="col-cb">
                  {canWrite && token ? (
                    <input
                      type="checkbox"
                      checked={allInViewSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someInViewSelected && !allInViewSelected;
                      }}
                      disabled={assets.length === 0}
                      title={allInViewSelected ? "Deseleccionar todos" : "Seleccionar todos"}
                      aria-label={allInViewSelected ? "Deseleccionar todos" : "Seleccionar todos"}
                      onChange={toggleSelectAllInView}
                    />
                  ) : null}
                </th>
                <th className="col-cover" aria-hidden />
                <th className="col-sort">
                  <button type="button" className="music-library-th-btn" onClick={() => toggleSort("artist")}>
                    Artista{sortIndicator("artist")}
                  </button>
                </th>
                <th className="col-sort">
                  <button type="button" className="music-library-th-btn" onClick={() => toggleSort("title")}>
                    Título{sortIndicator("title")}
                  </button>
                </th>
                <th>Álbum</th>
                <th className="col-sort mono">
                  <button type="button" className="music-library-th-btn" onClick={() => toggleSort("duration")}>
                    Dur.{sortIndicator("duration")}
                  </button>
                </th>
                <th className="col-cabina-sticky">Cabina</th>
                <th className="col-info">Info</th>
                <th className="col-preview">Escuchar</th>
                {canWrite && token ? <th className="col-delete">Borrar</th> : null}
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 && !loading ? (
                <tr>
                  <td colSpan={canWrite && token ? 10 : 9} className="muted music-library-empty">
                    Sin resultados. Cree una carpeta a la izquierda, importe archivos y explore por carpeta, género o
                    artista.
                  </td>
                </tr>
              ) : (
                assets.map((a) => (
                  <tr
                    key={a.id}
                    className={`music-library-row${selectedIds.has(a.id) ? " music-library-row--selected" : ""}${canCabina ? " music-library-row--draggable" : ""}`}
                    draggable={canCabina}
                    onClick={(e) => toggleRowSelect(a.id, e)}
                    onDragStart={(e) => {
                      if (!canCabina) return;
                      if ((e.target as HTMLElement).closest("button, input, audio, a, label")) {
                        e.preventDefault();
                        return;
                      }
                      const ids = selectedIds.has(a.id) && selectedIds.size > 1 ? [...selectedIds] : [a.id];
                      setLibraryAssetDrag(e, ids);
                    }}
                    onDoubleClick={(e) => {
                      if ((e.target as HTMLElement).closest("button, input, audio, a, label")) return;
                      void sendToCabina(a.id);
                    }}
                    title={canCabina ? "Doble clic o arrastrar a Cabina" : undefined}
                  >
                    <td className="col-cb" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.id)}
                        onChange={() =>
                          setSelectedIds((prev) => {
                            const n = new Set(prev);
                            if (n.has(a.id)) n.delete(a.id);
                            else n.add(a.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="col-cover">
                      {libraryCoverUrl(a.id, a.coverPath) ? (
                        <img
                          className="music-library-thumb"
                          src={libraryCoverUrl(a.id, a.coverPath)!}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="music-library-thumb-ph">♪</span>
                      )}
                    </td>
                    <td>
                      <strong>{a.artist?.trim() || "—"}</strong>
                    </td>
                    <td>
                      {a.title}
                      {a.genre ? <span className="muted small library-row-genre"> · {a.genre}</span> : null}
                    </td>
                    <td className="small">{a.album ?? "—"}</td>
                    <td className="mono small">{fmtDur(a.durationSec)}</td>
                    <td className="col-cabina-sticky" onClick={(e) => e.stopPropagation()}>
                      {canCabina ? (
                        <button
                          type="button"
                          className="btn primary small-btn library-cabina-btn"
                          disabled={cabinaBusyId === a.id}
                          onClick={() => void sendToCabina(a.id)}
                        >
                          {cabinaBusyId === a.id ? "…" : "A cabina"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="col-info" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn-compact ghost small-btn"
                        onClick={() => setDetailAssetId(a.id)}
                        title="Información de pista"
                      >
                        Info
                      </button>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <audio
                        className="preview-audio preview-audio--table"
                        controls
                        preload="none"
                        crossOrigin="anonymous"
                        src={apiUrl(`/api/library/assets/${a.id}/stream`)}
                      />
                    </td>
                    {canWrite && token ? (
                      <td className="col-delete" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn-compact danger small-btn library-row-delete"
                          disabled={deleteBusy}
                          title="Borrar pista y archivo"
                          onClick={() => void deleteAsset(a.id)}
                        >
                          Borrar
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {libraryPager}

        {canWrite && token ? (
          <div className="music-library-footer-actions">
            <button
              type="button"
              className="btn btn-compact"
              disabled={assets.length === 0}
              onClick={selectAllInView}
            >
                  Seleccionar página{assets.length > 0 ? ` (${assets.length})` : ""}
                </button>
            <button type="button" className="btn btn-compact ghost" onClick={clearSelection} disabled={selectedIds.size === 0}>
              Ninguna
            </button>
            {canTrackInfo ? (
              <button type="button" className="btn btn-compact ghost" onClick={openTrackInfo}>
                Información de pista
              </button>
            ) : null}
            {selectedIds.size > 0 ? (
              <button
                type="button"
                className="btn btn-compact danger"
                disabled={deleteBusy}
                onClick={() => void deleteSelection()}
              >
                {deleteBusy ? "…" : `Borrar selección (${selectedIds.size})`}
              </button>
            ) : null}
            <Link to="/station" className="btn btn-compact ghost">
              Abrir cabina
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}

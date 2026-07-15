import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { apiUrl } from "../lib/api-base";
import { getPlaylistClipboard, setPlaylistClipboard } from "../playlist/playlistClipboard";
import { usePlaylistMenuBridge } from "../playlist/PlaylistMenuBridgeContext";
import type { ApiPlaylist, ApiPlaylistDetail, ApiPlaylistGenerateResult } from "@radioflow/shared";
import { PlaylistGeneratorDialog } from "../components/playlist/PlaylistGeneratorDialog";
import { VoicetrackRecordDialog } from "../components/playlist/VoicetrackRecordDialog";
import { TrackListInsertDialog } from "../components/playlist/TrackListInsertDialog";
import { StreamUrlInsertDialog } from "../components/playlist/StreamUrlInsertDialog";
import { DtmfInsertDialog } from "../components/playlist/DtmfInsertDialog";
import { TtsVoicetrackDialog } from "../components/playlist/TtsVoicetrackDialog";
import { AutoIntroDialog } from "../components/playlist/AutoIntroDialog";
import { PlaylistCmdInsertDialog } from "../components/playlist/PlaylistCmdInsertDialog";
import { InterleaveJinglesDialog } from "../components/playlist/InterleaveJinglesDialog";
import { TimeStretchDialog } from "../components/library/TimeStretchDialog";
import { PlaylistSaveInfoDialog } from "../components/playlist/PlaylistSaveInfoDialog";
import { CabinaOptionsDialog, type CabinaOptionsTab } from "../components/settings/CabinaOptionsDialog";
import { useShellLayout } from "./ShellLayoutContext";
import { isDesktopProduct, isDesktopShell } from "../lib/desktop-product";
import { canEditPlaylistsAccess, canWriteLibraryAccess, stationAccess } from "../lib/station-access";
import { ROLES_SCHEDULE_WRITE } from "@radioflow/shared";
import { allowsWebPanel } from "../lib/installable-client";
import { openAppDataFolder, openNativeAudioPaths, isRadioflowDesktop } from "../lib/desktop-native";
import { isLocalAudioFile, uploadManyToLibrary } from "../lib/local-audio-import";
import { checkDesktopUpdates } from "../lib/desktop-updates";

type MenuLeaf =
  | { kind: "item"; label: string; to?: string; onSelect?: () => void | Promise<void>; disabled?: boolean; detail?: string }
  | { kind: "divider" };

type MenuItem =
  | MenuLeaf
  | { kind: "submenu"; label: string; detail?: string; items: MenuLeaf[] };

type TopMenu = { id: string; label: string; items: MenuItem[]; panelClassName?: string };

type Props = { layout?: "menubar" | "popover" };

export function RadioflowTopMenuBar({ layout = "menubar" }: Props) {
  const navigate = useNavigate();
  const { logout, user, token } = useAuth();
  const { editor } = usePlaylistMenuBridge();
  const { toggleRails, toggleFullscreen } = useShellLayout();
  const [openId, setOpenId] = useState<string | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [voicetrackOpen, setVoicetrackOpen] = useState(false);
  const [trackListOpen, setTrackListOpen] = useState(false);
  const [streamUrlOpen, setStreamUrlOpen] = useState(false);
  const [saveInfoOpen, setSaveInfoOpen] = useState(false);
  const [dtmfOpen, setDtmfOpen] = useState(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [autoIntroOpen, setAutoIntroOpen] = useState(false);
  const [timeStretchOpen, setTimeStretchOpen] = useState(false);
  const [cabinaOptionsOpen, setCabinaOptionsOpen] = useState(false);
  const [cmdInsertOpen, setCmdInsertOpen] = useState(false);
  const [containerInsertOpen, setContainerInsertOpen] = useState(false);
  const [interleaveOpen, setInterleaveOpen] = useState(false);
  const [cabinaOptionsTab, setCabinaOptionsTab] = useState<CabinaOptionsTab>("crossfade");
  const rootRef = useRef<HTMLDivElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const addAudioFileRef = useRef<HTMLInputElement>(null);
  const [submenuOpenLabel, setSubmenuOpenLabel] = useState<string | null>(null);

  const role = user?.role;
  const loggedIn = Boolean(user);
  const canWritePlaylist = canEditPlaylistsAccess(role);
  const canLibraryTools = canWriteLibraryAccess(role);
  const isAdminish = stationAccess(role, ROLES_SCHEDULE_WRITE);

  const stretchAssetIds = useMemo(() => {
    if (!editor) return [];
    const sourceIds = editor.selectedItemIds.length > 0 ? editor.selectedItemIds : editor.itemIds;
    const ids = new Set<string>();
    for (const itemId of sourceIds) {
      const aid = editor.assetIdByItemId(itemId);
      if (aid) ids.add(aid);
    }
    return [...ids];
  }, [editor]);

  const close = useCallback(() => {
    setOpenId(null);
    setSubmenuOpenLabel(null);
  }, []);

  const requirePlaylistEditor = useCallback(
    (needWrite = true): boolean => {
      if (!editor?.playlistId) {
        window.alert("Abra una lista de reproducción en Cabina.");
        navigate("/station");
        return false;
      }
      if (needWrite && !editor.canEdit) {
        window.alert("No tiene permiso para editar esta lista.");
        return false;
      }
      return true;
    },
    [editor, navigate],
  );

  const addAudioFilesToOpenPlaylist = useCallback(
    async (files: File[]) => {
      if (!token || !editor?.playlistId || !editor.canEdit) return;
      const audio = files.filter((f) => isLocalAudioFile(f));
      if (audio.length === 0) {
        window.alert("No se seleccionaron archivos de audio.");
        return;
      }
      try {
        editor.prepareEdit?.();
        const ids = await uploadManyToLibrary(token, audio);
        await apiFetch(`/api/playlists/${encodeURIComponent(editor.playlistId)}/items/batch`, {
          method: "POST",
          token,
          body: JSON.stringify({ assetIds: ids }),
        });
        await editor.reload();
        window.alert(`${ids.length} archivo(s) añadido(s) a la lista.`);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "No se pudieron añadir los archivos");
      }
    },
    [editor, token],
  );

  const addFileToPlaylist = useCallback(async () => {
    if (!requirePlaylistEditor()) return;
    if (isRadioflowDesktop()) {
      try {
        const files = await openNativeAudioPaths();
        if (files.length) await addAudioFilesToOpenPlaylist(files);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "No se pudieron abrir los archivos");
      }
      return;
    }
    addAudioFileRef.current?.click();
  }, [addAudioFilesToOpenPlaylist, requirePlaylistEditor]);

  const addFolderToPlaylist = useCallback(() => {
    if (!requirePlaylistEditor()) return;
    if (editor?.openCatalogFill) {
      editor.openCatalogFill("folder");
      return;
    }
    navigate("/explorador");
  }, [editor, navigate, requirePlaylistEditor]);

  const openTrackListMenu = useCallback(() => {
    if (!requirePlaylistEditor()) return;
    if (editor?.openTrackList) {
      editor.openTrackList();
      return;
    }
    setTrackListOpen(true);
  }, [editor, requirePlaylistEditor]);

  const openGeneratorMenu = useCallback(() => {
    if (!token || !canWritePlaylist) {
      window.alert("Necesita sesión como editor o administrador.");
      return;
    }
    if (editor?.openGenerator) {
      editor.openGenerator();
      return;
    }
    setGeneratorOpen(true);
  }, [canWritePlaylist, editor, token]);

  const notYetAvailable = useCallback((feature: string) => {
    window.alert(`${feature} aún no está disponible en RadioFlow Studio.`);
  }, []);

  const newPlaylist = useCallback(async () => {
    if (!token || !canWritePlaylist) {
      window.alert("Necesita sesión como editor o administrador.");
      return;
    }
    if (editor?.createNewTab) {
      await editor.createNewTab();
      return;
    }
    const name = window.prompt("Nombre de la nueva lista", `Lista ${new Date().toLocaleString()}`);
    if (!name?.trim()) return;
    try {
      const pl = await apiFetch<ApiPlaylist>("/api/playlists", {
        method: "POST",
        token,
        body: JSON.stringify({ name: name.trim() }),
      });
      navigate(`/station?pl=${encodeURIComponent(pl.id)}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo crear la lista");
    }
  }, [canWritePlaylist, editor, navigate, token]);

  const saveAsPlaylist = useCallback(async () => {
    if (!editor || !token || !editor.canEdit) {
      window.alert("Abra una lista con permiso de edición y intente de nuevo.");
      return;
    }
    const name = window.prompt("Nombre de la copia", `${editor.playlistName} (copia)`);
    if (!name?.trim()) return;
    try {
      const copy = await apiFetch<ApiPlaylistDetail>(
        `/api/playlists/${encodeURIComponent(editor.playlistId)}/duplicate`,
        { method: "POST", token, body: JSON.stringify({ name: name.trim() }) },
      );
      navigate(`/station?pl=${encodeURIComponent(copy.id)}`);
      window.alert(`Copia creada: «${copy.name}»`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Error");
    }
  }, [editor, navigate, token]);

  const openDataFolder = useCallback(async () => {
    try {
      const res = await openAppDataFolder();
      if (res.ok) return;
      window.alert(res.message ?? (res.path ? `Carpeta: ${res.path}` : "No se pudo abrir la carpeta de datos."));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo abrir la carpeta de datos.");
    }
  }, []);

  const importPlaylistFile = useCallback(
    async (file: File) => {
      if (!token || !canWritePlaylist) return;
      const ext = file.name.toLowerCase();
      const format = ext.endsWith(".pls") ? "pls" : "m3u";
      const content = await file.text();
      try {
        const result = await apiFetch<{ playlistId: string; added: number; skipped: number }>(
          "/api/playlists/import-file",
          {
            method: "POST",
            token,
            body: JSON.stringify({
              format,
              content,
              name: file.name.replace(/\.(m3u8?|pls)$/i, ""),
              targetPlaylistId: editor?.canEdit ? editor.playlistId : null,
            }),
          },
        );
        if (editor?.canEdit && result.playlistId === editor.playlistId) {
          await editor.reload();
        } else {
          navigate(`/station?pl=${encodeURIComponent(result.playlistId)}`);
        }
        window.alert(`Importadas ${result.added} pista(s)${result.skipped ? ` · ${result.skipped} omitidas` : ""}.`);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "No se pudo importar");
      }
    },
    [canWritePlaylist, editor, navigate, token],
  );

  const resetPlaylistPlayed = useCallback(async () => {
    if (!editor?.playlistId || !token || !editor.canEdit) {
      window.alert("Abra una lista con permiso de edición.");
      return;
    }
    if (!window.confirm("¿Reiniciar el estado «ya sonó» de esta lista?")) return;
    try {
      await apiFetch(`/api/playlists/${encodeURIComponent(editor.playlistId)}/reset-played-status`, {
        method: "POST",
        token,
      });
      await editor.reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo reiniciar");
    }
  }, [editor, token]);

  const vaultTranscodeAll = useCallback(async () => {
    if (!token || !canLibraryTools) return;
    if (!window.confirm("¿Encolar transcodificación MP3 192k para todo el catálogo (lotes de 200)?")) return;
    try {
      const r = await apiFetch<{ jobId: string }>("/api/library/process-jobs/vault-transcode-mp3", {
        method: "POST",
        token,
      });
      window.alert(`Jobs encolados. Siga el progreso en Biblioteca → Procesar (job ${r.jobId.slice(0, 8)}…).`);
      navigate("/library?tool=process");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo encolar");
    }
  }, [canLibraryTools, navigate, token]);

  const exportPlaylistJson = useCallback(() => {
    if (!editor) {
      window.alert("Abra una lista en Cabina para exportar.");
      return;
    }
    const payload = {
      name: editor.playlistName,
      exportedAt: new Date().toISOString(),
      items: editor.itemIds.map((id) => ({
        itemId: id,
        assetId: editor.assetIdByItemId(id),
        title: editor.titleByItemId(id),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${editor.playlistName.replace(/[^\w\-]+/g, "_") || "playlist"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [editor]);

  const downloadPlaylistExport = useCallback(
    async (format: "m3u" | "pls") => {
      if (!editor?.playlistId || !token) {
        window.alert("Abra una lista con sesión iniciada.");
        return;
      }
      try {
        const res = await fetch(
          apiUrl(`/api/playlists/${encodeURIComponent(editor.playlistId)}/export?format=${format}`),
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const ext = format === "m3u" ? "m3u" : "pls";
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${editor.playlistName.replace(/[^\w\-]+/g, "_") || "playlist"}.${ext}`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "No se pudo exportar");
      }
    },
    [editor, token],
  );

  const renderPlaylistOffline = useCallback(async () => {
    if (!editor?.playlistId || !token) {
      window.alert("Abra una lista con sesión iniciada.");
      return;
    }
    const pick = window.prompt("Formato de mezcla offline: wav o mp3", "mp3");
    if (!pick) return;
    const format = pick.trim().toLowerCase() === "wav" ? "wav" : "mp3";
    try {
      const { jobId } = await apiFetch<{ jobId: string }>(
        `/api/playlists/${encodeURIComponent(editor.playlistId)}/render`,
        { method: "POST", token, body: JSON.stringify({ format }) },
      );
      window.alert(
        `Render encolado (${format.toUpperCase()}). Job ${jobId.slice(0, 8)}… — el archivo aparecerá en uploads/renders al completar.`,
      );
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo encolar el render");
    }
  }, [editor, token]);

  const quickGenrePlaylist = useCallback(async () => {
    if (!token || !canWritePlaylist) {
      window.alert("Necesita sesión como editor o administrador.");
      return;
    }
    if (editor?.openCatalogFill) {
      editor.openCatalogFill("genre");
      return;
    }
    const genre = window.prompt("Género para generar la lista (según metadatos en la librería)", "Pop");
    if (!genre?.trim()) return;
    try {
      const detail = await apiFetch<ApiPlaylistDetail>("/api/playlists/from-genre", {
        method: "POST",
        token,
        body: JSON.stringify({ genre: genre.trim() }),
      });
      navigate(`/station?pl=${encodeURIComponent(detail.id)}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo generar la lista");
    }
  }, [canWritePlaylist, editor, navigate, token]);

  const onPlaylistGenerated = useCallback(
    (result: ApiPlaylistGenerateResult) => {
      navigate(`/station?pl=${encodeURIComponent(result.playlistId)}`);
    },
    [navigate],
  );

  const showDuplicatesInEditor = useCallback(() => {
    if (!editor) {
      window.alert("Abra una lista para buscar duplicados.");
      return;
    }
    const byAsset = new Map<string, string[]>();
    for (const itemId of editor.itemIds) {
      const aid = editor.assetIdByItemId(itemId);
      if (!aid) continue;
      const t = byAsset.get(aid) ?? [];
      t.push(itemId);
      byAsset.set(aid, t);
    }
    const dups = [...byAsset.entries()].filter(([, ids]) => ids.length > 1);
    if (dups.length === 0) {
      window.alert("No hay pistas duplicadas (mismo medio) en esta lista.");
      return;
    }
    const lines = dups.map(([assetId, ids]) => {
      const title = editor.titleByItemId(ids[0]) ?? assetId;
      return `· ${title} — ${ids.length} veces`;
    });
    window.alert(`Duplicados por medio:\n\n${lines.join("\n")}`);
  }, [editor]);

  const insertAdBreakNow = useCallback(async () => {
    if (!token) {
      window.alert("Inicia sesión para insertar publicidad.");
      return;
    }
    try {
      const result = await apiFetch<{ insertedCount: number }>("/api/ads/break", {
        method: "POST",
        token,
        body: JSON.stringify({}),
      });
      window.alert(`${result.insertedCount} spot(s) encolado(s) después de la pista al aire.`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo insertar el bloque publicitario");
    }
  }, [token]);

  const insertPlaylistCommand = useCallback(
    async (kind: "pause" | "marker" | "note" | "hour_marker") => {
      if (!editor?.insertCommand) {
        window.alert("Abra una lista en Cabina.");
        return;
      }
      if (kind === "pause") {
        const raw = window.prompt("Duración de la pausa (segundos)", "5");
        if (raw === null) return;
        const pauseSec = Math.max(0, Math.min(3600, Number.parseInt(raw, 10) || 0));
        const label = window.prompt("Etiqueta opcional (vacío = predeterminado)", "")?.trim();
        await editor.insertCommand("pause", { pauseSec, label: label || undefined });
        return;
      }
      if (kind === "hour_marker") {
        await editor.insertCommand("hour_marker");
        return;
      }
      const label = window.prompt(
        kind === "marker" ? "Nombre del marcador (opcional)" : "Texto de la nota",
        "",
      )?.trim();
      await editor.insertCommand(kind, { label: label || undefined });
    },
    [editor],
  );

  const copyCutSelection = useCallback(
    (mode: "copy" | "cut") => {
      if (!editor?.canEdit) return;
      const ids = editor.selectedItemIds;
      if (ids.length === 0) {
        window.alert("Seleccione una o más pistas en la lista (clic en la fila).");
        return;
      }
      const entries = ids
        .map((itemId) => {
          const assetId = editor.assetIdByItemId(itemId);
          return assetId ? { itemId, assetId } : null;
        })
        .filter((x): x is { itemId: string; assetId: string } => x !== null);
      if (entries.length === 0) return;
      setPlaylistClipboard({ mode, sourcePlaylistId: editor.playlistId, entries });
      if (mode === "cut") void editor.removeItems(ids);
    },
    [editor],
  );

  const pasteIntoEditor = useCallback(async () => {
    if (!editor?.canEdit || !token) return;
    const clip = getPlaylistClipboard();
    if (!clip?.entries.length) {
      window.alert("No hay nada copiado o cortado desde una lista.");
      return;
    }
    const assetIds = clip.entries.map((e) => e.assetId);
    try {
      await apiFetch(`/api/playlists/${editor.playlistId}/items/batch`, {
        method: "POST",
        token,
        body: JSON.stringify({ assetIds }),
      });
      setPlaylistClipboard(null);
      await editor.reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Error al pegar");
    }
  }, [editor, token]);

  const cropSelection = useCallback(() => {
    if (!editor?.canEdit) return;
    const keep = new Set(editor.selectedItemIds);
    if (keep.size === 0) {
      window.alert("Seleccione las pistas que desea conservar; el resto se eliminará.");
      return;
    }
    const remove = editor.itemIds.filter((id) => !keep.has(id));
    if (remove.length === 0) {
      window.alert("No hay nada que recortar.");
      return;
    }
    if (!window.confirm(`Eliminar ${remove.length} pista(s) que no están seleccionadas?`)) return;
    void editor.removeItems(remove);
  }, [editor]);

  const menus: TopMenu[] = useMemo(
    () => [
      {
        id: "file",
        label: "Archivo",
        items: [
          {
            kind: "item",
            label: "Nueva lista…",
            disabled: !token || !canWritePlaylist,
            detail: !canWritePlaylist ? "Solo editor o admin" : "Crear y abrir",
            onSelect: () => void newPlaylist(),
          },
          { kind: "item", label: "Abrir…", to: "/playlists", detail: "Elegir lista" },
          {
            kind: "item",
            label: "Importar lista…",
            disabled: !token || !canWritePlaylist,
            detail: "M3U / PLS · añade a la lista abierta o crea nueva",
            onSelect: () => importFileRef.current?.click(),
          },
          {
            kind: "item",
            label: "Guardar",
            disabled: !editor?.canEdit,
            detail: "Auto-guardado en servidor · estado de la lista",
            onSelect: () => setSaveInfoOpen(true),
          },
          {
            kind: "item",
            label: "Guardar como…",
            disabled: !editor?.canEdit,
            detail: "Duplicar lista con todos los ítems",
            onSelect: () => void saveAsPlaylist(),
          },
          {
            kind: "item",
            label: "Abrir carpeta de datos…",
            detail: isDesktopShell() ? "SQLite, logs y caché local" : "Servidor o app de escritorio",
            onSelect: () => void openDataFolder(),
          },
          {
            kind: "item",
            label: "Exportar JSON…",
            disabled: !editor,
            detail: "Lista abierta",
            onSelect: () => exportPlaylistJson(),
          },
          {
            kind: "item",
            label: "Exportar M3U…",
            disabled: !editor?.playlistId || !token,
            detail: "Rutas de bóveda",
            onSelect: () => void downloadPlaylistExport("m3u"),
          },
          {
            kind: "item",
            label: "Exportar PLS…",
            disabled: !editor?.playlistId || !token,
            detail: "Winamp / PLS",
            onSelect: () => void downloadPlaylistExport("pls"),
          },
          { kind: "item", label: "Exportar / informes…", to: "/reports" },
          { kind: "divider" },
          { kind: "item", label: "Salir", detail: "Cerrar sesión" },
        ],
      },
      {
        id: "edit",
        label: "Edición",
        items: [
          {
            kind: "item",
            label: "Deshacer",
            disabled: !editor?.canUndo,
            onSelect: () => void editor?.undo?.(),
          },
          {
            kind: "item",
            label: "Rehacer",
            disabled: !editor?.canRedo,
            onSelect: () => void editor?.redo?.(),
          },
          {
            kind: "item",
            label: "Cortar",
            disabled: !editor?.canEdit || editor.selectedItemIds.length === 0,
            onSelect: () => copyCutSelection("cut"),
          },
          {
            kind: "item",
            label: "Copiar",
            disabled: !editor?.canEdit || editor.selectedItemIds.length === 0,
            onSelect: () => copyCutSelection("copy"),
          },
          {
            kind: "item",
            label: "Pegar",
            disabled: !editor?.canEdit,
            detail: "Añade lo copiado o cortado al final",
            onSelect: () => void pasteIntoEditor(),
          },
          { kind: "divider" },
          {
            kind: "item",
            label: "Seleccionar todo",
            disabled: !editor?.canEdit || editor.itemIds.length === 0,
            onSelect: () => editor?.selectAll(),
          },
          {
            kind: "item",
            label: "Seleccionar nada",
            disabled: !editor?.canEdit,
            onSelect: () => editor?.selectNone(),
          },
          {
            kind: "item",
            label: "Invertir selección",
            disabled: !editor?.canEdit || editor.itemIds.length === 0,
            onSelect: () => editor?.invertSelection(),
          },
          {
            kind: "item",
            label: "Recortar selección",
            disabled: !editor?.canEdit || editor.selectedItemIds.length === 0,
            detail: "Dejar solo las seleccionadas",
            onSelect: () => cropSelection(),
          },
          {
            kind: "item",
            label: "Eliminar",
            disabled: !editor?.canEdit || editor.selectedItemIds.length === 0,
            onSelect: () => {
              if (!editor?.canEdit) return;
              if (!window.confirm(`Quitar ${editor.selectedItemIds.length} pista(s) de la lista?`)) return;
              void editor.removeItems(editor.selectedItemIds);
            },
          },
          {
            kind: "item",
            label: "Eliminar todo",
            disabled: !editor?.canEdit || editor.itemIds.length === 0,
            onSelect: () => {
              if (!editor?.canEdit) return;
              if (!window.confirm("Vaciar toda la lista?")) return;
              void editor.removeItems(editor.itemIds);
            },
          },
        ],
      },
      {
        id: "view",
        label: "Vista",
        items: [
          { kind: "item", label: "Cabina…", to: "/station", detail: "Lista al aire y transporte" },
          { kind: "item", label: "Abrir lista…", to: "/playlists", detail: "Elegir lista guardada" },
          { kind: "item", label: "Librería…", to: "/library", detail: "Biblioteca musical" },
          { kind: "item", label: "Explorador de archivos…", to: "/explorador" },
          { kind: "item", label: "Parrilla…", to: "/schedule", detail: "Programación" },
          { kind: "item", label: "Streaming…", to: "/emitir", detail: "Emitir a Internet" },
          { kind: "item", label: "Informes…", to: "/reports" },
          { kind: "item", label: "Marca / opciones…", to: "/settings" },
          { kind: "item", label: "Panel…", to: "/panel", disabled: !loggedIn },
          ...(isDesktopShell()
            ? ([
                {
                  kind: "item" as const,
                  label: "Escritorio…",
                  to: "/desktop",
                  detail: "API embebida, VU HUD, actualizaciones",
                },
                ...(allowsWebPanel() && !isDesktopProduct()
                  ? ([
                      {
                        kind: "item" as const,
                        label: "Servidor API…",
                        to: "/conexion",
                        detail: "URL del backend (solo CI)",
                      },
                    ] satisfies MenuItem[])
                  : []),
              ] satisfies MenuItem[])
            : []),
          { kind: "divider" },
          { kind: "item", label: "Búsqueda en librería", to: "/library" },
          { kind: "item", label: "Programador de eventos…", to: "/scheduler", disabled: !isAdminish },
          { kind: "item", label: "Editor de voicetrack…", to: "/voicetrack", detail: "Grabar, trim y ducking" },
          { kind: "item", label: "Efectos (FX)", to: "/fx" },
          {
            kind: "item",
            label: "Paneles laterales",
            detail: "Programador, pedidos y cola (ocultos por defecto)",
            onSelect: () => toggleRails(),
          },
          { kind: "divider" },
          { kind: "item", label: "Información de pista…", to: "/library", detail: "Biblioteca · ID3 y ganancia" },
          {
            kind: "item",
            label: "Pantalla completa",
            onSelect: () => void toggleFullscreen(),
          },
        ],
      },
      {
        id: "playlist",
        label: "Lista de reproducción",
        panelClassName: "shell-menu-panel--playlist",
        items: [
          {
            kind: "item",
            label: "Generador de lista Pro…",
            disabled: !token || !canWritePlaylist,
            detail: "Playlist Generator Pro",
            onSelect: () => openGeneratorMenu(),
          },
          { kind: "divider" },
          {
            kind: "item",
            label: "Añadir archivo…",
            disabled: !editor?.canEdit || !token,
            onSelect: () => void addFileToPlaylist(),
          },
          {
            kind: "item",
            label: "Añadir carpeta…",
            disabled: !editor?.canEdit || !token,
            detail: "Todas las pistas de una carpeta de la bóveda",
            onSelect: () => addFolderToPlaylist(),
          },
          {
            kind: "item",
            label: "Añadir URL…",
            disabled: !editor?.canEdit || !editor.playlistId || !token,
            detail: "Stream http(s) o podcast",
            onSelect: () => {
              if (!requirePlaylistEditor()) return;
              setStreamUrlOpen(true);
            },
          },
          {
            kind: "item",
            label: "Añadir comando…",
            disabled: !editor?.playlistId || !token || !canWritePlaylist,
            onSelect: () => {
              if (!requirePlaylistEditor()) return;
              setCmdInsertOpen(true);
            },
          },
          {
            kind: "item",
            label: "Añadir pausa temporizada…",
            disabled: !editor?.insertCommand,
            onSelect: () => void insertPlaylistCommand("pause"),
          },
          {
            kind: "item",
            label: "Añadir teaser…",
            disabled: !token,
            detail: "Anuncio automático de próximos temas",
            onSelect: () => notYetAvailable("Añadir teaser"),
          },
          {
            kind: "item",
            label: "Añadir locución horaria…",
            disabled: !token,
            detail: "Configurar carpetas e intervalo de locución",
            onSelect: () => navigate("/settings#locucion-horaria"),
          },
          {
            kind: "item",
            label: "Añadir comentario…",
            disabled: !editor?.insertCommand,
            detail: "Nota visible en la lista (no se reproduce)",
            onSelect: () => void insertPlaylistCommand("note"),
          },
          {
            kind: "item",
            label: "Añadir container",
            disabled: !editor?.playlistId || !token || !canWritePlaylist,
            detail: "Lista anidada que se expande al reproducir",
            onSelect: () => {
              if (!requirePlaylistEditor()) return;
              setContainerInsertOpen(true);
            },
          },
          {
            kind: "item",
            label: "Insertar lista",
            disabled: !editor?.playlistId || !token || !canWritePlaylist,
            detail: "Inserta otra lista como container",
            onSelect: () => {
              if (!requirePlaylistEditor()) return;
              setContainerInsertOpen(true);
            },
          },
          {
            kind: "item",
            label: "Añadir pistas de otra lista…",
            disabled: !editor?.canEdit || !editor.openCatalogFill,
            onSelect: () => {
              if (!requirePlaylistEditor()) return;
              editor?.openCatalogFill?.("playlist");
            },
          },
          {
            kind: "item",
            label: "Insertar voicetrack…",
            disabled: !editor?.playlistId || !token || !canWritePlaylist,
            onSelect: () => {
              if (!requirePlaylistEditor()) return;
              setVoicetrackOpen(true);
            },
          },
          {
            kind: "item",
            label: "Grabar voicetrack…",
            disabled: !editor?.playlistId || !token || !canWritePlaylist,
            detail: "Abre la herramienta de grabación",
            onSelect: () => {
              if (!requirePlaylistEditor()) return;
              setVoicetrackOpen(true);
            },
          },
          {
            kind: "item",
            label: "Agregar lista de pistas…",
            disabled: !token || !canWritePlaylist || (!editor?.openTrackList && !editor?.playlistId),
            detail: "Un ítem dinámico: 1 pista del origen al llegar su turno",
            onSelect: () => openTrackListMenu(),
          },
          {
            kind: "item",
            label: "Protección de repetición de lista de pistas…",
            disabled: !token,
            detail: "Reglas anti-repetición al expandir listas de pistas",
            onSelect: () => navigate("/settings#track-list-repeat"),
          },
          { kind: "divider" },
          {
            kind: "item",
            label: "Insertar bloque publicitario ahora",
            disabled: !token,
            detail: "Spots del planificador después de la pista al aire (B3)",
            onSelect: () => void insertAdBreakNow(),
          },
          {
            kind: "item",
            label: "Planificador de publicidad…",
            to: "/ads",
            disabled: !loggedIn,
          },
          {
            kind: "submenu",
            label: "Extra",
            items: [
              {
                kind: "item",
                label: "Añadir Text-to-Speech…",
                disabled: !editor?.playlistId || !token || !canWritePlaylist,
                onSelect: () => {
                  if (!requirePlaylistEditor()) return;
                  setTtsOpen(true);
                },
              },
              {
                kind: "item",
                label: "Añadir generador de tono DTMF",
                disabled: !editor?.insertCommand || !editor.canEdit,
                onSelect: () => {
                  if (!requirePlaylistEditor()) return;
                  setDtmfOpen(true);
                },
              },
            ],
          },
          { kind: "divider" },
          {
            kind: "item",
            label: "Mostrar duplicados",
            disabled: !editor,
            onSelect: () => showDuplicatesInEditor(),
          },
          {
            kind: "item",
            label: "Mostrar archivos inexistentes",
            disabled: !editor?.showMissingInVault,
            onSelect: () => void editor?.showMissingInVault?.(),
          },
          {
            kind: "item",
            label: "Mezclar",
            disabled: !editor?.canEdit || editor.itemIds.length < 2,
            onSelect: () => void editor?.shuffleOrder(),
          },
          {
            kind: "item",
            label: "Recargar información de pistas",
            disabled: !editor?.canEdit || !editor.syncMetadata,
            detail: "Forzar relectura de etiquetas desde la bóveda",
            onSelect: () => void editor?.syncMetadata?.(),
          },
          {
            kind: "item",
            label: "Copiar a carpeta…",
            disabled: true,
            detail: "Aún no disponible",
            onSelect: () => notYetAvailable("Copiar a carpeta"),
          },
          {
            kind: "item",
            label: "Eliminar archivos del disco",
            disabled: true,
            detail: "Use Librería → eliminar con cuidado",
            onSelect: () => notYetAvailable("Eliminar archivos del disco"),
          },
          {
            kind: "item",
            label: "Generador de lista…",
            disabled: true,
            detail: "Obsoleto · use Generador de lista Pro",
          },
          {
            kind: "item",
            label: "Reiniciar estado «ya sonó»",
            disabled: !editor?.canEdit || !token,
            onSelect: () => void resetPlaylistPlayed(),
          },
          {
            kind: "item",
            label: "Protección de repetición de sweepers",
            disabled: !token,
            onSelect: () => navigate("/ads"),
          },
          {
            kind: "item",
            label: "Bloc de notas…(T)",
            disabled: !editor?.insertCommand,
            detail: "Nota en la pista (aparece al reproducir en RadioBOSS)",
            onSelect: () => void insertPlaylistCommand("note"),
          },
          {
            kind: "item",
            label: "Buscar…",
            disabled: !editor,
            onSelect: () => editor?.focusFind(),
          },
        ],
      },
      {
        id: "tools",
        label: "Herramientas",
        items: [
          { kind: "item", label: "Biblioteca musical…", to: "/library", detail: "Abrir ventana de catálogo" },
          {
            kind: "item",
            label: "Procesar pistas…",
            to: "/library?tool=process",
            disabled: !token || !canLibraryTools,
            detail: "Normalizar / BPM",
          },
          {
            kind: "item",
            label: "Convertir biblioteca a MP3…",
            disabled: !token || !canLibraryTools,
            detail: "Transcodificar toda la bóveda (lotes)",
            onSelect: () => void vaultTranscodeAll(),
          },
          {
            kind: "item",
            label: "Comprobar pistas…",
            to: "/library?tool=check",
            disabled: !token || !canLibraryTools,
          },
          {
            kind: "item",
            label: "Verificar biblioteca…",
            to: "/library?tool=verify",
            disabled: !token || !canLibraryTools,
            detail: "Entradas huérfanas",
          },
          {
            kind: "item",
            label: "Actualización automática…",
            to: "/library?tool=auto-update",
            disabled: !token || !canLibraryTools,
            detail: "Escanear carpetas en bóveda",
          },
          { kind: "item", label: "Generador de informes…", to: "/reports", detail: "Play-log" },
          { kind: "divider" },
          {
            kind: "item",
            label: "Planificador de publicidad…",
            to: "/ads",
            disabled: !token || !canLibraryTools,
            detail: "Spots, intervalos y rotación",
          },
          {
            kind: "item",
            label: "Auto intro…",
            disabled: !editor?.playlistId || !token || !canWritePlaylist,
            detail: "Intros por artista desde carpeta intros/",
            onSelect: () => {
              if (!editor?.playlistId || !token || !canWritePlaylist) {
                window.alert("Abra una lista con permiso de edición.");
                return;
              }
              setAutoIntroOpen(true);
            },
          },
          { kind: "divider" },
          { kind: "item", label: "Estadísticas de transmisión…", to: "/emitir" },
          { kind: "item", label: "Título del cast…", to: "/emitir", detail: "Metadatos Icecast" },
          { kind: "item", label: "Cola de reproducción…", to: "/station" },
          { kind: "item", label: "Pedidos de canciones…", to: "/requests" },
          {
            kind: "item",
            label: "Protección repetición pedidos…",
            to: "/requests?protection=1",
            disabled: !token || !canLibraryTools,
            detail: "Cooldown por artista / título",
          },
          {
            kind: "item",
            label: "Time stretch…",
            disabled: !token || !canLibraryTools || stretchAssetIds.length === 0,
            detail: "Tempo sin cambiar tono (ffmpeg)",
            onSelect: () => {
              if (!token || !canLibraryTools) {
                window.alert("Necesita permiso de biblioteca.");
                return;
              }
              if (stretchAssetIds.length === 0) {
                window.alert("Seleccione pistas en la lista abierta o abra una con medios.");
                return;
              }
              setTimeStretchOpen(true);
            },
          },
          {
            kind: "item",
            label: "Renderizar playlist a archivo…",
            disabled: !editor?.playlistId || !token,
            detail: "Mezcla offline WAV/MP3 (ffmpeg)",
            onSelect: () => void renderPlaylistOffline(),
          },
          {
            kind: "item",
            label: "Archivo de stream…",
            to: "/emitir",
            detail: "Estado encoder · reproductor web",
          },
          {
            kind: "item",
            label: "Mesa de mezclas virtual…",
            to: "/fx",
            detail: "EQ y efectos en cabina",
          },
        ],
      },
      {
        id: "jingles",
        label: "Jingles",
        items: [
          { kind: "item", label: "Abrir cart wall…", to: "/jingles" },
          {
            kind: "item",
            label: "Asignar pistas a teclas…",
            detail: "Cart wall 1–0 · páginas A/B/C",
            onSelect: () => navigate("/jingles?assign=1"),
          },
        ],
      },
      {
        id: "settings",
        label: "Configuración",
        items: [
          { kind: "item", label: "Opciones…", to: "/settings", detail: "Marca, logo, color" },
          {
            kind: "item",
            label: "Emitir…",
            to: "/emitir",
            detail: "Icecast, encoder, reproductor web — todo en una pantalla",
          },
          {
            kind: "item",
            label: "Teclas rápidas…",
            onSelect: () => {
              setCabinaOptionsTab("hotkeys");
              setCabinaOptionsOpen(true);
            },
          },
          {
            kind: "item",
            label: "Fundidos cruzados…",
            onSelect: () => {
              setCabinaOptionsTab("crossfade");
              setCabinaOptionsOpen(true);
            },
          },
          {
            kind: "item",
            label: "Nivelación automática…",
            onSelect: () => {
              setCabinaOptionsTab("leveling");
              setCabinaOptionsOpen(true);
            },
          },
          {
            kind: "item",
            label: "Procesamiento (AGC/compresor)…",
            onSelect: () => {
              setCabinaOptionsTab("processing");
              setCabinaOptionsOpen(true);
            },
          },
        ],
      },
      {
        id: "help",
        label: "Ayuda",
        items: [
          { kind: "item", label: "Contenidos", to: "/help" },
          { kind: "item", label: "Marca y datos públicos", to: "/settings" },
          ...(isDesktopShell()
            ? ([
                {
                  kind: "item" as const,
                  label: "Buscar actualizaciones…",
                  detail: "Canal del instalador Electron",
                  onSelect: () => void checkDesktopUpdates().then((r) => {
                    if (r.status === "unavailable") {
                      window.alert("Use la aplicación instalada o Vista → Escritorio…");
                    }
                  }),
                },
              ] satisfies MenuItem[])
            : []),
          { kind: "divider" },
          {
            kind: "item",
            label: "Acerca de RadioFlow Studio…",
            onSelect: () =>
              window.alert(
                "RadioFlow Studio\nAutomatización y cabina para radio.\n\nAutomatización y cabina para radio.",
              ),
          },
        ],
      },
      {
        id: "user",
        label: "Usuario",
        items: [
          {
            kind: "item",
            label: "Administración…",
            to: "/admin",
            disabled: role !== "admin",
          },
          {
            kind: "item",
            label: "Panel de control",
            to: "/panel",
            disabled: !loggedIn,
          },
        ],
      },
    ],
    [
      editor,
      role,
      loggedIn,
      token,
      canWritePlaylist,
      canLibraryTools,
      isAdminish,
      newPlaylist,
      saveAsPlaylist,
      exportPlaylistJson,
      downloadPlaylistExport,
      renderPlaylistOffline,
      quickGenrePlaylist,
      showDuplicatesInEditor,
      insertAdBreakNow,
      insertPlaylistCommand,
      resetPlaylistPlayed,
      copyCutSelection,
      pasteIntoEditor,
      cropSelection,
      navigate,
      toggleRails,
      toggleFullscreen,
      stretchAssetIds,
      addFileToPlaylist,
      addFolderToPlaylist,
      openTrackListMenu,
      openGeneratorMenu,
      requirePlaylistEditor,
      notYetAvailable,
    ],
  );

  useEffect(() => {
    if (!openId) return;
    /* click (captura): cerrar solo si el clic fue fuera del menú; mousedown a veces compite con botones bajo el panel */
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId, close]);

  async function runItem(menuId: string, item: MenuLeaf) {
    if (item.kind !== "item" || item.disabled) return;

    if (menuId === "file" && item.label === "Salir") {
      if (user) logout();
      navigate("/login");
      close();
      return;
    }

    if (item.to) {
      navigate(item.to);
      close();
      return;
    }
    if (item.onSelect) {
      close();
      const run = item.onSelect;
      setTimeout(() => void run(), 0);
      return;
    }
  }

  function renderMenuLeaf(menuId: string, item: MenuLeaf, idx: number) {
    if (item.kind === "divider") {
      return <div key={`d-${menuId}-${idx}`} className="shell-menu-divider" role="separator" />;
    }
    return (
      <button
        key={`${item.label}-${idx}`}
        type="button"
        role="menuitem"
        className={`shell-menu-item${item.disabled ? " is-disabled" : ""}`}
        disabled={item.disabled}
        title={item.detail}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={() => void runItem(menuId, item)}
      >
        <span className="shell-menu-item-label">{item.label}</span>
      </button>
    );
  }

  return (
    <>
      <div
        ref={rootRef}
        className={`shell-top-menus${layout === "popover" ? " shell-top-menus--popover" : ""}`}
        role="menubar"
        aria-label="Menú principal estilo cabina"
      >
      {menus.map((menu) => {
        const open = openId === menu.id;
        return (
          <div key={menu.id} className={`shell-menu-root${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="shell-menu-trigger"
              aria-haspopup="true"
              aria-expanded={open}
              onClick={() => {
                setSubmenuOpenLabel(null);
                setOpenId(open ? null : menu.id);
              }}
            >
              {menu.label}
            </button>
            {open ? (
              <div
                className={`shell-menu-panel${menu.panelClassName ? ` ${menu.panelClassName}` : ""}`}
                role="menu"
              >
                {menu.items.map((item, idx) => {
                  if (item.kind === "divider") {
                    return <div key={`d-${menu.id}-${idx}`} className="shell-menu-divider" role="separator" />;
                  }
                  if (item.kind === "submenu") {
                    const flyoutOpen = submenuOpenLabel === item.label;
                    return (
                      <div key={`sub-${item.label}-${idx}`} className={`shell-menu-submenu${flyoutOpen ? " is-open" : ""}`}>
                        <button
                          type="button"
                          role="menuitem"
                          aria-haspopup="true"
                          aria-expanded={flyoutOpen}
                          className="shell-menu-item shell-menu-item--submenu"
                          title={item.detail}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSubmenuOpenLabel((cur) => (cur === item.label ? null : item.label));
                          }}
                        >
                          <span className="shell-menu-item-label">{item.label}</span>
                          <span className="shell-menu-item-caret" aria-hidden>
                            {flyoutOpen ? "▾" : "▸"}
                          </span>
                        </button>
                        {flyoutOpen ? (
                          <div className="shell-menu-flyout shell-menu-flyout--inline" role="menu">
                            {item.items.map((sub, subIdx) => renderMenuLeaf(menu.id, sub, subIdx))}
                          </div>
                        ) : null}
                      </div>
                    );
                  }
                  return renderMenuLeaf(menu.id, item, idx);
                })}
              </div>
            ) : null}
          </div>
        );
      })}
      </div>
      <input
        ref={addAudioFileRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac"
        style={{ display: "none" }}
        onChange={(e) => {
          const list = e.target.files;
          if (!list?.length) return;
          void addAudioFilesToOpenPlaylist(Array.from(list));
          e.target.value = "";
        }}
      />
      {token && canWritePlaylist ? (
        <PlaylistGeneratorDialog
          open={generatorOpen}
          token={token}
          onClose={() => setGeneratorOpen(false)}
          onGenerated={onPlaylistGenerated}
        />
      ) : null}
      {token && editor?.playlistId ? (
        <StreamUrlInsertDialog
          open={streamUrlOpen}
          token={token}
          playlistId={editor.playlistId}
          insertAfterItemId={editor.selectedItemIds.at(-1) ?? null}
          onClose={() => setStreamUrlOpen(false)}
          onInserted={() => {
            void editor.reload();
          }}
        />
      ) : null}
      {token && editor?.playlistId ? (
        <TrackListInsertDialog
          open={trackListOpen}
          token={token}
          playlistId={editor.playlistId}
          insertAfterItemId={editor.selectedItemIds.at(-1) ?? null}
          onClose={() => setTrackListOpen(false)}
          onInserted={() => {
            void editor.reload();
          }}
        />
      ) : null}
      {token && editor?.playlistId ? (
        <InterleaveJinglesDialog
          open={interleaveOpen}
          playlistId={editor.playlistId}
          selectedItemIds={editor.selectedItemIds}
          onClose={() => setInterleaveOpen(false)}
          onDone={() => {
            void editor.reload();
          }}
          onBeforeApply={() => editor.prepareEdit?.()}
        />
      ) : null}
      {token && editor?.playlistId ? (
        <PlaylistCmdInsertDialog
          open={cmdInsertOpen}
          mode="cmd"
          playlistId={editor.playlistId}
          insertAfterItemId={editor.selectedItemIds.at(-1) ?? null}
          onClose={() => setCmdInsertOpen(false)}
          onInserted={() => {
            void editor.reload();
          }}
        />
      ) : null}
      {token && editor?.playlistId ? (
        <PlaylistCmdInsertDialog
          open={containerInsertOpen}
          mode="container"
          playlistId={editor.playlistId}
          insertAfterItemId={editor.selectedItemIds.at(-1) ?? null}
          onClose={() => setContainerInsertOpen(false)}
          onInserted={() => {
            void editor.reload();
          }}
        />
      ) : null}
      {token && editor?.playlistId ? (
        <VoicetrackRecordDialog
          open={voicetrackOpen}
          token={token}
          playlistId={editor.playlistId}
          insertAfterItemId={editor.selectedItemIds.at(-1) ?? null}
          onClose={() => setVoicetrackOpen(false)}
          onInserted={() => {
            void editor.reload();
          }}
        />
      ) : null}
      {token && editor?.playlistId ? (
        <TtsVoicetrackDialog
          open={ttsOpen}
          token={token}
          playlistId={editor.playlistId}
          insertAfterItemId={editor.selectedItemIds.at(-1) ?? null}
          onClose={() => setTtsOpen(false)}
          onInserted={() => {
            void editor.reload();
          }}
        />
      ) : null}
      {token && editor?.playlistId ? (
        <AutoIntroDialog
          open={autoIntroOpen}
          token={token}
          playlistId={editor.playlistId}
          onClose={() => setAutoIntroOpen(false)}
          onApplied={() => {
            void editor.reload();
          }}
        />
      ) : null}
      {token ? (
        <TimeStretchDialog
          open={timeStretchOpen}
          token={token}
          assetIds={stretchAssetIds}
          onClose={() => setTimeStretchOpen(false)}
          onJobQueued={() => {
            window.alert("Time stretch encolado. Siga el progreso en Biblioteca → Procesar pistas.");
          }}
        />
      ) : null}
      <DtmfInsertDialog
        open={dtmfOpen}
        onClose={() => setDtmfOpen(false)}
        onSelect={async (digit) => {
          if (!editor?.insertCommand) {
            window.alert("Abra una lista editable.");
            return;
          }
          await editor.insertCommand("dtmf", { label: digit });
        }}
      />
      <CabinaOptionsDialog
        open={cabinaOptionsOpen}
        initialTab={cabinaOptionsTab}
        onClose={() => setCabinaOptionsOpen(false)}
      />
      {token && editor?.playlistId ? (
        <PlaylistSaveInfoDialog
          open={saveInfoOpen}
          token={token}
          playlistId={editor.playlistId}
          playlistName={editor.playlistName}
          itemCount={editor.itemIds.length}
          onClose={() => setSaveInfoOpen(false)}
        />
      ) : null}
      <input
        ref={importFileRef}
        type="file"
        accept=".m3u,.m3u8,.pls,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importPlaylistFile(f);
        }}
      />
    </>
  );
}

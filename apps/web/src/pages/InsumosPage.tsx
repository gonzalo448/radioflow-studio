import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { canWriteLibraryAccess } from "../lib/station-access";
import { useAuth } from "../auth/AuthContext";
import { LibraryUserFoldersPanel } from "../components/library/LibraryUserFoldersPanel";
import { getStoredActiveFolder, setStoredActiveFolder } from "../lib/library-active-folder";
import { DesktopFolderExplorer } from "../components/DesktopFolderExplorer";
import { filesFromAbsolutePaths, isRadioflowDesktop } from "../lib/desktop-native";
import {
  DND_NATIVE_PATHS_MIME,
  isLocalAudioFile,
  notifyStationRefresh,
  uploadManyToLibrary,
  importNativePathsToLibrary,
  formatImportSummaryMessage,
} from "../lib/local-audio-import";
import { apiFetch } from "../lib/api";

/** Explorador de carpetas / unidades: usable sin sesión; subida con permiso de librería. */
export function InsumosPage() {
  const { token, user } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [pickedLocalFiles, setPickedLocalFiles] = useState<File[]>([]);
  const [pickedNativePaths, setPickedNativePaths] = useState<string[]>([]);
  const [explorerBusy, setExplorerBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [enqueueAfterUpload, setEnqueueAfterUpload] = useState(true);
  const [activeFolder, setActiveFolder] = useState<string | null>(() => getStoredActiveFolder());
  const canUpload = canWriteLibraryAccess(user?.role);
  const canUploadToServer = Boolean(token && canUpload);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const desktopFs = isRadioflowDesktop() && Boolean(window.radioflow?.nativeFs);

  const pickedCount = pickedNativePaths.length + pickedLocalFiles.length;

  const audioFileNames = useMemo(() => {
    const fromPaths = pickedNativePaths.map((p) => p.split(/[/\\]/).pop() ?? p);
    const fromFiles = pickedLocalFiles.map((f) => f.name);
    return [...fromPaths, ...fromFiles];
  }, [pickedNativePaths, pickedLocalFiles]);

  const resolveFilesForUpload = useCallback(async (): Promise<File[]> => {
    const files: File[] = [];
    if (pickedLocalFiles.length > 0) files.push(...pickedLocalFiles.filter((f) => isLocalAudioFile(f)));
    if (pickedNativePaths.length > 0) {
      const fromPaths = await filesFromAbsolutePaths(pickedNativePaths);
      files.push(...fromPaths.filter((f) => isLocalAudioFile(f)));
    }
    return files;
  }, [pickedLocalFiles, pickedNativePaths]);

  const importPathsToLibrary = useCallback(
    async (paths: string[], opts?: { clearPicked?: boolean }) => {
      if (!canUploadToServer || paths.length === 0) {
        setMsg("Inicia sesión con un usuario que pueda subir a la librería (editor, DJ o admin).");
        return;
      }
      if (!activeFolder) {
        setMsg("Crea o elige una carpeta antes de guardar la música.");
        return;
      }
      setExplorerBusy(true);
      setMsg(null);
      setUploadProgress({ done: 0, total: paths.length });
      try {
        const summary = await importNativePathsToLibrary(token!, paths, {
          onProgress: (done, total) => setUploadProgress({ done, total }),
          folderPathPrefix: activeFolder!,
        });
        let enqueued = 0;
        if (enqueueAfterUpload && summary.ids.length > 0) {
          for (const assetId of summary.ids) {
            await apiFetch("/api/station/queue", {
              method: "POST",
              token: token!,
              body: JSON.stringify({ assetId }),
            });
            enqueued += 1;
          }
          notifyStationRefresh();
        }
        if (opts?.clearPicked !== false) {
          setPickedLocalFiles([]);
          setPickedNativePaths([]);
        }
        const parts = [formatImportSummaryMessage(summary, paths.length)];
        if (enqueued > 0) parts.push(`${enqueued} en la cola de cabina`);
        setMsg(`Listo: ${parts.join(" · ")}`);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Error al importar");
      } finally {
        setUploadProgress(null);
        setExplorerBusy(false);
      }
    },
    [canUploadToServer, enqueueAfterUpload, token, activeFolder],
  );

  const importFilesToLibrary = useCallback(
    async (files: File[], opts?: { clearPicked?: boolean }) => {
      if (!canUploadToServer || files.length === 0) {
        setMsg("Inicia sesión con un usuario que pueda subir a la librería (editor, DJ o admin).");
        return;
      }
      if (!activeFolder) {
        setMsg("Crea o elige una carpeta antes de guardar la música.");
        return;
      }
      if (desktopFs && pickedNativePaths.length > 0 && files.length === 0) {
        await importPathsToLibrary(pickedNativePaths, opts);
        return;
      }
      setExplorerBusy(true);
      setMsg(null);
      setUploadProgress({ done: 0, total: files.length });
      try {
        const ids = await uploadManyToLibrary(token!, files, {
          onProgress: (done, total) => setUploadProgress({ done, total }),
          folderPathPrefix: activeFolder!,
        });
        let enqueued = 0;
        if (enqueueAfterUpload && ids.length > 0) {
          for (const assetId of ids) {
            await apiFetch("/api/station/queue", {
              method: "POST",
              token: token!,
              body: JSON.stringify({ assetId }),
            });
            enqueued += 1;
          }
          notifyStationRefresh();
        }
        if (opts?.clearPicked !== false) {
          setPickedLocalFiles([]);
          setPickedNativePaths([]);
        }
        const parts = [`${ids.length} archivo(s) en la librería`];
        if (enqueued > 0) parts.push(`${enqueued} en la cola de cabina`);
        setMsg(`Listo: ${parts.join(" · ")}.`);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Error al importar");
      } finally {
        setUploadProgress(null);
        setExplorerBusy(false);
      }
    },
    [canUploadToServer, enqueueAfterUpload, token, activeFolder, desktopFs, importPathsToLibrary, pickedNativePaths],
  );

  async function onClickExplorer() {
    setMsg(null);
    if (desktopFs && window.radioflow?.nativeFs?.openAudioDialog) {
      try {
        const paths = await window.radioflow.nativeFs.openAudioDialog();
        setPickedNativePaths(paths);
        setPickedLocalFiles([]);
      } catch {
        setMsg("No se pudo abrir el explorador de archivos del sistema.");
      }
      return;
    }
    fileInputRef.current?.click();
  }

  function onActiveFolderChange(pathPrefix: string | null) {
    setStoredActiveFolder(pathPrefix);
    setActiveFolder(pathPrefix);
  }

  async function uploadPicked() {
    if (!activeFolder) {
      setMsg("Crea o elige una carpeta antes de guardar la música.");
      return;
    }
    if (pickedNativePaths.length > 0 && desktopFs) {
      await importPathsToLibrary(pickedNativePaths);
      return;
    }
    const files = await resolveFilesForUpload();
    if (files.length === 0) {
      setMsg("No hay archivos de audio seleccionados.");
      return;
    }
    await importFilesToLibrary(files);
  }

  return (
    <section className={`card import-insumos-main${explorerBusy ? " import-insumos-main--busy" : ""}`}>
      <header className="import-insumos-header">
        <h1 className="import-insumos-title">Explorador · carpetas y música</h1>
        <p className="muted import-insumos-lead">
          Cree una carpeta, recorra sus discos y unidades abajo y guarde la música en la librería local de la emisora.
        </p>
      </header>

      {!desktopFs ? (
        <p className="error small">
          El explorador de discos requiere la aplicación instalada (Electron). Abra RadioFlow Studio desde el menú Inicio.
        </p>
      ) : null}

      {canUpload ? (
        <LibraryUserFoldersPanel
          token={token}
          canWrite={canUpload}
          activePathPrefix={activeFolder}
          onActivePathPrefixChange={onActiveFolderChange}
        />
      ) : null}

      <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
        <label className="muted small" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={enqueueAfterUpload}
            onChange={(e) => setEnqueueAfterUpload(e.target.checked)}
            disabled={explorerBusy || !canUploadToServer}
          />
          Tras guardar, añadir a la cola de cabina
        </label>
      </div>

      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          onClick={() => void onClickExplorer()}
          disabled={explorerBusy || !activeFolder}
          title={!activeFolder ? "Crea o elige una carpeta primero" : undefined}
        >
          Elegir archivos…
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void uploadPicked()}
          disabled={explorerBusy || pickedCount === 0 || !canUploadToServer || !activeFolder}
          title={
            !activeFolder
              ? "Crea o elige una carpeta primero"
              : !canUploadToServer
                ? "Ingrese con permisos para subir al servidor"
                : "Guardar en la carpeta activa de la librería"
          }
        >
          {explorerBusy ? "Guardando…" : `Guardar en librería${pickedCount > 0 ? ` (${pickedCount})` : ""}`}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setPickedLocalFiles([]);
            setPickedNativePaths([]);
            setMsg(null);
          }}
          disabled={explorerBusy || pickedCount === 0}
        >
          Limpiar selección
        </button>
        <Link to="/station" className="btn ghost">
          Ir a cabina
        </Link>
        {!canUploadToServer ? (
          <span className="muted small">
            Para subir:{" "}
            <Link to="/login" className="import-insumos-inline-link">
              Entrar
            </Link>
            .
          </span>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const list = e.target.files;
          if (!list?.length) return;
          setPickedLocalFiles(Array.from(list));
          setPickedNativePaths([]);
          e.target.value = "";
        }}
      />

      {uploadProgress ? (
        <p className="muted small" style={{ marginTop: "0.5rem" }}>
          Subiendo {uploadProgress.done} / {uploadProgress.total}…
        </p>
      ) : null}

      {msg ? (
        <p className={msg.startsWith("Listo:") ? "muted" : "error"} style={{ marginTop: "0.5rem" }}>
          {msg}
          {msg.startsWith("Listo:") ? (
            <>
              {" "}
              <Link to="/library">Ver librería</Link>
              {" · "}
              <Link to="/station">Abrir cabina</Link>
            </>
          ) : null}
        </p>
      ) : null}

      {desktopFs ? (
        <div style={{ marginTop: "1rem" }}>
          <DesktopFolderExplorer
            canPick={canUploadToServer}
            panelTitle="Unidades y carpetas del equipo"
            importBusy={explorerBusy}
            onImportSelectedPaths={(paths) => void importPathsToLibrary(paths, { clearPicked: false })}
          />
        </div>
      ) : null}

      {pickedCount > 0 ? (
        <div className="import-simple-picked">
          <p className="muted small" style={{ margin: "0.65rem 0 0.35rem" }}>
            Selección rápida (diálogo): <strong>{pickedCount}</strong>
          </p>
          {pickedNativePaths.length > 0 ? (
            <div
              className="import-simple-drag"
              draggable
              onDragStart={(ev) => {
                const payload = JSON.stringify({ paths: pickedNativePaths });
                try {
                  ev.dataTransfer.setData(DND_NATIVE_PATHS_MIME, payload);
                } catch {
                  /* ignore */
                }
                ev.dataTransfer.setData("text/plain", payload);
                ev.dataTransfer.effectAllowed = "copy";
              }}
              title="Arrastre a la lista abierta en Cabina"
            >
              Arrastrar a la lista en Cabina
            </div>
          ) : null}
          <ul className="import-simple-list">
            {audioFileNames.slice(0, 300).map((name, i) => (
              <li key={`${i}-${name}`} className="mono small">
                {name}
              </li>
            ))}
          </ul>
          {audioFileNames.length > 300 ? <p className="muted small">…y {audioFileNames.length - 300} más</p> : null}
        </div>
      ) : null}

      <ol className="import-insumos-steps muted small">
        <li>Cree una carpeta y ponle el nombre que quieras.</li>
        <li>Elija la música en el explorador, marque las canciones y haga clic en <strong>Guardar en la librería</strong>.</li>
        <li>Revise en <Link to="/library">Librería</Link> y envíe pistas a cabina cuando lo desee.</li>
      </ol>
    </section>
  );
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DND_NATIVE_PATHS_MIME } from "../lib/local-audio-import";
import { filesFromAbsolutePaths, isNativeAudioPath } from "../lib/desktop-native";
import type { NativeFsListEntry, NativeFsRoot } from "../desktop-bridge";

export type DesktopFolderExplorerProps = {
  canPick: boolean;
  /** Preferido en app instalada: copia directa desde rutas absolutas. */
  onImportSelectedPaths?: (paths: string[]) => void | Promise<void>;
  onImportSelectedToLibrary?: (files: File[]) => void | Promise<void>;
  importBusy?: boolean;
  panelTitle?: string;
};

/** Segmentos de ruta Windows/macOS para migas de pan. */
function breadcrumbForNativePath(fullPath: string): { name: string; path: string }[] {
  const win = /^([A-Za-z]:)\\?(.*)$/.exec(fullPath.replace(/\//g, "\\"));
  if (win) {
    const drive = `${win[1]}\\`;
    const items: { name: string; path: string }[] = [{ name: win[1], path: drive }];
    const rest = (win[2] ?? "").split("\\").filter(Boolean);
    let acc = drive;
    for (const part of rest) {
      acc = acc.endsWith("\\") ? `${acc}${part}` : `${acc}\\${part}`;
      items.push({ name: part, path: acc });
    }
    return items;
  }
  const parts = fullPath.split("/").filter(Boolean);
  let acc = "";
  return parts.map((part) => {
    acc = acc ? `${acc}/${part}` : `/${part}`;
    return { name: part, path: acc };
  });
}

export function DesktopFolderExplorer({
  canPick,
  onImportSelectedPaths,
  onImportSelectedToLibrary,
  importBusy,
  panelTitle = "Archivos locales",
}: DesktopFolderExplorerProps) {
  const fsApi = window.radioflow?.nativeFs;
  const [roots, setRoots] = useState<NativeFsRoot[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<NativeFsListEntry[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [navBack, setNavBack] = useState<(string | null)[]>([]);
  const [navForward, setNavForward] = useState<(string | null)[]>([]);
  const lastClickedIdxRef = useRef<number | null>(null);

  const loadRoots = useCallback(async () => {
    if (!fsApi) return;
    try {
      const r = await fsApi.listRoots();
      setRoots(r);
      setListErr(null);
    } catch {
      setListErr("No se pudieron listar las unidades.");
    }
  }, [fsApi]);

  const readDir = useCallback(
    async (dir: string) => {
      if (!fsApi) return;
      setLoadingList(true);
      setListErr(null);
      try {
        const list = await fsApi.readDirectory(dir);
        setEntries(list);
        setCurrentPath(dir);
        setSelectedPaths(new Set());
        lastClickedIdxRef.current = null;
      } catch {
        setListErr("No se pudo leer esta carpeta.");
        setEntries([]);
      } finally {
        setLoadingList(false);
      }
    },
    [fsApi],
  );

  const openPath = useCallback(
    async (dir: string | null, opts?: { addToHistory?: boolean }) => {
      const addToHistory = opts?.addToHistory !== false;
      if (addToHistory && dir !== currentPath) {
        setNavBack((b) => [...b, currentPath]);
        setNavForward([]);
      }
      if (dir === null) {
        setCurrentPath(null);
        setEntries([]);
        setSelectedPaths(new Set());
        lastClickedIdxRef.current = null;
        setListErr(null);
        return;
      }
      await readDir(dir);
    },
    [currentPath, readDir],
  );

  useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  const breadcrumbs = useMemo(
    () => (currentPath ? breadcrumbForNativePath(currentPath) : []),
    [currentPath],
  );

  const audioEntries = useMemo(
    () => entries.filter((e) => e.isFile && isNativeAudioPath(e.path)),
    [entries],
  );

  const dirEntries = useMemo(() => entries.filter((e) => e.isDirectory), [entries]);

  const goBack = useCallback(() => {
    if (navBack.length === 0) return;
    const prev = navBack[navBack.length - 1] ?? null;
    setNavBack((b) => b.slice(0, -1));
    setNavForward((f) => [...f, currentPath]);
    void openPath(prev, { addToHistory: false });
  }, [navBack, currentPath, openPath]);

  const goForward = useCallback(() => {
    if (navForward.length === 0) return;
    const next = navForward[navForward.length - 1] ?? null;
    setNavForward((f) => f.slice(0, -1));
    setNavBack((b) => [...b, currentPath]);
    void openPath(next, { addToHistory: false });
  }, [navForward, currentPath, openPath]);

  const goUp = useCallback(async () => {
    if (!fsApi || !currentPath) return;
    const parent = await fsApi.parentPath(currentPath);
    if (parent == null) {
      void openPath(null);
      return;
    }
    void openPath(parent);
  }, [fsApi, currentPath, openPath]);

  const refreshListing = useCallback(() => {
    if (!currentPath) {
      void loadRoots();
      return;
    }
    void readDir(currentPath);
  }, [currentPath, loadRoots, readDir]);

  const toggleOne = useCallback((p: string) => {
    setSelectedPaths((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);

  const selectRange = useCallback(
    (fromIdx: number, toIdx: number) => {
      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      const next = new Set<string>();
      for (let i = lo; i <= hi; i++) next.add(audioEntries[i]!.path);
      setSelectedPaths(next);
    },
    [audioEntries],
  );

  const onRowClick = useCallback(
    (idx: number, p: string, ev: React.MouseEvent) => {
      if (ev.shiftKey && lastClickedIdxRef.current != null) {
        selectRange(lastClickedIdxRef.current, idx);
      } else if (ev.ctrlKey || ev.metaKey) {
        toggleOne(p);
      } else {
        toggleOne(p);
      }
      lastClickedIdxRef.current = idx;
    },
    [selectRange, toggleOne],
  );

  const onRowDragStart = useCallback(
    (ev: React.DragEvent, path: string) => {
      const paths =
        selectedPaths.has(path) ? [...selectedPaths].filter((x) => isNativeAudioPath(x)) : [path];
      const payload = JSON.stringify({ paths });
      try {
        ev.dataTransfer.setData(DND_NATIVE_PATHS_MIME, payload);
      } catch {
        /* ignore */
      }
      ev.dataTransfer.setData("text/plain", payload);
      ev.dataTransfer.effectAllowed = "copy";
    },
    [selectedPaths],
  );

  const selectedFilesForImport = useMemo(() => [...selectedPaths].filter((p) => isNativeAudioPath(p)), [selectedPaths]);

  const selectAllInFolder = useCallback(() => {
    setSelectedPaths(new Set(audioEntries.map((e) => e.path)));
    lastClickedIdxRef.current = audioEntries.length > 0 ? audioEntries.length - 1 : null;
  }, [audioEntries]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    lastClickedIdxRef.current = null;
  }, []);

  if (!fsApi) {
    return (
      <aside className="local-explorer" aria-label={panelTitle}>
        <p className="muted small">El explorador de discos solo está disponible en la aplicación de escritorio.</p>
      </aside>
    );
  }

  return (
    <aside className="local-explorer" aria-label={panelTitle}>
      <div className="local-explorer-head">
        <h2 className="local-explorer-title">{panelTitle}</h2>
        <p className="local-explorer-note muted small">
          Navegue con las flechas como en el Explorador de Windows. Ctrl/Cmd+clic: varios archivos. Arrastre a la
          lista o a la zona de destino.
        </p>
      </div>

      <div className="desktop-explorer-nav-bar" role="toolbar" aria-label="Navegación de carpetas">
        <div className="desktop-explorer-nav-btns">
          <button
            type="button"
            className="desktop-explorer-nav-btn"
            title="Atrás"
            aria-label="Atrás"
            disabled={!canPick || navBack.length === 0}
            onClick={() => goBack()}
          >
            ←
          </button>
          <button
            type="button"
            className="desktop-explorer-nav-btn"
            title="Adelante"
            aria-label="Adelante"
            disabled={!canPick || navForward.length === 0}
            onClick={() => goForward()}
          >
            →
          </button>
          <button
            type="button"
            className="desktop-explorer-nav-btn"
            title="Subir a la carpeta superior"
            aria-label="Subir a la carpeta superior"
            disabled={!canPick || !currentPath}
            onClick={() => void goUp()}
          >
            ↑
          </button>
          <button
            type="button"
            className="desktop-explorer-nav-btn"
            title="Actualizar"
            aria-label="Actualizar"
            disabled={!canPick || loadingList}
            onClick={() => refreshListing()}
          >
            ↻
          </button>
        </div>
        <nav className="desktop-explorer-address" aria-label="Ruta actual">
          <button
            type="button"
            className={`desktop-explorer-crumb${currentPath === null ? " is-current" : ""}`}
            disabled={!canPick || currentPath === null}
            onClick={() => void openPath(null)}
            title="Este equipo (unidades)"
          >
            Este equipo
          </button>
          {breadcrumbs.map((c, i) => (
            <Fragment key={c.path}>
              <span className="desktop-explorer-crumb-sep" aria-hidden>
                ›
              </span>
              <button
                type="button"
                className={`desktop-explorer-crumb${i === breadcrumbs.length - 1 ? " is-current" : ""}`}
                disabled={!canPick}
                onClick={() => void openPath(c.path)}
                title={c.path}
              >
                {c.name}
              </button>
            </Fragment>
          ))}
        </nav>
      </div>

      <div className="desktop-explorer-toolbar">
        <label className="desktop-explorer-drive-label muted small">
          Ir a unidad
          <select
            className="select desktop-explorer-drive-select"
            value={currentPath?.match(/^[A-Za-z]:/)?.[0] ? `${currentPath.slice(0, 2)}\\` : currentPath ?? ""}
            disabled={!canPick || loadingList}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                void openPath(null);
                return;
              }
              void openPath(v);
            }}
          >
            <option value="">Este equipo…</option>
            {roots.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {currentPath ? (
          <div className="desktop-explorer-actions">
            <button
              type="button"
              className="btn btn-compact"
              disabled={!canPick || audioEntries.length === 0}
              onClick={() => selectAllInFolder()}
              title="Selecciona todas las canciones de esta carpeta"
            >
              Todo
            </button>
            <button
              type="button"
              className="btn btn-compact ghost"
              disabled={!canPick || selectedPaths.size === 0}
              onClick={() => clearSelection()}
              title="Quitar selección"
            >
              Ninguno
            </button>
          </div>
        ) : null}
      </div>

      {listErr ? <p className="local-explorer-empty error">{listErr}</p> : null}

      {!currentPath ? (
        <div className="local-explorer-scroll">
          <p className="muted small desktop-explorer-roots-hint">Elija una unidad o carpeta:</p>
          <ul className="local-explorer-list">
            {roots.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  className="local-explorer-row desktop-explorer-folder desktop-explorer-drive"
                  onClick={() => void openPath(r.path)}
                  disabled={!canPick}
                  title={`Abrir ${r.path}`}
                >
                  <span className="local-explorer-name">💽 {r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : loadingList ? (
        <p className="muted small desktop-explorer-loading">Leyendo…</p>
      ) : (
        <div className="local-explorer-scroll">
          <ul className="local-explorer-list">
            {dirEntries.map((e) => (
              <li key={e.path}>
                <button
                  type="button"
                  className="local-explorer-row desktop-explorer-folder"
                  onClick={() => void openPath(e.path)}
                  disabled={!canPick}
                  title="Abrir carpeta"
                >
                  <span className="local-explorer-name">📁 {e.name}</span>
                </button>
              </li>
            ))}
            {audioEntries.map((e, idx) => {
              const sel = selectedPaths.has(e.path);
              return (
                <li key={e.path}>
                  <div
                    className={`desktop-explorer-file${sel ? " is-selected" : ""}`}
                    draggable={!!canPick}
                    onDragStart={canPick ? (ev) => onRowDragStart(ev, e.path) : undefined}
                    title="Marque canciones y arrástrelas a la playlist"
                  >
                    <label className="desktop-explorer-check">
                      <input
                        type="checkbox"
                        checked={sel}
                        disabled={!canPick}
                        onChange={() => toggleOne(e.path)}
                        onClick={(ev) => ev.stopPropagation()}
                      />
                      <span className="desktop-explorer-filename">{e.name}</span>
                    </label>
                    <button
                      type="button"
                      className="desktop-explorer-hit"
                      onClick={(ev) => onRowClick(idx, e.path, ev)}
                      disabled={!canPick}
                      aria-label={`Seleccionar ${e.name}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {dirEntries.length === 0 && audioEntries.length === 0 ? (
            <p className="muted small">Carpeta vacía o sin audio reconocido aquí.</p>
          ) : null}
        </div>
      )}

      {canPick && (onImportSelectedPaths || onImportSelectedToLibrary) && selectedFilesForImport.length > 0 ? (
        <div className="local-explorer-foot">
          <button
            type="button"
            className="btn btn-compact primary"
            disabled={importBusy}
            onClick={() =>
              void (async () => {
                if (onImportSelectedPaths) {
                  await onImportSelectedPaths(selectedFilesForImport);
                  return;
                }
                const files = await filesFromAbsolutePaths(selectedFilesForImport);
                await onImportSelectedToLibrary?.(files);
              })()
            }
          >
            {importBusy ? "Subiendo…" : `Guardar ${selectedFilesForImport.length} en la librería`}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

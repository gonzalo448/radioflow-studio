import { useEffect, useMemo, useRef, useState } from "react";
import { DND_LOCAL_AUDIO_MIME, isLocalAudioFile } from "../lib/local-audio-import";

type FolderGroup = { dir: string; entries: { file: File; flatIdx: number }[] };

export type LocalFolderExplorerProps = {
  /** Archivos de audio del último “Elegir carpeta” (o vacío). */
  files: File[];
  onFilesChange: (files: File[]) => void;
  canPick: boolean;
  /** Botón para subir la selección a la librería (Librería). */
  onImportSelectedToLibrary?: (files: File[]) => void | Promise<void>;
  importBusy?: boolean;
  panelTitle?: string;
};

function buildGroups(flat: File[]): FolderGroup[] {
  const m = new Map<string, { file: File; flatIdx: number }[]>();
  flat.forEach((file, flatIdx) => {
    const rel = file.webkitRelativePath || file.name;
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "Raíz de la carpeta";
    if (!m.has(dir)) m.set(dir, []);
    m.get(dir)!.push({ file, flatIdx });
  });
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, entries]) => ({ dir, entries }));
}

export function LocalFolderExplorer({
  files,
  onFilesChange,
  canPick,
  onImportSelectedToLibrary,
  importBusy,
  panelTitle = "Archivos locales",
}: LocalFolderExplorerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const flat = useMemo(() => {
    return files.filter((f) => isLocalAudioFile(f)).sort((a, b) => {
      const pa = a.webkitRelativePath || a.name;
      const pb = b.webkitRelativePath || b.name;
      return pa.localeCompare(pb);
    });
  }, [files]);

  const groups = useMemo(() => buildGroups(flat), [flat]);

  useEffect(() => {
    setSelected((s) => new Set([...s].filter((i) => i >= 0 && i < flat.length)));
  }, [flat]);

  const onFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    onFilesChange(Array.from(list));
    setSelected(new Set());
    e.target.value = "";
  };

  const toggleRow = (flatIdx: number, ev: React.MouseEvent) => {
    if (ev.ctrlKey || ev.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(flatIdx)) n.delete(flatIdx);
        else n.add(flatIdx);
        return n;
      });
    } else {
      setSelected(new Set([flatIdx]));
    }
  };

  const onRowDragStart = (ev: React.DragEvent, flatIdx: number) => {
    const indices =
      selected.has(flatIdx) ? [...selected].sort((a, b) => a - b) : [flatIdx];
    const payload = JSON.stringify({ indices });
    try {
      ev.dataTransfer.setData(DND_LOCAL_AUDIO_MIME, payload);
    } catch {
      /* ignore */
    }
    ev.dataTransfer.setData("text/plain", payload);
    ev.dataTransfer.effectAllowed = "copy";
  };

  const selectedFiles = useMemo(() => [...selected].sort((a, b) => a - b).map((i) => flat[i]), [flat, selected]);

  return (
    <aside className="local-explorer" aria-label={panelTitle}>
      <div className="local-explorer-head">
        <h2 className="local-explorer-title">{panelTitle}</h2>
        <p className="local-explorer-note muted small">
          Elija una carpeta del equipo: el navegador solo muestra lo que autorices (no recorre discos enteros).
        </p>
        {canPick ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="local-explorer-input"
              multiple
              onChange={onFolderInputChange}
              // @ts-expect-error webkitdirectory no está en todos los typings
              webkitdirectory=""
            />
            <button type="button" className="btn primary btn-compact local-explorer-pick" onClick={() => inputRef.current?.click()}>
              Elegir carpeta…
            </button>
          </>
        ) : (
          <p className="muted small">Inicia sesión con permiso de librería para usar el explorador.</p>
        )}
      </div>
      <div className="local-explorer-meta muted small">
        Tipos: mp3, m4a, aac, wav, flac, ogg, opus… · Ctrl/Cmd+clic: varios · arrastre a la lista o a la zona de
        destino
      </div>
      {flat.length === 0 ? (
        <p className="local-explorer-empty muted small">
          {files.length > 0
            ? "No hay archivos de audio reconocidos en la selección."
            : "Todavía no cargaste ninguna carpeta."}
        </p>
      ) : (
        <div className="local-explorer-scroll">
          {groups.map((g) => (
            <details key={g.dir} className="local-explorer-details" open>
              <summary className="local-explorer-summary">{g.dir}</summary>
              <ul className="local-explorer-list">
                {g.entries.map(({ file, flatIdx }) => (
                  <li key={`${flatIdx}-${file.name}-${file.size}`}>
                    <button
                      type="button"
                      draggable={!!canPick}
                      className={`local-explorer-row${selected.has(flatIdx) ? " is-selected" : ""}`}
                      onClick={(e) => toggleRow(flatIdx, e)}
                      onDragStart={canPick ? (e) => onRowDragStart(e, flatIdx) : undefined}
                      title="Clic para seleccionar · arrastre a la lista"
                    >
                      <span className="local-explorer-name">{file.name}</span>
                      <span className="local-explorer-sub mono muted">
                        {(file.size / 1024).toFixed(0)} KB
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
      {canPick && onImportSelectedToLibrary && selectedFiles.length > 0 ? (
        <div className="local-explorer-foot">
          <button
            type="button"
            className="btn btn-compact"
            disabled={importBusy}
            onClick={() => void onImportSelectedToLibrary(selectedFiles)}
          >
            {importBusy ? "Subiendo…" : `Subir ${selectedFiles.length} a la librería`}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

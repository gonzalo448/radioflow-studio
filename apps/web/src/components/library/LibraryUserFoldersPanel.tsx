import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ApiLibraryCreateFolderResponse, ApiLibraryDeleteFolderResult, ApiLibraryFolderRow } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";
import { setStoredActiveFolder, userLibraryFolders } from "../../lib/library-active-folder";
import { folderDisplayName } from "../../lib/library-folder";
import { LIBRARY_CHANGED_EVENT } from "../../lib/local-audio-import";

type Props = {
  token: string | null;
  canWrite: boolean;
  activePathPrefix: string | null;
  onActivePathPrefixChange: (pathPrefix: string | null) => void;
  onFoldersChanged?: () => void;
};

export function LibraryUserFoldersPanel({
  token,
  canWrite,
  activePathPrefix,
  onActivePathPrefixChange,
  onFoldersChanged,
}: Props) {
  const [folders, setFolders] = useState<ApiLibraryFolderRow[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadFolders = useCallback(async () => {
    try {
      const r = await apiFetch<{ folders: ApiLibraryFolderRow[] }>("/api/library/folders", {
        token: token ?? undefined,
      });
      setFolders(userLibraryFolders(r.folders));
    } catch {
      setFolders([]);
    }
  }, [token]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    const onChange = () => void loadFolders();
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChange);
  }, [loadFolders]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !canWrite || !newName.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const created = await apiFetch<ApiLibraryCreateFolderResponse>("/api/library/folders", {
        method: "POST",
        token,
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      setStoredActiveFolder(created.pathPrefix);
      onActivePathPrefixChange(created.pathPrefix);
      await loadFolders();
      onFoldersChanged?.();
      setMsg(`Carpeta «${created.displayName}» lista. Ahora elija la música y guarde en librería.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo crear la carpeta");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteFolder(pathPrefix: string, label: string) {
    if (!token || !canWrite) return;
    const folder = folders.find((f) => f.name === pathPrefix);
    const count = folder?.count ?? 0;
    const detail =
      count > 0
        ? `Se borrarán ${count} pista(s) del catálogo y los archivos de audio en el equipo.`
        : "Se eliminará la carpeta vacía.";
    if (
      !window.confirm(
        `¿Borrar la carpeta «${label}»?\n\n${detail}\n\nEsta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    setDeleteBusy(pathPrefix);
    setMsg(null);
    try {
      const r = await apiFetch<ApiLibraryDeleteFolderResult>(
        `/api/library/folders?pathPrefix=${encodeURIComponent(pathPrefix)}`,
        { method: "DELETE", token },
      );
      if (activePathPrefix === pathPrefix) {
        setStoredActiveFolder(null);
        onActivePathPrefixChange(null);
      }
      await loadFolders();
      onFoldersChanged?.();
      window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
      setMsg(`Carpeta borrada (${r.deletedAssets} pista(s) eliminadas).`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo eliminar la carpeta");
    } finally {
      setDeleteBusy(null);
    }
  }

  function selectFolder(pathPrefix: string) {
    setStoredActiveFolder(pathPrefix);
    onActivePathPrefixChange(pathPrefix);
    setMsg(null);
  }

  if (!canWrite) {
    return (
      <p className="muted small library-folder-hint">
        Inicia sesión para crear carpetas y guardar música en la librería.
      </p>
    );
  }

  const activeLabel = activePathPrefix ? folderDisplayName(activePathPrefix) : null;

  return (
    <section className="library-user-folders" aria-labelledby="library-user-folders-title">
      <h2 id="library-user-folders-title" className="library-user-folders-title">
        Sus carpetas
      </h2>
      <p className="muted small library-folder-hint">
        No hay una «librería» aparte: cree <strong>carpetas</strong> aquí y elija la música desde sus discos (Explorador o Añadir → Archivo).
      </p>

      <form className="library-folder-create" onSubmit={(e) => void onCreate(e)}>
        <input
          type="text"
          className="library-folder-name-input"
          placeholder="Nombre de la carpeta (ej. Vallenatos, Salsa…)"
          value={newName}
          maxLength={48}
          disabled={busy || !token}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn primary btn-compact" disabled={busy || !token || !newName.trim()}>
          Crear carpeta
        </button>
      </form>

      {folders.length > 0 ? (
        <ul className="library-user-folders-list" role="list">
          {folders.map((f) => {
            const label = folderDisplayName(f.name);
            const isActive = activePathPrefix === f.name;
            const isGeneral = f.name === "uploads";
            return (
              <li key={f.name} className="library-user-folder-row">
                <button
                  type="button"
                  className={`library-user-folder-item${isActive ? " library-user-folder-item--on" : ""}`}
                  disabled={isGeneral}
                  title={isGeneral ? "Pistas importadas sin subcarpeta; use Borrar para vaciarlas" : undefined}
                  onClick={() => selectFolder(f.name)}
                >
                  <span className="library-user-folder-icon" aria-hidden>
                    📁
                  </span>
                  <span className="library-user-folder-item-name">{label}</span>
                  <span className="library-ml-folder-count">{f.count} pistas</span>
                </button>
                <button
                  type="button"
                  className="btn btn-compact danger library-user-folder-delete"
                  title={`Borrar carpeta «${label}»`}
                  disabled={deleteBusy === f.name}
                  onClick={() => void onDeleteFolder(f.name, label)}
                >
                  {deleteBusy === f.name ? "…" : "Borrar"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small library-user-folders-empty">Todavía no hay carpetas. Cree la primera arriba.</p>
      )}

      {activeLabel ? (
        <p className="library-user-folders-active" role="status">
          Carpeta activa: <strong>{activeLabel}</strong>
        </p>
      ) : (
        <p className="library-user-folders-active library-user-folders-active--warn" role="status">
          Elija o cree una carpeta antes de importar música.
        </p>
      )}

      {msg ? <p className="small library-folder-msg">{msg}</p> : null}
    </section>
  );
}

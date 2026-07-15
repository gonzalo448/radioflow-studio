import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ApiLibraryBrowseLabel, ApiLibraryFolderRow } from "@radioflow/shared";

export type CatalogFillKind = "genre" | "artist" | "folder" | "playlist";
export type CatalogFillMode = "fill" | "new" | "append";

type Props = {
  open: boolean;
  kind: CatalogFillKind;
  genres: string[];
  artists: ApiLibraryBrowseLabel[];
  folders: ApiLibraryFolderRow[];
  playlists: { id: string; name: string }[];
  activePlaylistId: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (opts: {
    kind: CatalogFillKind;
    mode: CatalogFillMode;
    value: string;
    renameTab: boolean;
  }) => void;
};

export function PlayoutCatalogFillDialog({
  open,
  kind,
  genres,
  artists,
  folders,
  playlists,
  activePlaylistId,
  busy,
  onClose,
  onConfirm,
}: Props) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<CatalogFillMode>("fill");
  const [renameTab, setRenameTab] = useState(true);

  const options = useMemo(() => {
    switch (kind) {
      case "genre":
        return genres.map((g) => ({ id: g, label: g }));
      case "artist":
        return artists.map((a) => ({ id: a.name, label: a.name === "__none__" ? "(Sin artista)" : a.name }));
      case "folder":
        return folders.map((f) => ({ id: f.name, label: `${f.name.split("/").pop() ?? f.name} (${f.count})` }));
      case "playlist":
        return playlists.filter((p) => p.id !== activePlaylistId).map((p) => ({ id: p.id, label: p.name }));
      default:
        return [];
    }
  }, [activePlaylistId, artists, folders, genres, kind, playlists]);

  useEffect(() => {
    if (!open) return;
    setValue(options[0]?.id ?? "");
    if (kind === "playlist") {
      setMode("append");
      setRenameTab(false);
    } else {
      setMode(activePlaylistId ? "fill" : "new");
      setRenameTab(true);
    }
  }, [activePlaylistId, kind, open, options]);

  if (!open) return null;

  const title =
    kind === "genre"
      ? "Añadir todo desde género"
      : kind === "artist"
        ? "Añadir todo desde artista"
        : kind === "folder"
          ? "Añadir todo desde carpeta"
          : "Añadir pistas de otra lista";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    onConfirm({ kind, mode, value: value.trim(), renameTab });
  }

  return (
    <div className="music-library-tool-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog playlist-genre-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pl-catalog-fill-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="pl-catalog-fill-title" className="music-library-tool-dialog-title">
            {title}
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <p className="muted small">Solo pistas del catálogo en la bóveda (biblioteca musical).</p>
        <form onSubmit={onSubmit} className="playlist-genre-form">
          <label className="music-library-field">
            <span>
              {kind === "genre"
                ? "Género"
                : kind === "artist"
                  ? "Artista"
                  : kind === "folder"
                    ? "Carpeta"
                    : "Lista origen"}
            </span>
            {options.length > 0 ? (
              <select className="select" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
            )}
          </label>
          {kind !== "playlist" ? (
            <fieldset className="playlist-genre-modes">
              <legend className="small">Acción</legend>
              <label className="playlist-genre-mode">
                <input
                  type="radio"
                  name="pl-catalog-mode"
                  checked={mode === "fill"}
                  disabled={!activePlaylistId || busy}
                  onChange={() => setMode("fill")}
                />
                Rellenar pestaña activa (reemplaza)
              </label>
              <label className="playlist-genre-mode">
                <input
                  type="radio"
                  name="pl-catalog-mode"
                  checked={mode === "new"}
                  disabled={busy}
                  onChange={() => setMode("new")}
                />
                Crear pestaña nueva
              </label>
            </fieldset>
          ) : (
            <fieldset className="playlist-genre-modes">
              <legend className="small">Acción</legend>
              <label className="playlist-genre-mode">
                <input
                  type="radio"
                  name="pl-merge-mode"
                  checked={mode === "append"}
                  disabled={!activePlaylistId || busy}
                  onChange={() => setMode("append")}
                />
                Añadir al final de la pestaña activa
              </label>
              <label className="playlist-genre-mode">
                <input
                  type="radio"
                  name="pl-merge-mode"
                  checked={mode === "fill"}
                  disabled={!activePlaylistId || busy}
                  onChange={() => setMode("fill")}
                />
                Reemplazar pestaña activa con la otra lista
              </label>
              <label className="playlist-genre-mode">
                <input
                  type="radio"
                  name="pl-merge-mode"
                  checked={mode === "new"}
                  disabled={busy}
                  onChange={() => setMode("new")}
                />
                Abrir solo la lista origen (cambiar pestaña)
              </label>
            </fieldset>
          )}
          {kind !== "playlist" ? (
            <label className="playlist-genre-mode">
              <input type="checkbox" checked={renameTab} disabled={busy} onChange={(e) => setRenameTab(e.target.checked)} />
              {mode === "fill" ? "Renombrar pestaña al criterio elegido" : "Usar el criterio como nombre de pestaña"}
            </label>
          ) : null}
          <div className="row tight playlist-genre-actions">
            <button type="submit" className="btn primary btn-compact" disabled={busy || !value.trim()}>
              {busy ? "…" : "Aplicar"}
            </button>
            <button type="button" className="btn btn-compact ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

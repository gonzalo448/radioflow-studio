import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ApiLibraryFolderRow, ApiPlaylistDetail } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";

type Props = {
  open: boolean;
  token: string;
  playlistId: string;
  insertAfterItemId?: string | null;
  onClose: () => void;
  onInserted: (detail: ApiPlaylistDetail) => void;
};

type OrderKind = "random" | "sequential" | "series";
type SourceKind = "folder" | "playlist";

type PlRow = { id: string; name: string; _count?: { items: number } };

/**
 * Diálogo RadioBOSS «Agregar lista de pistas…» (Playlist → Add Track List).
 * Origen: seleccionar lista o carpeta; selección Aleatorio / En orden / Serie.
 */
export function TrackListInsertDialog({
  open,
  token,
  playlistId,
  insertAfterItemId,
  onClose,
  onInserted,
}: Props) {
  const navigate = useNavigate();
  const [source, setSource] = useState<SourceKind>("folder");
  const [value, setValue] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [order, setOrder] = useState<OrderKind>("random");
  const [ignoreRepeat, setIgnoreRepeat] = useState(false);
  const [recurseSubfolders, setRecurseSubfolders] = useState(true);
  const [picker, setPicker] = useState<"folder" | "playlist" | null>(null);
  const [folders, setFolders] = useState<ApiLibraryFolderRow[]>([]);
  const [playlists, setPlaylists] = useState<PlRow[]>([]);
  const [folderFilter, setFolderFilter] = useState("");
  const [playlistFilter, setPlaylistFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    setError(null);
    setBusy(false);
    setSource("folder");
    setValue("");
    setDisplayName("");
    setOrder("random");
    setIgnoreRepeat(false);
    setRecurseSubfolders(true);
    setPicker(null);
    setFolderFilter("");
    setPlaylistFilter("");
    void Promise.all([
      apiFetch<{ pathFolders: ApiLibraryFolderRow[] }>("/api/library/browse", { token }),
      apiFetch<PlRow[]>("/api/playlists", { token }),
    ])
      .then(([b, pls]) => {
        setFolders(b.pathFolders);
        setPlaylists(pls.filter((p) => p.id !== playlistId));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar orígenes"));
  }, [open, playlistId, token]);

  const folderOptions = useMemo(() => {
    const q = folderFilter.trim().toLowerCase();
    const rows = folders.map((f) => ({
      id: f.name,
      label: `${f.name}${f.count != null ? ` (${f.count})` : ""}`,
    }));
    if (!q) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  }, [folderFilter, folders]);

  const playlistOptions = useMemo(() => {
    const q = playlistFilter.trim().toLowerCase();
    const rows = playlists.map((p) => ({
      id: p.id,
      label: `${p.name}${p._count ? ` (${p._count.items})` : ""}`,
      name: p.name,
    }));
    if (!q) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(q));
  }, [playlistFilter, playlists]);

  function pickFolder(id: string, label: string) {
    setSource("folder");
    setValue(id);
    setDisplayName(label);
    setPicker(null);
  }

  function pickPlaylist(id: string, name: string) {
    setSource("playlist");
    setValue(id);
    setDisplayName(name);
    setPicker(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setError("Seleccione una lista o una carpeta como origen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: {
        source: SourceKind;
        value: string;
        maxTracks: number;
        order: OrderKind;
        ignoreRepeatProtection: boolean;
        recurseSubfolders?: boolean;
        label?: string;
        insertAfterItemId?: string | null;
      } = {
        source,
        value: value.trim(),
        maxTracks: 1,
        order,
        ignoreRepeatProtection: ignoreRepeat,
        insertAfterItemId: insertAfterItemId ?? null,
        label: displayName.trim() || undefined,
      };
      if (source === "folder") body.recurseSubfolders = recurseSubfolders;

      const detail = await apiFetch<ApiPlaylistDetail>(
        `/api/playlists/${encodeURIComponent(playlistId)}/items/track-list`,
        { method: "POST", token, body: JSON.stringify(body) },
      );
      onInserted(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar la lista de pistas");
    } finally {
      setBusy(false);
    }
  }

  function openCreateEventHelp() {
    window.alert(
      "Modo Serie: la misma pista se repite hasta que un evento avance la posición.\n\n" +
        "Después de agregar la lista de pistas, cree un evento en Programador → asistente " +
        "«Reproducir una pista de carpeta o lista (Track List)» con el mismo origen.",
    );
    navigate("/scheduler");
  }

  if (!open) return null;

  return (
    <div className="music-library-tool-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog track-list-rb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="track-list-rb-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="track-list-rb-title" className="music-library-tool-dialog-title">
            Agregar lista de pistas
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <p className="muted small track-list-rb-lead">
          Aparece como <strong>un</strong> ítem en la lista. Al llegar su turno se elige{" "}
          <strong>una</strong> pista del origen (aleatorio, en orden o serie).
        </p>

        <form onSubmit={(e) => void onSubmit(e)} className="track-list-rb-form">
          <fieldset className="track-list-rb-fieldset">
            <legend>Origen de las pistas</legend>
            <div className="track-list-rb-source-row">
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy}
                onClick={() => setPicker("playlist")}
              >
                Seleccionar lista…
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy}
                onClick={() => setPicker("folder")}
              >
                Seleccionar carpeta…
              </button>
            </div>
            <div className="track-list-rb-source-value mono small" title={value || undefined}>
              {displayName || value ? (
                <>
                  <span className="muted">{source === "playlist" ? "Lista: " : "Carpeta: "}</span>
                  {displayName || value}
                </>
              ) : (
                <span className="muted">Ningún origen seleccionado</span>
              )}
            </div>
            {source === "folder" && value ? (
              <label className="track-list-rb-check">
                <input
                  type="checkbox"
                  checked={recurseSubfolders}
                  disabled={busy}
                  onChange={(e) => setRecurseSubfolders(e.target.checked)}
                />
                Incluir subcarpetas
              </label>
            ) : null}
          </fieldset>

          <fieldset className="track-list-rb-fieldset">
            <legend>Método de selección</legend>
            {(
              [
                ["random", "Aleatorio", "Evita repetir hasta agotar el origen."],
                ["sequential", "En orden", "Una tras otra (carpeta: por nombre de archivo)."],
                [
                  "series",
                  "Serie",
                  "Misma pista hasta avanzar con un evento programado.",
                ],
              ] as const
            ).map(([id, name, hint]) => (
              <label key={id} className="track-list-rb-radio">
                <input
                  type="radio"
                  name="track-list-order"
                  checked={order === id}
                  disabled={busy}
                  onChange={() => setOrder(id)}
                />
                <span>
                  <strong>{name}</strong>
                  <span className="muted small"> — {hint}</span>
                </span>
              </label>
            ))}
            {order === "series" ? (
              <button
                type="button"
                className="btn btn-compact mt"
                disabled={busy}
                onClick={() => openCreateEventHelp()}
              >
                Crear evento…
              </button>
            ) : null}
          </fieldset>

          <fieldset className="track-list-rb-fieldset">
            <legend>Protección de repetición</legend>
            <div className="track-list-rb-source-row">
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy}
                onClick={() => {
                  onClose();
                  navigate("/settings#track-list-repeat");
                }}
              >
                Protección de repetición…
              </button>
            </div>
            <label className="track-list-rb-check">
              <input
                type="checkbox"
                checked={ignoreRepeat}
                disabled={busy}
                onChange={(e) => setIgnoreRepeat(e.target.checked)}
              />
              Ignorar reglas de protección de repetición (jingles, IDs…)
            </label>
          </fieldset>

          {error ? <p className="error small">{error}</p> : null}

          <div className="track-list-rb-actions">
            <button type="button" className="btn btn-compact" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn primary btn-compact" disabled={busy || !value.trim()}>
              {busy ? "Agregando…" : "Aceptar"}
            </button>
          </div>
        </form>

        {picker ? (
          <div className="track-list-rb-picker" role="dialog" aria-label={picker === "folder" ? "Carpetas" : "Listas"}>
            <header className="track-list-rb-picker-head">
              <strong>{picker === "folder" ? "Seleccionar carpeta" : "Seleccionar lista"}</strong>
              <button type="button" className="btn btn-compact ghost" onClick={() => setPicker(null)}>
                ✕
              </button>
            </header>
            <input
              className="track-list-rb-picker-search"
              placeholder={picker === "folder" ? "Filtrar carpetas…" : "Filtrar listas…"}
              value={picker === "folder" ? folderFilter : playlistFilter}
              onChange={(e) =>
                picker === "folder" ? setFolderFilter(e.target.value) : setPlaylistFilter(e.target.value)
              }
            />
            <ul className="track-list-rb-picker-list">
              {picker === "folder"
                ? folderOptions.map((o) => (
                    <li key={o.id}>
                      <button type="button" className="track-list-rb-picker-item" onClick={() => pickFolder(o.id, o.label)}>
                        {o.label}
                      </button>
                    </li>
                  ))
                : playlistOptions.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="track-list-rb-picker-item"
                        onClick={() => pickPlaylist(o.id, o.name)}
                      >
                        {o.label}
                      </button>
                    </li>
                  ))}
            </ul>
            {(picker === "folder" ? folderOptions : playlistOptions).length === 0 ? (
              <p className="muted small">No hay opciones.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

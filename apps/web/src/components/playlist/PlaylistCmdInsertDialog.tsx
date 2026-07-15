import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/AuthContext";
import { apiFetch } from "../../lib/api";
import type { ApiPlaylist, ApiPlaylistDetail, PlaylistCmdAction } from "@radioflow/shared";

type Mode = "cmd" | "container";

type Props = {
  open: boolean;
  mode: Mode;
  playlistId: string;
  insertAfterItemId?: string | null;
  onClose: () => void;
  onInserted: (detail: ApiPlaylistDetail) => void;
};

const CMD_OPTIONS: { action: PlaylistCmdAction; label: string; detail: string }[] = [
  { action: "play", label: "Play", detail: "Inicia reproducción y sigue" },
  { action: "stop", label: "Stop", detail: "Pausa la cabina y sigue" },
  { action: "next", label: "Next", detail: "Salta al siguiente ítem" },
  { action: "clear", label: "Clear queue", detail: "Vacía la cola al aire" },
  { action: "load_playlist", label: "Load playlist", detail: "Carga otra lista en la cola" },
];

export function PlaylistCmdInsertDialog({
  open,
  mode,
  playlistId,
  insertAfterItemId = null,
  onClose,
  onInserted,
}: Props) {
  const { token } = useAuth();
  const [action, setAction] = useState<PlaylistCmdAction>("next");
  const [replace, setReplace] = useState(true);
  const [targetPlaylistId, setTargetPlaylistId] = useState("");
  const [label, setLabel] = useState("");
  const [lists, setLists] = useState<ApiPlaylist[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    setErr(null);
    setBusy(false);
    setAction("next");
    setReplace(true);
    setLabel("");
    void apiFetch<ApiPlaylist[]>("/api/playlists", { token })
      .then((rows) => {
        const others = rows.filter((p) => p.id !== playlistId);
        setLists(others);
        setTargetPlaylistId(others[0]?.id ?? "");
      })
      .catch(() => setLists([]));
  }, [open, token, playlistId]);

  if (!open) return null;

  const needsPlaylist = mode === "container" || action === "load_playlist";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const body =
        mode === "container"
          ? {
              kind: "container" as const,
              containerPlaylistId: targetPlaylistId,
              label: label.trim() || undefined,
              insertAfterItemId,
            }
          : {
              kind: "cmd" as const,
              label: label.trim() || undefined,
              cmdSpec: {
                action,
                ...(action === "load_playlist"
                  ? { playlistId: targetPlaylistId, replace }
                  : {}),
              },
              insertAfterItemId,
            };
      const updated = await apiFetch<ApiPlaylistDetail>(
        `/api/playlists/${encodeURIComponent(playlistId)}/items/command`,
        { method: "POST", token, body: JSON.stringify(body) },
      );
      onInserted(updated);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "No se pudo insertar");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="music-library-tool-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="music-library-tool-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-cmd-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header row between">
          <h2 id="playlist-cmd-title" className="music-library-tool-dialog-title">
            {mode === "container" ? "Insertar container…" : "Insertar comando…"}
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <form className="music-library-tool-dialog-body" onSubmit={(e) => void onSubmit(e)}>
          <p className="muted small">
            {mode === "container"
              ? "Al sincronizar la cola, se expanden los ítems de la lista anidada ( container)."
              : "Comandos de transporte/cola : se ejecutan al llegar al aire."}
          </p>
          {mode === "cmd" && (
            <fieldset className="voicetrack-duck-fieldset">
              <legend className="muted small">Acción</legend>
              {CMD_OPTIONS.map((opt) => (
                <label key={opt.action} className="voicetrack-duck-toggle">
                  <input
                    type="radio"
                    name="cmd-action"
                    checked={action === opt.action}
                    onChange={() => setAction(opt.action)}
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <span className="muted small"> — {opt.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {needsPlaylist && (
            <label className="field mt">
              <span className="muted small">Lista</span>
              <select
                value={targetPlaylistId}
                required
                onChange={(e) => setTargetPlaylistId(e.target.value)}
              >
                {lists.length === 0 ? (
                  <option value="">No hay otras listas</option>
                ) : (
                  lists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
            </label>
          )}
          {mode === "cmd" && action === "load_playlist" && (
            <label className="voicetrack-duck-toggle mt">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Reemplazar cola (si no, añadir al final)
            </label>
          )}
          <label className="field mt">
            <span className="muted small">Etiqueta (opcional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
          </label>
          {err ? <p className="form-error">{err}</p> : null}
          <div className="row tight mt">
            <button type="submit" className="btn primary" disabled={busy || (needsPlaylist && !targetPlaylistId)}>
              {busy ? "Insertando…" : "Insertar"}
            </button>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

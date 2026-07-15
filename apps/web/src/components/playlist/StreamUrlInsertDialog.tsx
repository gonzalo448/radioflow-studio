import { FormEvent, useEffect, useState } from "react";
import type { ApiPlaylistDetail } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";

type Props = {
  open: boolean;
  token: string;
  playlistId: string;
  insertAfterItemId?: string | null;
  onClose: () => void;
  onInserted: (detail: ApiPlaylistDetail) => void;
};

export function StreamUrlInsertDialog({
  open,
  token,
  playlistId,
  insertAfterItemId,
  onClose,
  onInserted,
}: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [durationSec, setDurationSec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setTitle("");
    setArtist("");
    setDurationSec("");
    setBusy(false);
    setError(null);
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setError("Ingrese una URL http:// o https://");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dur = durationSec.trim() ? Number(durationSec) : undefined;
      const detail = await apiFetch<ApiPlaylistDetail>(
        `/api/playlists/${encodeURIComponent(playlistId)}/items/stream-url`,
        {
          method: "POST",
          token,
          body: JSON.stringify({
            url: url.trim(),
            title: title.trim() || undefined,
            artist: artist.trim() || undefined,
            durationSec: dur != null && !Number.isNaN(dur) && dur > 0 ? Math.round(dur) : undefined,
            insertAfterItemId: insertAfterItemId ?? null,
          }),
        },
      );
      onInserted(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo añadir la URL");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog stream-url-insert-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stream-url-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header">
          <h2 id="stream-url-title" className="music-library-tool-dialog-title">
            Añadir URL / stream
          </h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <form onSubmit={(e) => void onSubmit(e)} className="stream-url-insert-form">
          <p className="muted small">
            Se registra en el catálogo y se inserta en la lista. Streams en vivo pueden no tener duración fija.
          </p>
          <label className="field">
            <span>URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ejemplo.com/stream.mp3"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>Título (opcional)</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
          </label>
          <label className="field">
            <span>Artista (opcional)</span>
            <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={500} />
          </label>
          <label className="field">
            <span>Duración estimada (seg, opcional)</span>
            <input
              type="number"
              min={1}
              value={durationSec}
              onChange={(e) => setDurationSec(e.target.value)}
              placeholder="Para planificación"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="music-library-tool-dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Añadiendo…" : "Añadir a la lista"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

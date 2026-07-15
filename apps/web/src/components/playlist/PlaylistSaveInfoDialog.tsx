import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { ApiPlaylistDetail } from "@radioflow/shared";

type Props = {
  open: boolean;
  token: string;
  playlistId: string;
  playlistName: string;
  itemCount: number;
  onClose: () => void;
};

export function PlaylistSaveInfoDialog({
  open,
  token,
  playlistId,
  playlistName,
  itemCount,
  onClose,
}: Props) {
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void apiFetch<ApiPlaylistDetail>(`/api/playlists/${encodeURIComponent(playlistId)}`, { token })
      .then((pl) => setUpdatedAt(pl.updatedAt ?? null))
      .catch(() => setUpdatedAt(null))
      .finally(() => setLoading(false));
  }, [open, playlistId, token]);

  if (!open) return null;

  const updatedLabel =
    updatedAt != null
      ? new Date(updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : loading
        ? "Consultando…"
        : "—";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-save-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header">
          <h2 id="playlist-save-info-title" className="music-library-tool-dialog-title">
            Guardar lista
          </h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="music-library-tool-dialog-body">
          <p className="muted small">
            En RadioFlow los cambios se guardan automáticamente en el servidor. No hace falta «Guardar» a mano como en
             con archivo local.
          </p>
          <dl className="playlist-save-info-dl mt">
            <div>
              <dt className="muted small">Lista</dt>
              <dd>{playlistName}</dd>
            </div>
            <div>
              <dt className="muted small">Ítems</dt>
              <dd className="mono">{itemCount}</dd>
            </div>
            <div>
              <dt className="muted small">Última modificación en servidor</dt>
              <dd>{updatedLabel}</dd>
            </div>
          </dl>
          <p className="muted small mt">
            Para una copia con otro nombre use <strong>Archivo → Guardar como…</strong>.
          </p>
        </div>
        <div className="music-library-tool-dialog-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

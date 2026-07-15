import { FormEvent, useEffect, useState } from "react";
import type { ApiPlaylistAutoIntroResult, ApiSettings } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";

type Props = {
  open: boolean;
  token: string;
  playlistId: string;
  onClose: () => void;
  onApplied: () => void;
};

export function AutoIntroDialog({ open, token, playlistId, onClose, onApplied }: Props) {
  const [folder, setFolder] = useState("intros");
  const [preview, setPreview] = useState<ApiPlaylistAutoIntroResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    void apiFetch<ApiSettings>("/api/settings", { token }).then((s) => {
      setFolder(s.autoIntroFolder ?? "intros");
    });
    setPreview(null);
    setError(null);
    setMsg(null);
  }, [open, token]);

  if (!open) return null;

  async function runPreview() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await apiFetch<ApiPlaylistAutoIntroResult>(
        `/api/playlists/${encodeURIComponent(playlistId)}/auto-intro`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ dryRun: true, folderPath: folder.trim() || undefined }),
        },
      );
      setPreview(r);
      setMsg(`${r.matches.length} coincidencia(s) en carpeta uploads/${r.folder.replace(/^uploads\//, "")}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo previsualizar");
    } finally {
      setBusy(false);
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault();
    if (!preview?.matches.length) {
      setError("Previsualice primero para ver coincidencias.");
      return;
    }
    if (
      !window.confirm(
        `¿Insertar ${preview.matches.length} intro(s) antes de las pistas correspondientes?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<ApiPlaylistAutoIntroResult>(
        `/api/playlists/${encodeURIComponent(playlistId)}/auto-intro`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ dryRun: false, folderPath: folder.trim() || undefined }),
        },
      );
      setMsg(`Insertadas ${r.inserted} intro(s).`);
      onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar auto intro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-intro-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header">
          <h2 id="auto-intro-title" className="music-library-tool-dialog-title">
            Auto intro
          </h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <form onSubmit={(e) => void apply(e)}>
          <p className="muted small">
            Busca intros en la carpeta de biblioteca (p. ej. <code>uploads/intros/</code>) cuyo nombre o artista
            coincida con cada pista de la lista abierta.
          </p>
          <label className="field mt">
            <span>Carpeta (bajo uploads/)</span>
            <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="intros" maxLength={64} />
          </label>
          <div className="row tight mt">
            <button type="button" className="btn btn-compact" disabled={busy} onClick={() => void runPreview()}>
              Previsualizar
            </button>
          </div>
          {preview && preview.matches.length > 0 ? (
            <ul className="small mt auto-intro-preview-list">
              {preview.matches.slice(0, 12).map((m) => (
                <li key={m.trackItemId}>
                  <strong>{m.artist}</strong> → {m.introTitle}
                  {m.matchSource === "id3" ? (
                    <span className="muted"> (ID3)</span>
                  ) : null}
                </li>
              ))}
              {preview.matches.length > 12 ? (
                <li className="muted">… y {preview.matches.length - 12} más</li>
              ) : null}
            </ul>
          ) : preview ? (
            <p className="muted small mt">Sin coincidencias en esta lista.</p>
          ) : null}
          {msg ? <p className="small mt">{msg}</p> : null}
          {error ? <p className="error small mt">{error}</p> : null}
          <div className="music-library-tool-dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cerrar
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !preview?.matches.length}
            >
              Insertar intros
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

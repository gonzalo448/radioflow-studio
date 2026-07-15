import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { VoicetrackRecordDialog } from "../components/playlist/VoicetrackRecordDialog";
import type { ApiPlaylistListItem } from "@radioflow/shared";

/**
 * Editor dedicado de voicetrack (fase extra): grabación, trim y destino de lista.
 */
export function VoicetrackEditorPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [playlists, setPlaylists] = useState<ApiPlaylistListItem[]>([]);
  const [playlistId, setPlaylistId] = useState(searchParams.get("playlistId") ?? "");

  useEffect(() => {
    if (!token) return;
    void apiFetch<ApiPlaylistListItem[]>("/api/playlists", { token })
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, [token]);

  useEffect(() => {
    if (playlistId) {
      const next = new URLSearchParams(searchParams);
      next.set("playlistId", playlistId);
      setSearchParams(next, { replace: true });
    }
  }, [playlistId, searchParams, setSearchParams]);

  if (!token) {
    return (
      <section className="card">
        <h1>Editor de voicetrack</h1>
        <p className="muted">
          <Link to="/login">Inicia sesión</Link> para grabar locuciones.
        </p>
      </section>
    );
  }

  return (
    <section className="card voicetrack-editor-page">
      <h1>Editor de voicetrack</h1>
      <p className="muted">
        Grabación con ducking de la cama musical, monitor en auriculares y recorte de inicio/fin antes de guardar en la
        bóveda. También disponible en <strong>Lista → Insertar voicetrack…</strong>.
      </p>

      <label className="field mt">
        <span className="muted small">Lista destino</span>
        <select
          className="voicetrack-editor-playlist-select"
          value={playlistId}
          onChange={(e) => setPlaylistId(e.target.value)}
        >
          <option value="">Elija una lista…</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p._count.items} ítems)
            </option>
          ))}
        </select>
      </label>

      {!playlistId ? (
        <p className="muted small mt">Seleccione la lista donde se insertará la locución.</p>
      ) : (
        <VoicetrackRecordDialog
          embedded
          open
          token={token}
          playlistId={playlistId}
          onClose={() => {}}
          onInserted={() => {}}
        />
      )}

      <p className="muted small mt">
        <Link to="/station">Cabina</Link> · <Link to="/library?folder=voicetracks">Biblioteca / voicetracks</Link>
      </p>
    </section>
  );
}

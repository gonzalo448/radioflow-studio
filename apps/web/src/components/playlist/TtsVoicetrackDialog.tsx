import { FormEvent, useState } from "react";
import type { ApiPlaylistDetail } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";
import { notifyLibraryChanged } from "../../lib/local-audio-import";

type Props = {
  open: boolean;
  token: string;
  playlistId: string;
  insertAfterItemId?: string | null;
  onClose: () => void;
  onInserted: (detail: ApiPlaylistDetail) => void;
};

export function TtsVoicetrackDialog({
  open,
  token,
  playlistId,
  insertAfterItemId,
  onClose,
  onInserted,
}: Props) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [lang, setLang] = useState("es");
  const [engine, setEngine] = useState<"auto" | "sapi" | "espeak" | "edge-tts" | "piper">("auto");
  const [rate, setRate] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Escribí el texto a sintetizar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const detail = await apiFetch<ApiPlaylistDetail>(
        `/api/playlists/${encodeURIComponent(playlistId)}/items/tts`,
        {
          method: "POST",
          token,
          body: JSON.stringify({
            text: text.trim(),
            title: title.trim() || undefined,
            label: label.trim() || undefined,
            insertAfterItemId: insertAfterItemId ?? null,
            lang,
            rate,
            engine: engine === "auto" ? undefined : engine,
          }),
        },
      );
      notifyLibraryChanged();
      onInserted(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la locución TTS");
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
        aria-labelledby="tts-vt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header">
          <h2 id="tts-vt-title" className="music-library-tool-dialog-title">
            Insertar locución TTS
          </h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <form onSubmit={(e) => void submit(e)}>
          <p className="muted small">
            Sintetiza voz desde texto (SAPI, espeak, edge-tts o Piper según servidor). Se guarda en biblioteca e
            inserta como voicetrack.
          </p>
          <label className="field mt">
            <span>Texto</span>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Buenos días, esto es RadioFlow…"
              maxLength={4000}
            />
          </label>
          <label className="field mt">
            <span>Título en biblioteca (opcional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <label className="field mt">
            <span>Etiqueta en lista (opcional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={500} />
          </label>
          <div className="row tight mt" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "1 1 10rem" }}>
              <span>Motor</span>
              <select value={engine} onChange={(e) => setEngine(e.target.value as typeof engine)}>
                <option value="auto">Automático</option>
                <option value="sapi">SAPI (Windows)</option>
                <option value="espeak">espeak-ng</option>
                <option value="edge-tts">edge-tts</option>
                <option value="piper">Piper</option>
              </select>
            </label>
            <label className="field" style={{ flex: "1 1 8rem" }}>
              <span>Idioma</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="pt">Português</option>
                <option value="fr">Français</option>
              </select>
            </label>
            <label className="field" style={{ flex: "2 1 12rem" }}>
              <span>Velocidad ({rate.toFixed(2)}×)</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </label>
          </div>
          {error ? <p className="error small mt">{error}</p> : null}
          <div className="music-library-tool-dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Generando…" : "Insertar locución"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

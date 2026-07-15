import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/AuthContext";
import { apiFetch } from "../../lib/api";
import type { ApiPlaylistDetail } from "@radioflow/shared";

type Props = {
  open: boolean;
  playlistId: string;
  /** Ítems seleccionados en el editor (modo «seleccionados»). */
  selectedItemIds: string[];
  onClose: () => void;
  onDone: (detail: ApiPlaylistDetail) => void;
  /** Llamar antes del POST (pila deshacer). */
  onBeforeApply?: () => void;
};

export function InterleaveJinglesDialog({
  open,
  playlistId,
  selectedItemIds,
  onClose,
  onDone,
  onBeforeApply,
}: Props) {
  const { token } = useAuth();
  const [everyN, setEveryN] = useState(3);
  const [mode, setMode] = useState<"auto" | "selected">("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEveryN(3);
    setMode(selectedItemIds.length > 0 ? "selected" : "auto");
    setErr(null);
    setBusy(false);
  }, [open, selectedItemIds.length]);

  if (!open) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      onBeforeApply?.();
      const updated = await apiFetch<ApiPlaylistDetail>(
        `/api/playlists/${encodeURIComponent(playlistId)}/items/interleave-jingles`,
        {
          method: "POST",
          token,
          body: JSON.stringify({
            everyN,
            mode,
            ...(mode === "selected" ? { jingleItemIds: selectedItemIds } : {}),
          }),
        },
      );
      onDone(updated);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "No se pudo intercalar");
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
        aria-labelledby="interleave-jingles-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header row between">
          <h2 id="interleave-jingles-title" className="music-library-tool-dialog-title">
            Intercalar jingles…
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <form className="music-library-tool-dialog-body" onSubmit={(e) => void onSubmit(e)}>
          <p className="muted small">
            Reordena esta lista: <strong>N canciones</strong> y luego un jingle, y se repite. No hace falta el
            generador Pro.
          </p>
          <label className="muted small voicetrack-duck-slider">
            Canciones entre cada jingle
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={everyN}
              onChange={(e) => setEveryN(Number(e.target.value))}
            />
            <span className="mono">{everyN}</span>
          </label>
          <fieldset className="voicetrack-duck-fieldset mt">
            <legend className="muted small">Cuáles son jingles</legend>
            <label className="voicetrack-duck-toggle">
              <input
                type="radio"
                name="jingle-mode"
                checked={mode === "auto"}
                onChange={() => setMode("auto")}
              />
              Auto (género / carpeta / título con jingle, promo, ID…)
            </label>
            <label className="voicetrack-duck-toggle">
              <input
                type="radio"
                name="jingle-mode"
                checked={mode === "selected"}
                onChange={() => setMode("selected")}
                disabled={selectedItemIds.length === 0}
              />
              Ítems seleccionados ({selectedItemIds.length})
            </label>
          </fieldset>
          {err ? <p className="form-error">{err}</p> : null}
          <div className="row tight mt">
            <button
              type="submit"
              className="btn primary"
              disabled={busy || (mode === "selected" && selectedItemIds.length === 0)}
            >
              {busy ? "Aplicando…" : "Intercalar"}
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

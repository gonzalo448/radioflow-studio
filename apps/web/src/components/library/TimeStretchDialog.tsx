import { FormEvent, useState } from "react";
import { apiFetch } from "../../lib/api";

type Props = {
  open: boolean;
  token: string;
  assetIds: string[];
  onClose: () => void;
  onJobQueued: (jobId: string) => void;
};

export function TimeStretchDialog({ open, token, assetIds, onClose, onJobQueued }: Props) {
  const [tempoRatio, setTempoRatio] = useState(1.1);
  const [apply, setApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (assetIds.length === 0) {
      setError("Seleccione pistas en la lista o abra la biblioteca con selección.");
      return;
    }
    if (apply && !window.confirm("¿Modificar los archivos en la bóveda con time stretch?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ jobId: string }>("/api/library/process-jobs", {
        method: "POST",
        token,
        body: JSON.stringify({
          kind: "time_stretch",
          assetIds: assetIds.slice(0, 200),
          apply,
          policy: { tempoRatio },
        }),
      });
      onJobQueued(r.jobId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo encolar time stretch");
    } finally {
      setBusy(false);
    }
  }

  const pct = Math.round((tempoRatio - 1) * 100);
  const pctLabel = pct === 0 ? "sin cambio" : pct > 0 ? `${pct}% más rápido` : `${Math.abs(pct)}% más lento`;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="time-stretch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header">
          <h2 id="time-stretch-title" className="music-library-tool-dialog-title">
            Time stretch
          </h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <form onSubmit={(e) => void submit(e)}>
          <p className="muted small">
            Cambia la velocidad sin alterar el tono (ffmpeg <code>atempo</code>). Ámbito:{" "}
            <strong>{assetIds.length}</strong> pista(s).
          </p>
          <label className="field mt">
            <span>
              Tempo {tempoRatio.toFixed(2)}× ({pctLabel})
            </span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={tempoRatio}
              onChange={(e) => setTempoRatio(Number(e.target.value))}
            />
          </label>
          <label className="field mt row tight">
            <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
            <span>Aplicar a archivos en bóveda (si no, solo simular)</span>
          </label>
          {error ? <p className="error small mt">{error}</p> : null}
          <div className="music-library-tool-dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={busy || assetIds.length === 0}>
              {busy ? "Encolando…" : apply ? "Aplicar time stretch" : "Simular"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { FormEvent, useState } from "react";

const DTMF_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#"] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (digit: string) => void | Promise<void>;
};

export function DtmfInsertDialog({ open, onClose, onSelect }: Props) {
  const [digit, setDigit] = useState("5");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSelect(digit);
      onClose();
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
        aria-labelledby="dtmf-insert-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header">
          <h2 id="dtmf-insert-title" className="music-library-tool-dialog-title">
            Insertar comando DTMF
          </h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <form onSubmit={(e) => void submit(e)}>
          <p className="muted small">
            Al pasar este punto en la cola se dispara la acción DTMF configurada en cabina.
          </p>
          <label className="field mt">
            <span>Tecla</span>
            <select value={digit} onChange={(e) => setDigit(e.target.value)}>
              {DTMF_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <div className="music-library-tool-dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              Insertar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  title: string;
  initialName: string;
  confirmLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
};

/** Diálogo compacto para crear o renombrar una pestaña de lista. */
export function PlaylistTabNameDialog({
  open,
  title,
  initialName,
  confirmLabel = "Aceptar",
  busy,
  onClose,
  onConfirm,
}: Props) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(t);
  }, [initialName, open]);

  if (!open) return null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  }

  return (
    <div className="music-library-tool-overlay rb-pl-tab-dialog-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog rb-pl-tab-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rb-pl-tab-name-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="rb-pl-tab-name-title" className="music-library-tool-dialog-title">
            {title}
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <form onSubmit={onSubmit} className="rb-pl-tab-name-form">
          <label className="music-library-field">
            <span>Nombre</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <div className="row tight rb-pl-tab-name-actions">
            <button type="button" className="btn btn-compact" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn primary btn-compact" disabled={busy || !name.trim()}>
              {busy ? "…" : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

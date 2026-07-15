import { FormEvent, useEffect, useState } from "react";
import type { ApiLibraryAsset, ApiSettings } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";

type Props = {
  open: boolean;
  token: string;
  assetIds: string[];
  assets: ApiLibraryAsset[];
  onClose: () => void;
  onUpdated: () => void;
};

export function LibraryCustomFieldsDialog({ open, token, assetIds, assets, onClose, onUpdated }: Props) {
  const [labels, setLabels] = useState(["", "", "", "", ""]);
  const [values, setValues] = useState(["", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    void apiFetch<ApiSettings>("/api/settings", { token }).then((s) => {
      setLabels(s.libraryCustomFieldLabels?.slice(0, 5) ?? []);
    });
    if (assetIds.length === 1) {
      const a = assets.find((x) => x.id === assetIds[0]);
      setValues([
        a?.customField1 ?? "",
        a?.customField2 ?? "",
        a?.customField3 ?? "",
        a?.customField4 ?? "",
        a?.customField5 ?? "",
      ]);
    } else {
      setValues(["", "", "", "", ""]);
    }
    setError(null);
    setMsg(null);
  }, [open, token, assetIds, assets]);

  if (!open) return null;

  async function saveLabels(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch<ApiSettings>("/api/settings", {
        method: "PATCH",
        token,
        body: JSON.stringify({ libraryCustomFieldLabels: labels }),
      });
      setMsg("Etiquetas guardadas.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar las etiquetas");
    } finally {
      setBusy(false);
    }
  }

  async function saveValues(e: FormEvent) {
    e.preventDefault();
    if (assetIds.length === 0) {
      setError("Seleccione al menos una pista.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        customField1: values[0].trim() || null,
        customField2: values[1].trim() || null,
        customField3: values[2].trim() || null,
        customField4: values[3].trim() || null,
        customField5: values[4].trim() || null,
      };
      for (const id of assetIds.slice(0, 200)) {
        await apiFetch(`/api/library/assets/${encodeURIComponent(id)}`, {
          method: "PATCH",
          token,
          body: JSON.stringify(body),
        });
      }
      setMsg(`Valores aplicados a ${assetIds.length} pista(s).`);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los valores");
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
        aria-labelledby="custom-fields-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header">
          <h2 id="custom-fields-title" className="music-library-tool-dialog-title">
            Campos personalizados
          </h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <p className="muted small">
          5 campos de usuario por pista. Las etiquetas son globales; los valores se editan por
          selección.
        </p>

        <form onSubmit={(e) => void saveLabels(e)} className="mt">
          <h3 className="h3">Etiquetas (Marca)</h3>
          {labels.map((label, i) => (
            <label key={i} className="field">
              <span>Campo {i + 1}</span>
              <input
                value={label}
                maxLength={64}
                onChange={(e) => {
                  const next = [...labels];
                  next[i] = e.target.value;
                  setLabels(next);
                }}
              />
            </label>
          ))}
          <button type="submit" className="btn btn-compact mt" disabled={busy}>
            Guardar etiquetas
          </button>
        </form>

        <form onSubmit={(e) => void saveValues(e)} className="mt">
          <h3 className="h3">Valores ({assetIds.length} pista(s))</h3>
          {values.map((val, i) => (
            <label key={i} className="field">
              <span>{labels[i] || `Campo ${i + 1}`}</span>
              <input
                value={val}
                maxLength={500}
                disabled={assetIds.length === 0}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  setValues(next);
                }}
              />
            </label>
          ))}
          <div className="music-library-tool-dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cerrar
            </button>
            <button type="submit" className="btn primary" disabled={busy || assetIds.length === 0}>
              Aplicar a selección
            </button>
          </div>
        </form>
        {msg ? <p className="small mt">{msg}</p> : null}
        {error ? <p className="error small mt">{error}</p> : null}
      </div>
    </div>
  );
}

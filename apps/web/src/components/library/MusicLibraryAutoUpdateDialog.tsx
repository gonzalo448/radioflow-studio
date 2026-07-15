import { FormEvent, useCallback, useEffect, useState } from "react";
import type {
  ApiLibraryAutoUpdateConfig,
  ApiLibraryAutoUpdatePatchBody,
  ApiLibraryFolderRow,
} from "@radioflow/shared";
import { apiFetch } from "../../lib/api";
import { folderDisplayName } from "../../lib/library-folder";

type Props = {
  open: boolean;
  token: string;
  onClose: () => void;
  onSaved?: () => void;
};

export function MusicLibraryAutoUpdateDialog({ open, token, onClose, onSaved }: Props) {
  const [config, setConfig] = useState<ApiLibraryAutoUpdateConfig | null>(null);
  const [folders, setFolders] = useState<ApiLibraryFolderRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      apiFetch<ApiLibraryAutoUpdateConfig>("/api/library/auto-update", { token }),
      apiFetch<{ folders: ApiLibraryFolderRow[] }>("/api/library/folders", { token }),
    ]);
    setConfig(c);
    setFolders(f.folders);
  }, [token]);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "Error al cargar"));
  }, [load, open]);

  if (!open) return null;

  async function save(patch: ApiLibraryAutoUpdatePatchBody) {
    setBusy(true);
    setMsg(null);
    try {
      const c = await apiFetch<ApiLibraryAutoUpdateConfig>("/api/library/auto-update", {
        method: "PUT",
        token,
        body: JSON.stringify(patch),
      });
      setConfig(c);
      onSaved?.();
      setMsg("Configuración guardada.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!config) return;
    await save({
      enabled: config.enabled,
      intervalMinutes: config.intervalMinutes,
      folderPrefixes: config.folderPrefixes,
    });
  }

  async function runNow() {
    setBusy(true);
    setMsg(null);
    try {
      const c = await apiFetch<ApiLibraryAutoUpdateConfig>("/api/library/auto-update/run", {
        method: "POST",
        token,
      });
      setConfig(c);
      onSaved?.();
      const r = c.lastResult;
      setMsg(
        r
          ? `Escaneo: ${r.created} nuevas · ${r.skippedExisting} ya en catálogo · ${r.scanned} archivos`
          : "Escaneo completado.",
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al escanear");
    } finally {
      setBusy(false);
    }
  }

  function toggleFolder(prefix: string) {
    if (!config) return;
    const set = new Set(config.folderPrefixes);
    if (set.has(prefix)) set.delete(prefix);
    else set.add(prefix);
    setConfig({ ...config, folderPrefixes: [...set] });
  }

  return (
    <div className="music-library-tool-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog music-library-auto-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ml-auto-update-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="ml-auto-update-title" className="music-library-tool-dialog-title">
            Actualización automática de biblioteca
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <p className="muted small">
          : escanea carpetas bajo la bóveda (<code>uploads/…</code>) y registra archivos nuevos que
          aún no estén en el catálogo. Puede copiar MP3 directamente a esas carpetas desde el explorador de Windows.
        </p>

        {!config ? (
          <p className="muted">Cargando…</p>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)}>
            <label className="row tight" style={{ gap: "0.5rem", marginBottom: "0.75rem" }}>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              />
              <span>Activar escaneo automático</span>
            </label>

            <label className="small" style={{ display: "block", marginBottom: "0.35rem" }}>
              Intervalo (minutos)
            </label>
            <input
              type="number"
              className="library-filters-search"
              min={5}
              max={1440}
              value={config.intervalMinutes}
              onChange={(e) => setConfig({ ...config, intervalMinutes: Number(e.target.value) || 60 })}
              style={{ maxWidth: "8rem", marginBottom: "0.75rem" }}
            />

            <p className="small" style={{ marginBottom: "0.35rem" }}>
              Carpetas vigiladas <span className="muted">(vacío = todas bajo uploads/)</span>
            </p>
            <ul className="music-library-auto-update-folders">
              {folders.map((f) => (
                <li key={f.name}>
                  <label className="row tight">
                    <input
                      type="checkbox"
                      checked={config.folderPrefixes.includes(f.name)}
                      onChange={() => toggleFolder(f.name)}
                    />
                    <span>
                      {folderDisplayName(f.name)} <span className="muted">({f.count})</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {config.lastRunAt ? (
              <p className="muted small" style={{ marginTop: "0.65rem" }}>
                Último escaneo: {new Date(config.lastRunAt).toLocaleString()}
                {config.lastResult
                  ? ` · +${config.lastResult.created} / ${config.lastResult.scanned} archivos`
                  : ""}
              </p>
            ) : null}

            <div className="row tight" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.85rem" }}>
              <button type="submit" className="btn primary btn-compact" disabled={busy}>
                Guardar
              </button>
              <button type="button" className="btn btn-compact" disabled={busy} onClick={() => void runNow()}>
                Escanear ahora
              </button>
            </div>
          </form>
        )}

        {msg ? <p className="small mt">{msg}</p> : null}
      </div>
    </div>
  );
}

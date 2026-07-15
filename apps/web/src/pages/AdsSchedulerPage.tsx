import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ApiAdBreakLogRow,
  ApiAdSchedulerConfig,
  ApiAdSchedulerConfigPatchBody,
  ApiAdSpotRow,
  ApiLibraryFolderRow,
} from "@radioflow/shared";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { useStationLive } from "../station/StationLiveContext";
import { folderDisplayName } from "../lib/library-folder";

export function AdsSchedulerPage() {
  const { token, user } = useAuth();
  const { refresh } = useStationLive();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const canOperate = Boolean(token) && (canEdit || user?.role === "dj");

  const [config, setConfig] = useState<ApiAdSchedulerConfig | null>(null);
  const [spots, setSpots] = useState<ApiAdSpotRow[]>([]);
  const [logs, setLogs] = useState<ApiAdBreakLogRow[]>([]);
  const [folders, setFolders] = useState<ApiLibraryFolderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const cfg = await apiFetch<ApiAdSchedulerConfig>("/api/ads/config");
      setConfig(cfg);
      const spotRows = await apiFetch<ApiAdSpotRow[]>(
        `/api/ads/spots?pathPrefix=${encodeURIComponent(cfg.pathPrefix)}`,
      );
      setSpots(spotRows);
      if (token && canEdit) {
        const logRows = await apiFetch<ApiAdBreakLogRow[]>("/api/ads/logs", { token });
        setLogs(logRows);
      }
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar publicidad");
    }
  }, [canEdit, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ folders: ApiLibraryFolderRow[] }>("/api/library/folders", { token })
      .then((r) => setFolders(r.folders))
      .catch(() => setFolders([]));
  }, [token]);

  async function saveConfig(patch: ApiAdSchedulerConfigPatchBody) {
    if (!token || !canEdit) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const updated = await apiFetch<ApiAdSchedulerConfig>("/api/ads/config", {
        method: "PATCH",
        token,
        body: JSON.stringify(patch),
      });
      setConfig(updated);
      const spotRows = await apiFetch<ApiAdSpotRow[]>(
        `/api/ads/spots?pathPrefix=${encodeURIComponent(updated.pathPrefix)}`,
      );
      setSpots(spotRows);
      setMsg("Configuración guardada.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!config) return;
    void saveConfig({
      enabled: config.enabled,
      pathPrefix: config.pathPrefix,
      intervalMinutes: config.intervalMinutes,
      spotsPerBreak: config.spotsPerBreak,
      maxSpotsPerHour: config.maxSpotsPerHour,
      minGapMinutes: config.minGapMinutes,
      rotationMode: config.rotationMode,
    });
  }

  async function insertBreakNow() {
    if (!token || !canOperate) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const result = await apiFetch<{ insertedCount: number; assetIds: string[] }>("/api/ads/break", {
        method: "POST",
        token,
        body: JSON.stringify({}),
      });
      setMsg(`${result.insertedCount} spot(s) encolado(s) después de la pista al aire.`);
      await refresh();
      if (canEdit) {
        const logRows = await apiFetch<ApiAdBreakLogRow[]>("/api/ads/logs", { token });
        setLogs(logRows);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo insertar el bloque");
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <section className="card">
        <h1>Planificador de publicidad</h1>
        <p className="muted">Cargando…</p>
        {err ? <p className="error">{err}</p> : null}
      </section>
    );
  }

  return (
    <section className="card ads-scheduler-page">
      <h1>Planificador de publicidad</h1>
      <p className="muted">
        Planificador de publicidad: spots desde una carpeta de la bóveda, inserción automática cada N minutos y
        bloques manuales o programados. Los spots se encolan <strong>después de la pista al aire</strong>.
      </p>
      <p className="muted small">
        Importe audios a <code className="mono">publicidad/</code> en la bóveda desde{" "}
        <Link to="/library">Biblioteca musical</Link> o el <Link to="/explorador">explorador</Link>.
      </p>

      {!canEdit && <p className="muted">Solo lectura — requiere editor o admin para cambiar reglas.</p>}
      {err ? <p className="error">{err}</p> : null}
      {msg ? <p className="badge">{msg}</p> : null}

      <form className="form inline-grid ads-scheduler-form" onSubmit={onSubmit}>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={!canEdit || busy}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          />
          Automatización activa (modos AUTO / LIVE ASSIST)
        </label>

        <label>
          Carpeta de spots (prefijo en bóveda)
          <input
            list="ads-folder-list"
            value={config.pathPrefix}
            disabled={!canEdit || busy}
            onChange={(e) => setConfig({ ...config, pathPrefix: e.target.value })}
            required
          />
          <datalist id="ads-folder-list">
            {folders.map((f) => (
              <option key={f.name} value={f.name}>
                {folderDisplayName(f.name)}
              </option>
            ))}
          </datalist>
        </label>

        <label>
          Intervalo entre bloques (min)
          <input
            type="number"
            min={1}
            max={240}
            value={config.intervalMinutes}
            disabled={!canEdit || busy}
            onChange={(e) => setConfig({ ...config, intervalMinutes: Number(e.target.value) || 15 })}
          />
        </label>

        <label>
          Spots por bloque
          <input
            type="number"
            min={1}
            max={10}
            value={config.spotsPerBreak}
            disabled={!canEdit || busy}
            onChange={(e) => setConfig({ ...config, spotsPerBreak: Number(e.target.value) || 2 })}
          />
        </label>

        <label>
          Máx. spots por hora
          <input
            type="number"
            min={1}
            max={60}
            value={config.maxSpotsPerHour}
            disabled={!canEdit || busy}
            onChange={(e) => setConfig({ ...config, maxSpotsPerHour: Number(e.target.value) || 8 })}
          />
        </label>

        <label>
          Separación mínima (min)
          <input
            type="number"
            min={0}
            max={120}
            value={config.minGapMinutes}
            disabled={!canEdit || busy}
            onChange={(e) => setConfig({ ...config, minGapMinutes: Number(e.target.value) || 5 })}
          />
        </label>

        <label>
          Rotación
          <select
            className="select"
            value={config.rotationMode}
            disabled={!canEdit || busy}
            onChange={(e) => setConfig({ ...config, rotationMode: e.target.value as "random" | "sequential" })}
          >
            <option value="random">Aleatoria</option>
            <option value="sequential">Secuencial</option>
          </select>
        </label>

        {canEdit ? (
          <button type="submit" className="btn primary" disabled={busy}>
            Guardar reglas
          </button>
        ) : null}
      </form>

      <div className="ads-scheduler-status muted small">
        <span>Esta hora: {config.spotsThisHour} / {config.maxSpotsPerHour} spots</span>
        {config.lastBreakAt ? (
          <span> · Último bloque: {new Date(config.lastBreakAt).toLocaleString()}</span>
        ) : (
          <span> · Sin bloques recientes</span>
        )}
      </div>

      {canOperate ? (
        <div className="row tight mt">
          <button type="button" className="btn primary" disabled={busy || spots.length === 0} onClick={() => void insertBreakNow()}>
            Insertar bloque ahora
          </button>
          <Link to="/scheduler" className="btn btn-compact">
            Programar evento…
          </Link>
        </div>
      ) : null}

      <h3 className="mt">Spots en catálogo ({spots.length})</h3>
      {spots.length === 0 ? (
        <p className="muted">No hay pistas en «{config.pathPrefix}». Suba spots a esa carpeta.</p>
      ) : (
        <ul className="list ads-spot-list">
          {spots.slice(0, 50).map((s) => (
            <li key={s.id}>
              <strong>{s.title}</strong>
              {s.artist ? <span className="muted"> — {s.artist}</span> : null}
              <span className="muted small"> · {s.path}</span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && logs.length > 0 ? (
        <>
          <h3 className="mt">Historial reciente</h3>
          <ul className="list ads-log-list">
            {logs.slice(0, 15).map((l) => (
              <li key={l.id} className="muted small">
                {new Date(l.createdAt).toLocaleString()} · {l.source} · {l.assetIds.length} spot(s)
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

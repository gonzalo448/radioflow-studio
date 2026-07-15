import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import type { ApiStreamRecordingStatus, ApiStreamRecordingStopResult } from "@radioflow/shared";

export function StreamRecordingPanel() {
  const { token } = useAuth();
  const [status, setStatus] = useState<ApiStreamRecordingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setStatus(null);
      return;
    }
    try {
      const data = await apiFetch<ApiStreamRecordingStatus>("/api/streaming/record/status", { token });
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!token) {
    return <p className="muted small">Inicia sesión para grabar el stream al aire.</p>;
  }

  async function start() {
    setBusy(true);
    setMsg(null);
    try {
      const data = await apiFetch<ApiStreamRecordingStatus>("/api/streaming/record/start", {
        method: "POST",
        token,
      });
      setStatus(data);
      setMsg("Grabación iniciada.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo iniciar");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setMsg(null);
    try {
      const data = await apiFetch<ApiStreamRecordingStopResult>("/api/streaming/record/stop", {
        method: "POST",
        token,
      });
      setStatus(data.status);
      if (data.addedToLibrary && data.relPath) {
        setMsg(
          `Grabación guardada (${data.durationSec ?? "?"} s) en ${data.relPath}${data.assetId ? " · añadida a biblioteca" : ""}.`,
        );
      } else {
        setMsg("Grabación detenida.");
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo detener");
    } finally {
      setBusy(false);
    }
  }

  const active = status?.active ?? false;

  return (
    <div className="card stream-recording-panel mt">
      <h2>Grabación de stream</h2>
      <p className="muted small">
        Captura la salida Icecast del destino activo con ffmpeg (<code>-c copy</code>). Requiere encoder conectado y{" "}
        <code>AUDIO_FFMPEG_ENABLED=1</code>.
      </p>
      <dl className="broadcast-status-dl">
        <div>
          <dt>Estado</dt>
          <dd>{active ? "Grabando" : "Detenido"}</dd>
        </div>
        {status?.targetName ? (
          <div>
            <dt>Destino</dt>
            <dd>{status.targetName}</dd>
          </div>
        ) : null}
        {status?.relPath && active ? (
          <div>
            <dt>Archivo</dt>
            <dd className="mono small">{status.relPath}</dd>
          </div>
        ) : null}
        {status?.startedAt && active ? (
          <div>
            <dt>Inicio</dt>
            <dd>{new Date(status.startedAt).toLocaleString()}</dd>
          </div>
        ) : null}
      </dl>
      <div className="row tight mt">
        {!active ? (
          <button type="button" className="btn primary btn-compact" disabled={busy} onClick={() => void start()}>
            Iniciar grabación
          </button>
        ) : (
          <button type="button" className="btn danger btn-compact" disabled={busy} onClick={() => void stop()}>
            Detener y guardar
          </button>
        )}
      </div>
      {msg ? <p className="small mt">{msg}</p> : null}
    </div>
  );
}

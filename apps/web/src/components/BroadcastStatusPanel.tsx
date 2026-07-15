import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import type { ApiBroadcastStatus } from "@radioflow/shared";

export function BroadcastStatusPanel({ compact }: { compact?: boolean }) {
  const { token } = useAuth();
  const [status, setStatus] = useState<ApiBroadcastStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setStatus(null);
      return;
    }
    try {
      const data = await apiFetch<ApiBroadcastStatus>("/api/streaming/broadcast-status", { token });
      setStatus(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setStatus(null);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!token) {
    return <p className="muted small">Inicia sesión para ver estado de emisión e Icecast.</p>;
  }

  if (err) return <p className="error small">{err}</p>;
  if (!status) return <p className="muted small">Cargando estado de emisión…</p>;

  const enc = status.encoder;
  const ice = status.icecast;

  return (
    <div className={compact ? "broadcast-status broadcast-status--compact" : "broadcast-status tile"}>
      <h3 className={compact ? "h3" : "mt"}>Emisión al aire</h3>
      <dl className="broadcast-status-dl">
        {status.nowPlaying?.coverUrl ? (
          <div className="broadcast-status-cover-row">
            <dt>Carátula</dt>
            <dd>
              <img
                className="broadcast-status-cover"
                src={status.nowPlaying.coverUrl}
                alt=""
                width={64}
                height={64}
              />
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Aire (C1)</dt>
          <dd>
            {status.airPath === "encoder" ? "encoder" : "—"}
            {status.broadcastEnabled ? " · Emitir ON" : " · Emitir off"}
            {status.publicListenUrl ? (
              <>
                {" · "}
                <span className="mono small">{status.publicListenUrl}</span>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Cabina (cola)</dt>
          <dd>
            {status.nowPlaying
              ? `${status.nowPlaying.artist ? `${status.nowPlaying.artist} — ` : ""}${status.nowPlaying.title}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Encoder</dt>
          <dd>
            {!enc ? (
              <span className="muted">Sin señal (¿corre el contenedor/servicio encoder?)</span>
            ) : enc.stale ? (
              <span className="muted">Sin respuesta reciente</span>
            ) : enc.ffmpegActive ? (
              <span>Publicando · {enc.title ?? "—"}</span>
            ) : (
              <span className="muted">
                Inactivo
                {enc.lastFfmpegExitCode != null ? ` (último exit ${enc.lastFfmpegExitCode})` : ""}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Icecast</dt>
          <dd>
            {status.activeTarget ? (
              <>
                {status.activeTarget.name}
                {ice.listeners != null ? ` · ${ice.listeners} oyente${ice.listeners === 1 ? "" : "s"}` : ""}
                {ice.streamTitle ? (
                  <>
                    {" "}
                    · <span className="muted">meta: {ice.streamTitle}</span>
                  </>
                ) : null}
                {ice.sourceConnected === false ? (
                  <span className="error"> · sin fuente en el mount</span>
                ) : null}
              </>
            ) : (
              <span className="muted">Configure un destino en Emitir</span>
            )}
          </dd>
        </div>
        {status.sourceAlert?.active ? (
          <div>
            <dt>Alerta fuente</dt>
            <dd className="error">
              Sin fuente &gt; {Math.round(status.sourceAlert.thresholdMs / 60_000)} min
              {status.sourceAlert.reason ? ` (${status.sourceAlert.reason})` : ""}
              {status.sourceAlert.downForMs > 0
                ? ` · lleva ${Math.round(status.sourceAlert.downForMs / 60_000)} min`
                : ""}
            </dd>
          </div>
        ) : status.sourceAlert?.downSince && status.sourceAlert.monitoring ? (
          <div>
            <dt>Fuente</dt>
            <dd className="muted small">
              Caída detectada; alerta si supera{" "}
              {Math.round(status.sourceAlert.thresholdMs / 60_000)} min
            </dd>
          </div>
        ) : null}
        {ice.listenUrl ? (
          <div>
            <dt>Escuchar</dt>
            <dd>
              <a href={ice.listenUrl} target="_blank" rel="noreferrer" className="mono small">
                {ice.listenUrl}
              </a>
              {" · "}
              <Link to="/listen" className="small">
                Reproductor web
              </Link>
            </dd>
          </div>
        ) : null}
        {ice.error ? (
          <div>
            <dt>Probe</dt>
            <dd className="muted small">{ice.error}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

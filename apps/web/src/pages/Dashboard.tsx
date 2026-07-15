import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import type { ApiHealth, ApiHealthMeta, ApiReadiness } from "@radioflow/shared";
import { useAuth } from "../auth/AuthContext";
import { apiUrl } from "../lib/api-base";

export function Dashboard() {
  useAuth();
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [meta, setMeta] = useState<ApiHealthMeta | null>(null);
  const [ready, setReady] = useState<ApiReadiness | null>(null);
  const [readyHttpError, setReadyHttpError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(apiUrl("/api/health")).then((r) => (r.ok ? r.json() : Promise.reject(new Error("health")))),
      fetch(apiUrl("/api/health/meta")).then((r) => (r.ok ? r.json() : Promise.reject(new Error("meta")))),
      fetch(apiUrl("/api/health/ready")).then(async (r) => {
        const data = (await r.json()) as ApiReadiness;
        return { ok: r.ok, data };
      }),
    ])
      .then(([h, m, { ok, data }]) => {
        setHealth(h);
        setMeta(m);
        setReady(data);
        setReadyHttpError(
          ok ? null : "Readiness: la base de datos no responde (la API no está lista para tráfico).",
        );
      })
      .catch(() => setError("No se pudo contactar al backend. ¿Está en ejecución y configurado el proxy?"));
  }, []);

  return (
    <section className="card">
      <h1>Panel de control</h1>
      <p className="muted">
        API Node.js, PostgreSQL, cola al aire con WebSocket, subida de medios, playlists, parrilla, streaming Icecast,
        informes de operación y enriquecimiento vía Ollama opcional.
      </p>
      <div className="quick-links">
        <Link to="/station">Estación</Link>
        <Link to="/library">Librería</Link>
        <Link to="/playlists">Playlists</Link>
        <Link to="/schedule">Parrilla</Link>
        <Link to="/streaming">Streaming</Link>
        <Link to="/reports">Informes</Link>
        <Link to="/settings">Marca</Link>
      </div>
      <div className="grid">
        <article className="tile">
          <h3>Estado API</h3>
          {error && <p className="error">{error}</p>}
          {readyHttpError && <p className="error">{readyHttpError}</p>}
          {ready?.degraded && (
            <p className="badge">
              Modo degradado: Redis está configurado pero no responde al PING; el rate-limit de auth usa memoria
              local.
            </p>
          )}
          {health && (
            <ul className="kv">
              <li>
                <span>Servicio</span>
                <span>{health.status}</span>
              </li>
              <li>
                <span>Versión</span>
                <span>{health.version}</span>
              </li>
              <li>
                <span>Uptime (s)</span>
                <span>{health.uptimeSeconds}</span>
              </li>
            </ul>
          )}
          {ready && (
            <ul className="kv">
              <li>
                <span>Listo (BD)</span>
                <span>{ready.ready ? "sí" : "no"}</span>
              </li>
              <li>
                <span>BD (readiness)</span>
                <span>{ready.database}</span>
              </li>
              <li>
                <span>Redis (PING)</span>
                <span>{ready.redis}</span>
              </li>
              <li>
                <span>Degradado</span>
                <span>{ready.degraded ? "sí" : "no"}</span>
              </li>
            </ul>
          )}
          {meta && (
            <ul className="kv">
              <li>
                <span>Scheduler interno</span>
                <span>
                  {meta.internalSchedulerActive
                    ? `activo (${meta.internalSchedulePollMs} ms)`
                    : "inactivo"}
                </span>
              </li>
              <li>
                <span>Cola parrilla</span>
                <span>{meta.scheduleReplaceQueue ? "reemplazar al cambiar bloque" : "append"}</span>
              </li>
              <li>
                <span>Redis (cliente)</span>
                <span>{meta.redis}</span>
              </li>
              <li>
                <span>Rate-limit auth</span>
                <span>
                  {meta.rateLimitAuth.max} / {meta.rateLimitAuth.windowSec}s por IP
                </span>
              </li>
              <li>
                <span>Rate-limit buckets (mem)</span>
                <span>{meta.rateLimitAuth.memoryBuckets}</span>
              </li>
              {meta.streamingEncoder ? (
                <li>
                  <span>Streaming (encoder)</span>
                  <span>
                    {!meta.streamingEncoder.activeStreamingTargetId
                      ? "Sin destino activo en Marca"
                      : meta.streamingEncoder.activeTargetEnabled
                        ? "Destino activo habilitado"
                        : "Destino activo no disponible o deshabilitado"}
                  </span>
                </li>
              ) : null}
            </ul>
          )}
        </article>
        <article className="tile">
          <h3>Roadmap</h3>
          <ol className="steps">
            <li>
              <strong>Fase 1–2</strong>: arquitectura, Docker, usuarios y JWT
            </li>
            <li>
              <strong>Fase 3</strong>: reproductor y librerías (índice + playlists)
            </li>
            <li>
              <strong>Fase 4</strong>: codificación y puntos de montaje a Icecast/AzuraCast
            </li>
            <li>
              <strong>Fase 6</strong>: curaduría semántica vía Ollama / Perplexica
            </li>
          </ol>
        </article>
      </div>
    </section>
  );
}

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import type { ApiHealth } from "@radioflow/shared";

export function Dashboard() {
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("API no disponible"))))
      .then(setHealth)
      .catch(() => setError("No se pudo contactar al backend. ¿Está corriendo y configurado el proxy?"));
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

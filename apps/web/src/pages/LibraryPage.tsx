import { useEffect, useState } from "react";

type Asset = {
  id: string;
  title: string;
  artist: string | null;
  path: string;
  durationSec: number | null;
};

export function LibraryPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/library/assets")
      .then((r) => r.json())
      .then(setAssets)
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="card">
      <h1>Librería multimedia</h1>
      <p className="muted">Vista inicial de catálogo; la indexación semántica se conectará en la Fase 6.</p>
      {loading ? (
        <p>Cargando…</p>
      ) : assets.length === 0 ? (
        <p className="muted">No hay pistas aún. Usa la API POST /api/library/assets para registrar contenido.</p>
      ) : (
        <ul className="list">
          {assets.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{a.title}</strong>
                {a.artist && <span className="muted"> — {a.artist}</span>}
              </div>
              <code className="path">{a.path}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

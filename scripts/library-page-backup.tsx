import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type Asset = {
  id: string;
  title: string;
  artist: string | null;
  path: string;
  durationSec: number | null;
  semanticNote: string | null;
};

export function LibraryPage() {
  const { token, user } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canUpload = user?.role === "admin" || user?.role === "editor" || user?.role === "dj";
  const canEnrich = user?.role === "admin" || user?.role === "editor";

  const load = useCallback(async (query?: string) => {
    setLoading(true);
    setMsg(null);
    try {
      const url = query?.trim()
        ? `/api/library/assets?q=${encodeURIComponent(query.trim())}`
        : "/api/library/assets";
      const data = await apiFetch<Asset[]>(url);
      setAssets(data);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al cargar");
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    load(q);
  }

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setMsg("Elige un archivo");
      return;
    }
    const body = new FormData();
    body.append("file", file);
    try {
      const r = await fetch("/api/library/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? r.statusText);
      e.currentTarget.reset();
      setMsg(null);
      load(q);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function enrich(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/semantic/enrich/${id}`, { method: "POST", token });
      load(q);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <section className="card">
      <h1>Librer├¡a multimedia</h1>
      <p className="muted">
        B├║squeda por metadatos; subida multipart a <code>data/media/uploads</code>; nota sem├íntica con Ollama si la API
        tiene <code>OLLAMA_BASE_URL</code>.
      </p>
      {msg && <p className="error">{msg}</p>}
      <form className="row" onSubmit={onSearch}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar t├¡tulo / artistaÔÇª" />
        <button type="submit" className="btn">
          Buscar
        </button>
        <button type="button" className="btn ghost" onClick={() => { setQ(""); load(); }}>
          Limpiar
        </button>
      </form>
      {canUpload && token && (
        <form className="row mt" onSubmit={onUpload}>
          <input type="file" name="file" accept="audio/*,video/*" required />
          <button type="submit" className="btn primary">
            Subir
          </button>
        </form>
      )}
      {loading ? <p>CargandoÔÇª</p> : null}
      <ul className="list">
        {assets.map((a) => (
          <li key={a.id}>
            <div>
              <strong>{a.title}</strong>
              {a.artist && <span className="muted"> ÔÇö {a.artist}</span>}
              <div className="path mono small">{a.path}</div>
              {a.semanticNote && <p className="muted small">{a.semanticNote}</p>}
              <audio className="preview-audio" controls src={`/api/library/assets/${a.id}/stream`} preload="none" />
              {canEnrich && token && (
                <button type="button" className="btn ghost small-btn" onClick={() => void enrich(a.id)}>
                  Enriquecer (IA)
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!loading && assets.length === 0 && <p className="muted">Sin resultados.</p>}
    </section>
  );
}

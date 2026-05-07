import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type Pl = { id: string; name: string; _count: { items: number } };

export function PlaylistsPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<Pl[]>([]);
  const [name, setName] = useState("Nueva lista");
  const [msg, setMsg] = useState<string | null>(null);
  const canEdit = user?.role === "admin" || user?.role === "editor";

  const load = () => {
    fetch("/api/playlists")
      .then((r) => r.json())
      .then(setRows);
  };

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !name.trim()) return;
    try {
      await apiFetch("/api/playlists", { method: "POST", token, body: JSON.stringify({ name: name.trim() }) });
      setName("Nueva lista");
      setMsg(null);
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <section className="card">
      <h1>Playlists</h1>
      <p className="muted">Listas ordenadas para parrilla y para volcar a la cola al aire.</p>
      {msg && <p className="error">{msg}</p>}
      {canEdit && token && (
        <form className="row" onSubmit={onCreate}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
          <button type="submit" className="btn primary">
            Crear playlist
          </button>
        </form>
      )}
      <ul className="list mt">
        {rows.map((p) => (
          <li key={p.id}>
            <div>
              <Link to={`/playlists/${p.id}`}>
                <strong>{p.name}</strong>
              </Link>
              <div className="muted small">{p._count.items} pistas</div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="muted">No hay listas todavía.</p>}
    </section>
  );
}

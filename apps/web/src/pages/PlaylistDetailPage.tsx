import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type Asset = { id: string; title: string; artist: string | null };
type Item = { id: string; position: number; asset: Asset };
type PlDetail = { id: string; name: string; items: Item[] };

export function PlaylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const [pl, setPl] = useState<PlDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const canEdit = user?.role === "admin" || user?.role === "editor";

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await apiFetch<PlDetail>(`/api/playlists/${id}`);
      setPl(d);
      setLoadErr(null);
    } catch (e) {
      setPl(null);
      setLoadErr(e instanceof Error ? e.message : "Error");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    apiFetch<Asset[]>("/api/library/assets")
      .then(setAssets)
      .catch(() => setAssets([]));
  }, []);

  async function addItem() {
    if (!token || !id || !pick) return;
    try {
      await apiFetch(`/api/playlists/${id}/items`, {
        method: "POST",
        token,
        body: JSON.stringify({ assetId: pick }),
      });
      setPick("");
      setMsg(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  async function removeItem(itemId: string) {
    if (!token || !id) return;
    try {
      await apiFetch(`/api/playlists/${id}/items/${itemId}`, { method: "DELETE", token });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  async function reorder(ids: string[]) {
    if (!token || !id) return;
    try {
      await apiFetch(`/api/playlists/${id}/items/reorder`, {
        method: "PUT",
        token,
        body: JSON.stringify({ orderedItemIds: ids }),
      });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  function move(idx: number, dir: -1 | 1) {
    if (!pl) return;
    const next = idx + dir;
    if (next < 0 || next >= pl.items.length) return;
    const order = pl.items.map((i) => i.id);
    const t = order[idx];
    order[idx] = order[next];
    order[next] = t;
    void reorder(order);
  }

  if (!id) return <p>Falta id</p>;
  if (loadErr) return <p className="error card">{loadErr}</p>;
  if (!pl) return <p>Cargando…</p>;

  return (
    <section className="card">
      <p className="muted">
        <Link to="/playlists">← Playlists</Link>
      </p>
      <h1>{pl.name}</h1>
      {msg && <p className="error">{msg}</p>}
      {canEdit && token && (
        <div className="row">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="select">
            <option value="">Añadir pista…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
                {a.artist ? ` — ${a.artist}` : ""}
              </option>
            ))}
          </select>
          <button type="button" className="btn primary" onClick={() => void addItem()}>
            Añadir
          </button>
        </div>
      )}
      <ol className="queue mt">
        {pl.items.map((it, idx) => (
          <li key={it.id}>
            <div>
              <span className="pos">{idx + 1}</span>
              <div>
                <strong>{it.asset.title}</strong>
                {it.asset.artist && <span className="muted"> — {it.asset.artist}</span>}
              </div>
            </div>
            {canEdit && token && (
              <div className="row tight">
                <button type="button" className="btn ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => move(idx, 1)}
                  disabled={idx === pl.items.length - 1}
                >
                  ↓
                </button>
                <button type="button" className="btn ghost" onClick={() => void removeItem(it.id)}>
                  Quitar
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

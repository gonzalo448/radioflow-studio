import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type Asset = { id: string; title: string; artist: string | null; path: string };
type QueueRow = { id: string; position: number; asset: Asset };
type StationState = {
  station: { id: string; mode: string; currentPosition: number; liveTitle: string | null };
  queue: QueueRow[];
  nowPlaying: (Asset & { queueItemId?: string }) | null;
};

function stationWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/ws/station`;
}

export function StationPage() {
  const { token, user } = useAuth();
  const [state, setState] = useState<StationState | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<"off" | "connecting" | "live" | "error">("off");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const s = await apiFetch<StationState>("/api/station");
    setState(s);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/library/assets")
      .then((r) => r.json())
      .then(setAssets)
      .catch(() => setAssets([]));
  }, []);

  useEffect(() => {
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setWsStatus("connecting");
      const ws = new WebSocket(stationWsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        if (stopped) return;
        setWsStatus("live");
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as { type?: string; payload?: StationState };
          if (data.type === "station" && data.payload) setState(data.payload);
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {
        if (!stopped) setWsStatus("error");
      };
      ws.onclose = () => {
        if (stopped) return;
        setWsStatus("off");
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, 2500);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  async function append() {
    if (!token) {
      setMsg("Inicia sesión para añadir a la cola");
      return;
    }
    if (!pick) return;
    try {
      await apiFetch("/api/station/queue", {
        method: "POST",
        token,
        body: JSON.stringify({ assetId: pick }),
      });
      setMsg(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  async function skip() {
    if (!token) {
      setMsg("Inicia sesión para avanzar la cola");
      return;
    }
    try {
      await apiFetch("/api/station/skip", { method: "POST", token });
      setMsg(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  async function remove(id: string) {
    if (!token) {
      setMsg("Inicia sesión para quitar ítems");
      return;
    }
    try {
      await apiFetch(`/api/station/queue/${id}`, { method: "DELETE", token });
      setMsg(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  if (!state) return <p>Cargando estación…</p>;

  return (
    <section className="card">
      <h1>Estación y cola</h1>
      <p className="muted">
        Sincronización en tiempo real por WebSocket (<code>/api/ws/station</code>). El servicio{" "}
        <code>@radioflow/encoder</code> puede sondear la API y montar FFmpeg hacia Icecast.
      </p>
      <p className={`ws-pill ws-${wsStatus}`}>
        WS:{" "}
        {wsStatus === "live"
          ? "conectado"
          : wsStatus === "connecting"
            ? "conectando…"
            : wsStatus === "error"
              ? "error — reintentando"
              : "desconectado"}
      </p>
      {user && (
        <p className="badge">
          Sesión: <strong>{user.email}</strong> · rol <code>{user.role}</code>
        </p>
      )}
      {msg && <p className="error">{msg}</p>}
      <div className="grid">
        <article className="tile">
          <h3>En emisión (referencia)</h3>
          {state.nowPlaying ? (
            <div>
              <p className="lead">
                <strong>{state.nowPlaying.title}</strong>
                {state.nowPlaying.artist && <span className="muted"> — {state.nowPlaying.artist}</span>}
              </p>
              <p className="muted mono">{state.nowPlaying.path}</p>
              <p className="muted small">Modo: {state.station.mode}</p>
            </div>
          ) : (
            <p className="muted">Sin pista posicionada o cola vacía.</p>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => void skip()} disabled={!state.queue.length}>
              Siguiente
            </button>
          </div>
        </article>
        <article className="tile">
          <h3>Añadir a la cola</h3>
          <div className="row">
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="select">
              <option value="">Elegir pista…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                  {a.artist ? ` — ${a.artist}` : ""}
                </option>
              ))}
            </select>
            <button type="button" className="btn primary" onClick={() => void append()}>
              Encolar
            </button>
          </div>
        </article>
      </div>
      <h3 className="mt">Cola ordenada</h3>
      <ol className="queue">
        {state.queue.map((q, idx) => (
          <li key={q.id} className={idx === state.station.currentPosition ? "queue-active" : ""}>
            <div>
              <span className="pos">{idx + 1}</span>
              <div>
                <strong>{q.asset.title}</strong>
                {q.asset.artist && <span className="muted"> — {q.asset.artist}</span>}
              </div>
            </div>
            <button type="button" className="btn ghost" onClick={() => void remove(q.id)}>
              Quitar
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

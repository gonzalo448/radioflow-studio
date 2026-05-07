import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type Block = {
  id: string;
  label: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  priority: number;
  playlist: { id: string; name: string } | null;
};

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function toClock(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function SchedulePage() {
  const { token, user } = useAuth();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [label, setLabel] = useState("Bloque matutino");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("10:00");
  const [playlistId, setPlaylistId] = useState<string>("");

  const parseClock = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
  };

  const load = useCallback(async () => {
    const data = await apiFetch<Block[]>("/api/schedule");
    setBlocks(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/playlists")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { id: string; name: string }[]) => setPlaylists(rows))
      .catch(() => setPlaylists([]));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setMsg("Inicia sesión (editor/admin) para crear bloques");
      return;
    }
    const startMinute = parseClock(start);
    const endMinute = parseClock(end);
    try {
      await apiFetch("/api/schedule", {
        method: "POST",
        token,
        body: JSON.stringify({
          label,
          dayOfWeek,
          startMinute,
          endMinute,
          priority: 0,
          playlistId: playlistId || null,
        }),
      });
      setMsg(null);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function remove(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/schedule/${id}`, { method: "DELETE", token });
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <section className="card">
      <h1>Parrilla semanal</h1>
      <p className="muted">
        Bloques recurrentes por día (0 = domingo … 6 = sábado). En producción se conectarán con el motor de automatización y reglas inteligentes.
      </p>
      {user && (
        <p className="badge">
          Rol: <code>{user.role}</code> · edición requiere editor o admin
        </p>
      )}
      {msg && <p className="error">{msg}</p>}
      <form className="form inline-grid" onSubmit={onCreate}>
        <label>
          Etiqueta
          <input value={label} onChange={(e) => setLabel(e.target.value)} required />
        </label>
        <label>
          Día
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} className="select">
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Inicio
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Fin
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label>
          Playlist (opcional)
          <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} className="select">
            <option value="">Ninguna</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn primary">
          Guardar bloque
        </button>
      </form>
      <h3 className="mt">Definidos</h3>
      <ul className="list">
        {blocks.map((b) => (
          <li key={b.id}>
            <div>
              <strong>{b.label}</strong>{" "}
              <span className="muted">
                {DAYS[b.dayOfWeek]} · {toClock(b.startMinute)}–{toClock(b.endMinute)}
                {b.playlist ? ` · playlist: ${b.playlist.name}` : ""}
              </span>
            </div>
            {token && (user?.role === "admin" || user?.role === "editor") && (
              <button type="button" className="btn ghost" onClick={() => void remove(b.id)}>
                Eliminar
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

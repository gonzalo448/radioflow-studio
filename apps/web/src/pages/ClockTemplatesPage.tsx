import { useEffect, useState } from "react";
import type { ApiPlaylistListItem, ApiTrackListSpec } from "@radioflow/shared";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

const STORAGE_KEY = "radioflow-program-clocks";

export type ProgramClockSlot = {
  offsetMin: number;
  source: ApiTrackListSpec["source"];
  value: string;
  maxTracks?: number;
  order?: "title" | "random" | "sequential" | "series";
  label?: string;
};

export type ProgramClock = {
  id: string;
  name: string;
  slots: ProgramClockSlot[];
};

function loadClocks(): ProgramClock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? (j as ProgramClock[]) : [];
  } catch {
    return [];
  }
}

function saveClocks(clocks: ProgramClock[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clocks));
}

const DEFAULT_CLOCK: ProgramClock = {
  id: "hora-pico",
  name: "Hora pico (ejemplo)",
  slots: [
    { offsetMin: 0, source: "category", value: "Pop", maxTracks: 2, order: "random" },
    { offsetMin: 12, source: "folder", value: "jingles", maxTracks: 1, order: "random", label: "Jingle" },
    { offsetMin: 25, source: "artist", value: "__none__", maxTracks: 1, order: "title" },
  ],
};

/**
 * Plantillas de reloj (clocks): bloques de categorías/rotaciones por offset dentro de la hora.
 * Se aplican como ítems track_list en una playlist destino.
 */
export function ClockTemplatesPage() {
  const { token } = useAuth();
  const [clocks, setClocks] = useState<ProgramClock[]>(() => {
    const c = loadClocks();
    return c.length ? c : [DEFAULT_CLOCK];
  });
  const [playlists, setPlaylists] = useState<ApiPlaylistListItem[]>([]);
  const [playlistId, setPlaylistId] = useState("");
  const [selectedId, setSelectedId] = useState(clocks[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = clocks.find((c) => c.id === selectedId) ?? clocks[0] ?? null;

  useEffect(() => {
    saveClocks(clocks);
  }, [clocks]);

  useEffect(() => {
    if (!token) return;
    void apiFetch<ApiPlaylistListItem[]>("/api/playlists", { token })
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, [token]);

  const updateSlot = (idx: number, patch: Partial<ProgramClockSlot>) => {
    if (!selected) return;
    setClocks((prev) =>
      prev.map((c) =>
        c.id !== selected.id
          ? c
          : {
              ...c,
              slots: c.slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
            },
      ),
    );
  };

  const applyClock = async () => {
    if (!token || !selected || !playlistId) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const slot of [...selected.slots].sort((a, b) => a.offsetMin - b.offsetMin)) {
        await apiFetch(`/api/playlists/${playlistId}/items/track-list`, {
          method: "POST",
          token,
          body: JSON.stringify({
            source: slot.source,
            value: slot.value,
            maxTracks: slot.maxTracks ?? 1,
            order: slot.order ?? "random",
            label: slot.label ?? `${selected.name} · +${slot.offsetMin}m`,
          }),
        });
      }
      setMsg(`Reloj «${selected.name}» aplicado (${selected.slots.length} bloques).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al aplicar reloj");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <section className="card">
        <h1>Relojes de programación</h1>
        <p className="muted">
          <Link to="/login">Inicia sesión</Link> para gestionar plantillas.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h1>Relojes de programación</h1>
      <p className="muted">
        Plantillas bloques por minuto dentro de la hora (categoría, carpeta, artista). Al aplicar,
        inserta ítems <code>track_list</code> en la playlist elegida.
      </p>

      <div className="row tight mt" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {clocks.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-compact ghost"
          onClick={() => {
            const id = `clock-${Date.now()}`;
            setClocks((prev) => [...prev, { id, name: "Nuevo reloj", slots: [] }]);
            setSelectedId(id);
          }}
        >
          Nuevo reloj
        </button>
        <button
          type="button"
          className="btn btn-compact ghost"
          onClick={() => {
            if (!selected) return;
            setClocks((prev) =>
              prev.map((c) =>
                c.id !== selected.id
                  ? c
                  : {
                      ...c,
                      slots: [
                        ...c.slots,
                        {
                          offsetMin: c.slots.length ? c.slots.at(-1)!.offsetMin + 10 : 0,
                          source: "category",
                          value: "",
                          maxTracks: 1,
                          order: "random",
                        },
                      ],
                    },
              ),
            );
          }}
        >
          + Bloque
        </button>
      </div>

      {selected ? (
        <>
          <label className="field mt">
            <span className="muted small">Nombre del reloj</span>
            <input
              value={selected.name}
              onChange={(e) =>
                setClocks((prev) =>
                  prev.map((c) => (c.id === selected.id ? { ...c, name: e.target.value } : c)),
                )
              }
            />
          </label>

          <table className="data-table mt">
            <thead>
              <tr>
                <th>Min</th>
                <th>Origen</th>
                <th>Valor</th>
                <th>Máx</th>
                <th>Orden</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {selected.slots.map((slot, idx) => (
                <tr key={`${selected.id}-${idx}`}>
                  <td>
                    <input
                      type="number"
                      className="mono"
                      min={0}
                      max={59}
                      value={slot.offsetMin}
                      onChange={(e) => updateSlot(idx, { offsetMin: Number(e.target.value) })}
                      style={{ width: "3.5rem" }}
                    />
                  </td>
                  <td>
                    <select
                      value={slot.source}
                      onChange={(e) =>
                        updateSlot(idx, { source: e.target.value as ApiTrackListSpec["source"] })
                      }
                    >
                      <option value="category">Categoría (género)</option>
                      <option value="folder">Carpeta</option>
                      <option value="genre">Género</option>
                      <option value="artist">Artista</option>
                    </select>
                  </td>
                  <td>
                    <input
                      value={slot.value}
                      onChange={(e) => updateSlot(idx, { value: e.target.value })}
                      placeholder="Pop, tangos/, etc."
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={slot.maxTracks ?? 1}
                      onChange={(e) => updateSlot(idx, { maxTracks: Number(e.target.value) })}
                      style={{ width: "3rem" }}
                    />
                  </td>
                  <td>
                    <select
                      value={slot.order ?? "random"}
                      onChange={(e) =>
                        updateSlot(idx, {
                          order: e.target.value as "random" | "title" | "sequential" | "series",
                        })
                      }
                    >
                      <option value="random">Aleatorio</option>
                      <option value="sequential">En orden</option>
                      <option value="series">Serie</option>
                      <option value="title">Título (legacy)</option>
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-compact ghost"
                      onClick={() =>
                        setClocks((prev) =>
                          prev.map((c) =>
                            c.id !== selected.id
                              ? c
                              : { ...c, slots: c.slots.filter((_, i) => i !== idx) },
                          ),
                        )
                      }
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <div className="row tight mt" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: "0.75rem" }}>
        <label className="field">
          <span className="muted small">Playlist destino</span>
          <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
            <option value="">Elija lista…</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !playlistId || !selected?.slots.length}
          onClick={() => void applyClock()}
        >
          {busy ? "Aplicando…" : "Aplicar reloj a lista"}
        </button>
        {playlistId ? (
          <Link to={`/station?pl=${encodeURIComponent(playlistId)}`} className="btn btn-compact ghost">
            Abrir en Cabina
          </Link>
        ) : null}
      </div>

      {msg ? <p className="muted small mt">{msg}</p> : null}
    </section>
  );
}

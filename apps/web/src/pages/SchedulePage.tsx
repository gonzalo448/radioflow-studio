import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import type {
  ApiPlaylistListItem,
  ApiScheduleApplyActiveResult,
  ApiScheduleBlock,
  ApiScheduleCreateBody,
  ApiScheduleTodayHints,
  ApiStationPatchBody,
  ApiStationState,
} from "@radioflow/shared";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function toClock(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const APPLY_REASON_LABEL: Record<ApiScheduleApplyActiveResult["reason"], string> = {
  applied: "Cola actualizada con la playlist del bloque activo.",
  no_active_block: "Ningún bloque cubre el minuto actual.",
  no_playlist_on_block: "El bloque activo no tiene playlist (o está vacía).",
  already_applied: "Ese bloque ya estaba aplicado a la cola. Use «Forzar» para volver a cargar.",
};

export function SchedulePage() {
  const { token, user } = useAuth();
  const [searchParams] = useSearchParams();
  const legacyRedirect = searchParams.get("legacy") === "programacion";

  const [blocks, setBlocks] = useState<ApiScheduleBlock[]>([]);
  const [playlists, setPlaylists] = useState<Pick<ApiPlaylistListItem, "id" | "name">[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [schedErr, setSchedErr] = useState<string | null>(null);
  const [hints, setHints] = useState<ApiScheduleTodayHints | null>(null);
  const [stationBrief, setStationBrief] = useState<ApiStationState["station"] | null>(null);
  const [replaceQueue, setReplaceQueue] = useState(true);
  const [applyBusy, setApplyBusy] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);

  const [label, setLabel] = useState("Bloque matutino");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("10:00");
  const [playlistId, setPlaylistId] = useState<string>("");

  const canEditSchedule = user?.role === "admin" || user?.role === "editor";
  const canDriveStation =
    Boolean(token) && (user?.role === "admin" || user?.role === "editor" || user?.role === "dj");

  const blocksByDay = useMemo(() => {
    const map: ApiScheduleBlock[][] = Array.from({ length: 7 }, () => []);
    for (const b of blocks) {
      map[b.dayOfWeek]?.push(b);
    }
    for (const day of map) {
      day.sort((a, b) => a.startMinute - b.startMinute || b.priority - a.priority);
    }
    return map;
  }, [blocks]);

  const parseClock = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
  };

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ApiScheduleBlock[]>("/api/schedule");
      setBlocks(data);
      setSchedErr(null);
    } catch (e) {
      setSchedErr(e instanceof Error ? e.message : "Error");
      setBlocks([]);
    }
  }, []);

  const loadHintsAndStation = useCallback(async () => {
    try {
      const [h, st] = await Promise.all([
        apiFetch<ApiScheduleTodayHints>("/api/schedule/today-hints"),
        apiFetch<ApiStationState>("/api/station"),
      ]);
      setHints(h);
      setStationBrief(st.station);
    } catch {
      setHints(null);
      setStationBrief(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadHintsAndStation();
    const t = window.setInterval(() => void loadHintsAndStation(), 45_000);
    return () => window.clearInterval(t);
  }, [loadHintsAndStation]);

  useEffect(() => {
    apiFetch<ApiPlaylistListItem[]>("/api/playlists")
      .then((rows) => setPlaylists(rows.map((r) => ({ id: r.id, name: r.name }))))
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
      const body: ApiScheduleCreateBody = {
        label,
        dayOfWeek,
        startMinute,
        endMinute,
        priority: 0,
        playlistId: playlistId || null,
      };
      await apiFetch("/api/schedule", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setMsg(null);
      await load();
      await loadHintsAndStation();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function remove(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/schedule/${id}`, { method: "DELETE", token });
      await load();
      await loadHintsAndStation();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function toggleAutoSchedule() {
    if (!token || !canDriveStation || !stationBrief) return;
    setAutoBusy(true);
    setMsg(null);
    try {
      const body: ApiStationPatchBody = { autoScheduleEnabled: !stationBrief.autoScheduleEnabled };
      const st = await apiFetch<ApiStationState>("/api/station", {
        method: "PATCH",
        token,
        body: JSON.stringify(body),
      });
      setStationBrief(st.station);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setAutoBusy(false);
    }
  }

  async function applyActive(force: boolean) {
    if (!token || !canDriveStation) {
      setMsg("Inicia sesión como DJ, editor o admin para aplicar la parrilla a la cola.");
      return;
    }
    setApplyBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch<ApiScheduleApplyActiveResult>("/api/schedule/apply-active", {
        method: "POST",
        token,
        body: JSON.stringify({ replace: replaceQueue, force }),
      });
      if (res.station) setStationBrief(res.station.station);
      setMsg(APPLY_REASON_LABEL[res.reason]);
      await loadHintsAndStation();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al aplicar");
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <section className="card">
      <h1>Parrilla y automatización</h1>
      <p className="muted">
        Bloques recurrentes por día (0 = domingo … 6 = sábado). El worker o la API con{" "}
        <code className="mono">INTERNAL_SCHEDULE_POLL_MS</code> aplican la playlist del bloque activo cuando la
        automatización está encendida.
      </p>

      {legacyRedirect && (
        <div className="tile" style={{ marginBottom: "1rem", borderColor: "var(--accent)" }}>
          <strong>Vista unificada (Fase 3)</strong>
          <p className="muted small" style={{ margin: "0.35rem 0 0" }}>
            La antigua pantalla «Prog. día» apunta aquí. La API legacy{" "}
            <code className="mono">/api/programacion</code> sigue disponible para export M3U /
            Liquidsoap (legacy); edite la parrilla moderna en esta página.
          </p>
        </div>
      )}

      {hints && (
        <div className="tile" style={{ marginBottom: "1rem" }}>
          <strong>Hoy ({DAYS[hints.dayOfWeek]})</strong> · ahora local:{" "}
          <code className="mono">{toClock(hints.minuteNow)}</code>
          {hints.active.length > 0 ? (
            <span>
              {" "}
              · <strong>Bloques activos:</strong>{" "}
              {hints.active.map((b, i) => (
                <span key={b.id}>
                  {i > 0 ? " · " : ""}
                  {b.label}
                  {b.playlist ? ` (${b.playlist.name})` : ""}
                </span>
              ))}
            </span>
          ) : (
            <span className="muted"> · ningún bloque cubre este minuto</span>
          )}
          {stationBrief && (
            <div className="muted" style={{ marginTop: "0.35rem" }}>
              Automatización parrilla:{" "}
              <code className="mono">{stationBrief.autoScheduleEnabled ? "activada" : "desactivada"}</code>
              {stationBrief.lastAppliedScheduleBlockId ? (
                <>
                  {" "}
                  · último bloque aplicado a la cola:{" "}
                  <code className="mono">
                    {hints.blocks.find((b) => b.id === stationBrief.lastAppliedScheduleBlockId)?.label ??
                      stationBrief.lastAppliedScheduleBlockId.slice(0, 8) + "…"}
                  </code>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      <div className="tile" style={{ marginBottom: "1rem" }}>
        <h2 className="h3">Automatización</h2>
        <p className="muted small">
          Con la automatización activa, al entrar en un bloque con playlist la cola se sincroniza (misma lógica que el
          botón manual). Un solo publicador de cola a la vez evita conflictos con el encoder.
        </p>
        <div className="inline-grid" style={{ alignItems: "end", gap: "0.75rem", marginTop: "0.75rem" }}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={replaceQueue}
              onChange={(e) => setReplaceQueue(e.target.checked)}
              disabled={!canDriveStation}
            />
            Sustituir toda la cola al aplicar
          </label>
          {canDriveStation ? (
            <>
              <button
                type="button"
                className={`btn ${stationBrief?.autoScheduleEnabled ? "ghost" : "primary"}`}
                disabled={autoBusy}
                onClick={() => void toggleAutoSchedule()}
              >
                {autoBusy
                  ? "…"
                  : stationBrief?.autoScheduleEnabled
                    ? "Desactivar automatización"
                    : "Activar automatización"}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={applyBusy}
                onClick={() => void applyActive(false)}
              >
                {applyBusy ? "Aplicando…" : "Aplicar bloque activo ahora"}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={applyBusy}
                onClick={() => void applyActive(true)}
              >
                Forzar reaplicar
              </button>
            </>
          ) : (
            <p className="muted small">Inicia sesión como DJ, editor o admin para controlar la cola.</p>
          )}
        </div>
        <p className="muted small" style={{ marginTop: "0.75rem" }}>
          <Link to="/scheduler">Eventos programados</Link>
          {" · "}
          <Link to="/requests">Pedidos</Link>
          {" · "}
          <Link to="/jingles">Jingles</Link>
          {" · "}
          <Link to="/station">Cabina</Link>
        </p>
      </div>

      {user && (
        <p className="badge">
          Rol: <code>{user.role}</code> · edición de bloques requiere editor o admin
        </p>
      )}
      {schedErr && <p className="error">{schedErr}</p>}
      {msg && <p className={msg.includes("actualizada") ? "success" : "muted"}>{msg}</p>}

      {canEditSchedule && (
        <>
          <h3 className="mt">Nuevo bloque</h3>
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
            <button type="submit" className="btn primary" disabled={!token}>
              Guardar bloque
            </button>
          </form>
        </>
      )}

      <h3 className="mt">Vista semanal</h3>
      <div className="schedule-week-grid" style={{ display: "grid", gap: "0.75rem" }}>
        {DAYS.map((dayLabel, dayIndex) => (
          <div key={dayLabel} className="tile">
            <strong>{dayLabel}</strong>
            {blocksByDay[dayIndex]!.length === 0 ? (
              <p className="muted small" style={{ margin: "0.35rem 0 0" }}>
                Sin bloques
              </p>
            ) : (
              <ul className="list" style={{ marginTop: "0.35rem" }}>
                {blocksByDay[dayIndex]!.map((b) => (
                  <li key={b.id}>
                    <span>
                      <code className="mono">
                        {toClock(b.startMinute)}–{toClock(b.endMinute)}
                      </code>{" "}
                      <strong>{b.label}</strong>
                      {b.playlist ? <span className="muted"> · {b.playlist.name}</span> : null}
                    </span>
                    {token && canEditSchedule && (
                      <button type="button" className="btn ghost" onClick={() => void remove(b.id)}>
                        Eliminar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <h3 className="mt">Todos los bloques</h3>
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
            {token && canEditSchedule && (
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

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import type { ApiSchedulerEvent, ApiSchedulerRunEntry } from "@radioflow/shared";

function shortWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function ShellSchedulerPeek() {
  const { token, user } = useAuth();
  const [events, setEvents] = useState<ApiSchedulerEvent[]>([]);
  const [runs, setRuns] = useState<ApiSchedulerRunEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);

  const canSee = user?.role === "admin" || user?.role === "editor";

  useEffect(() => {
    if (!token || !canSee) {
      setEvents([]);
      setRuns([]);
      return;
    }
    const ac = new AbortController();
    void apiFetch<ApiSchedulerEvent[]>("/api/scheduler/events", { token, signal: ac.signal })
      .then((rows) => {
        if (ac.signal.aborted) return;
        const upcoming = [...rows]
          .filter((e) => e.enabled)
          .sort((a, b) => {
            const ta = a.nextRunAt ?? a.runAt ?? "";
            const tb = b.nextRunAt ?? b.runAt ?? "";
            return ta.localeCompare(tb);
          })
          .slice(0, 8);
        setEvents(upcoming);
        setErr(null);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setErr(e instanceof Error ? e.message : "Error");
      });
    void apiFetch<ApiSchedulerRunEntry[]>("/api/scheduler/runs?limit=10", { token, signal: ac.signal })
      .then((rows) => {
        if (ac.signal.aborted) return;
        setRuns(rows);
        setRunsErr(null);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setRunsErr(e instanceof Error ? e.message : "Error");
      });
    return () => ac.abort();
  }, [token, canSee]);

  return (
    <div className="shell-rail-panel">
      <div className="shell-rail-head">
        <strong>Programador</strong>
        {canSee ? (
          <Link to="/scheduler" className="shell-rail-link">
            Abrir
          </Link>
        ) : null}
      </div>
      {!canSee ? (
        <p className="shell-rail-muted small">Inicia sesión como editor para ver eventos.</p>
      ) : err ? (
        <p className="shell-rail-muted small error">{err}</p>
      ) : events.length === 0 ? (
        <p className="shell-rail-muted small">Sin eventos próximos.</p>
      ) : (
        <ul className="shell-rail-list">
          {events.map((e) => (
            <li key={e.id} title={e.name}>
              <span className="shell-rail-time mono">{shortWhen(e.nextRunAt ?? e.runAt)}</span>
              <span className="shell-rail-name">{e.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="shell-rail-divider" />
      <div className="shell-rail-head">
        <strong>Registro</strong>
        {canSee ? (
          <Link to="/scheduler" className="shell-rail-link">
            Todo
          </Link>
        ) : null}
      </div>
      {!canSee ? (
        <p className="shell-rail-muted small">Sin acceso al historial.</p>
      ) : runsErr ? (
        <p className="shell-rail-muted small error">{runsErr}</p>
      ) : runs.length === 0 ? (
        <p className="shell-rail-muted small">Aún no hay ejecuciones registradas.</p>
      ) : (
        <ul className="shell-rail-list shell-rail-list--runs">
          {runs.map((r) => (
            <li key={r.id} title={r.error ?? undefined}>
              <span
                className={`shell-rail-run-status shell-rail-run-status--${r.status}`}
                aria-label={r.status === "success" ? "Éxito" : "Error"}
              >
                {r.status === "success" ? "✓" : "!"}
              </span>
              <span className="shell-rail-time mono">{shortWhen(r.startedAt)}</span>
              <span className="shell-rail-name">{r.eventName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

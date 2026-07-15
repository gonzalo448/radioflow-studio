import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { apiUrl } from "../lib/api-base";
import type { ApiListenerHistory } from "@radioflow/shared";

type LogRow = {
  id: string;
  action: string;
  createdAt: string;
  user: { email: string } | null;
  asset: { title: string } | null;
  details: unknown;
};

type AirRow = {
  id: string;
  action: string;
  createdAt: string;
  asset: { title: string; artist: string | null } | null;
  details: unknown;
};

type PlaybackSummary = {
  days: number;
  since: string;
  totalSkips: number;
  totalSyncs: number;
  totalQueueAppends: number;
  totalTracksPlayed: number;
  totalAutomation: number;
  uniqueTracksSkipped: number;
  uniqueTracksPlayed: number;
  automationByKind: Record<string, number>;
  byHour: { hour: number; skipCount: number; syncCount: number; playedCount: number }[];
  broadcast: {
    listeners: number | null;
    streamTitle: string | null;
    sourceConnected: boolean | null;
    error: string | null;
  } | null;
};

const AUTOMATION_LABELS: Record<string, string> = {
  autodj_refill: "AutoDJ relleno",
  jingle_auto_scheduled: "Jingle programado",
  jingle_auto_resolved: "Jingle al aire",
  time_announce: "Locución horaria",
  station_intro: "Intro emisora",
  scheduler_event: "Evento programador",
  voicetrack_recorded: "Voicetrack grabado",
  air_silence: "Silencio al aire",
  air_clipping: "Clipping al aire",
  streaming_failover: "Failover streaming",
  icecast_source_down: "Icecast sin fuente",
  icecast_source_recovered: "Icecast fuente recuperada",
  headless_playout: "Playout headless",
};

function formatAirRow(r: AirRow): string {
  if (r.action === "TRACK_PLAYED") {
    const t = r.asset?.title ?? "Pista";
    const a = r.asset?.artist;
    return a ? `${a} — ${t}` : t;
  }
  const kind =
    r.details && typeof r.details === "object" && r.details !== null && "kind" in r.details
      ? String((r.details as { kind?: unknown }).kind ?? "")
      : "";
  return AUTOMATION_LABELS[kind] ?? (kind || "Automatización");
}

export function ReportsPage() {
  const { token, user } = useAuth();
  const [tab, setTab] = useState<"log" | "summary" | "listeners" | "air">("summary");
  const [rows, setRows] = useState<LogRow[]>([]);
  const [airRows, setAirRows] = useState<AirRow[]>([]);
  const [summary, setSummary] = useState<PlaybackSummary | null>(null);
  const [listenerHistory, setListenerHistory] = useState<ApiListenerHistory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ok =
    user?.role === "admin" ||
    user?.role === "editor" ||
    user?.role === "dj" ||
    user?.role === "operador" ||
    user?.role === "viewer";

  useEffect(() => {
    if (!token || !ok) return;
    setErr(null);
    if (tab === "log") {
      apiFetch<LogRow[]>("/api/reports/play-log?limit=150", { token })
        .then(setRows)
        .catch((e) => setErr(e instanceof Error ? e.message : "Error"));
    } else if (tab === "listeners") {
      apiFetch<ApiListenerHistory>("/api/reports/listener-history?hours=24", { token })
        .then(setListenerHistory)
        .catch((e) => setErr(e instanceof Error ? e.message : "Error"));
    } else if (tab === "air") {
      apiFetch<AirRow[]>("/api/reports/air-history?days=7&limit=200", { token })
        .then(setAirRows)
        .catch((e) => setErr(e instanceof Error ? e.message : "Error"));
    } else {
      apiFetch<PlaybackSummary>("/api/reports/playback-summary?days=7", { token })
        .then(setSummary)
        .catch((e) => setErr(e instanceof Error ? e.message : "Error"));
    }
  }, [token, ok, tab]);

  const maxPlayed = useMemo(
    () => Math.max(1, ...(summary?.byHour.map((h) => h.playedCount) ?? [1])),
    [summary],
  );

  const maxSkips = useMemo(
    () => Math.max(1, ...(summary?.byHour.map((h) => h.skipCount) ?? [1])),
    [summary],
  );

  const maxListeners = useMemo(() => {
    const vals = listenerHistory?.samples.map((s) => s.listeners ?? 0) ?? [0];
    return Math.max(1, ...vals);
  }, [listenerHistory]);

  const downloadExport = async (path: string, filename: string) => {
    if (!token) return;
    const res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!token) return <p className="card">Inicia sesión para ver el historial.</p>;
  if (!ok) return <p className="card">No tiene permiso para ver informes.</p>;
  if (err) return <p className="error card">{err}</p>;

  return (
    <section className="card">
      <h1>Generador de informes</h1>
      <p className="muted">Historial de operaciones, oyentes Icecast y resumen de actividad al aire.</p>

      <nav className="row tight mb" style={{ marginBottom: "0.75rem" }}>
        <button
          type="button"
          className={`btn btn-compact${tab === "summary" ? " primary" : " ghost"}`}
          onClick={() => setTab("summary")}
        >
          Resumen
        </button>
        <button
          type="button"
          className={`btn btn-compact${tab === "listeners" ? " primary" : " ghost"}`}
          onClick={() => setTab("listeners")}
        >
          Oyentes
        </button>
        <button
          type="button"
          className={`btn btn-compact${tab === "air" ? " primary" : " ghost"}`}
          onClick={() => setTab("air")}
        >
          Al aire
        </button>
        <button
          type="button"
          className={`btn btn-compact${tab === "log" ? " primary" : " ghost"}`}
          onClick={() => setTab("log")}
        >
          Registro detallado
        </button>
        <Link to="/streaming" className="btn btn-compact ghost">
          Estado streaming
        </Link>
        {tab === "log" ? (
          <>
            <button
              type="button"
              className="btn btn-compact ghost"
              onClick={() => void downloadExport("/api/reports/play-log/export?format=csv", "play-log.csv").catch((e) => setErr(e instanceof Error ? e.message : "Error"))}
            >
              CSV
            </button>
            <button
              type="button"
              className="btn btn-compact ghost"
              onClick={() => void downloadExport("/api/reports/play-log/export?format=pdf", "play-log.pdf").catch((e) => setErr(e instanceof Error ? e.message : "Error"))}
            >
              PDF
            </button>
          </>
        ) : null}
        {tab === "listeners" ? (
          <>
            <button
              type="button"
              className="btn btn-compact ghost"
              onClick={() => void downloadExport("/api/reports/listener-history/export?format=csv&hours=24", "oyentes.csv").catch((e) => setErr(e instanceof Error ? e.message : "Error"))}
            >
              CSV
            </button>
            <button
              type="button"
              className="btn btn-compact ghost"
              onClick={() => void downloadExport("/api/reports/listener-history/export?format=pdf&hours=24", "oyentes.pdf").catch((e) => setErr(e instanceof Error ? e.message : "Error"))}
            >
              PDF
            </button>
          </>
        ) : null}
      </nav>

      {tab === "summary" && summary ? (
        <div className="reports-summary">
          <div className="reports-summary-stats row tight" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
            <div className="reports-stat-card">
              <span className="muted small">Pistas al aire</span>
              <strong className="mono">{summary.totalTracksPlayed}</strong>
            </div>
            <div className="reports-stat-card">
              <span className="muted small">Automatización</span>
              <strong className="mono">{summary.totalAutomation}</strong>
            </div>
            <div className="reports-stat-card">
              <span className="muted small">Skips</span>
              <strong className="mono">{summary.totalSkips}</strong>
            </div>
            <div className="reports-stat-card">
              <span className="muted small">Pistas distintas (al aire)</span>
              <strong className="mono">{summary.uniqueTracksPlayed}</strong>
            </div>
            <div className="reports-stat-card">
              <span className="muted small">Sync playlist → cola</span>
              <strong className="mono">{summary.totalSyncs}</strong>
            </div>
            <div className="reports-stat-card">
              <span className="muted small">Encolados</span>
              <strong className="mono">{summary.totalQueueAppends}</strong>
            </div>
            {summary.broadcast ? (
              <div className="reports-stat-card">
                <span className="muted small">Oyentes Icecast (ahora)</span>
                <strong className="mono">{summary.broadcast.listeners ?? "—"}</strong>
                {summary.broadcast.error ? (
                  <span className="muted small">{summary.broadcast.error}</span>
                ) : summary.broadcast.streamTitle ? (
                  <span className="muted small">{summary.broadcast.streamTitle}</span>
                ) : null}
              </div>
            ) : null}
          </div>

          {Object.keys(summary.automationByKind ?? {}).length > 0 ? (
            <>
              <h3 className="small mt">Automatización (7 días)</h3>
              <ul className="log-list compact">
                {Object.entries(summary.automationByKind)
                  .sort((a, b) => b[1] - a[1])
                  .map(([kind, count]) => (
                    <li key={kind}>
                      <strong>{AUTOMATION_LABELS[kind] ?? kind}</strong>
                      <span className="muted mono"> · {count}</span>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}

          <h3 className="small mt">Pistas al aire por hora</h3>
          <p className="muted small">Registro TRACK_PLAYED (últimos {summary.days} días).</p>
          <div className="reports-hour-chart" role="img" aria-label="Gráfico de pistas al aire por hora">
            {summary.byHour.map((h) => (
              <div key={`p-${h.hour}`} className="reports-hour-bar-wrap" title={`${h.hour}:00 — ${h.playedCount} pistas`}>
                <div
                  className="reports-hour-bar reports-hour-bar--played"
                  style={{ height: `${Math.max(4, (h.playedCount / maxPlayed) * 100)}%` }}
                />
                <span className="mono small">{String(h.hour).padStart(2, "0")}</span>
              </div>
            ))}
          </div>

          <h3 className="small mt">Skips por hora del día</h3>
          <p className="muted small">Distribución horaria de avances en cabina (aprox. rotación).</p>
          <div className="reports-hour-chart" role="img" aria-label="Gráfico de skips por hora">
            {summary.byHour.map((h) => (
              <div key={h.hour} className="reports-hour-bar-wrap" title={`${h.hour}:00 — ${h.skipCount} skips`}>
                <div
                  className="reports-hour-bar"
                  style={{ height: `${Math.max(4, (h.skipCount / maxSkips) * 100)}%` }}
                />
                <span className="mono small">{String(h.hour).padStart(2, "0")}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "listeners" && listenerHistory ? (
        <div className="reports-listeners">
          <p className="muted small">
            Muestreo cada ~5 min del destino Icecast activo (últimas {listenerHistory.hours} h ·{" "}
            {listenerHistory.sampleCount} muestras).
          </p>
          <div className="reports-summary-stats row tight mt" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
            <div className="reports-stat-card">
              <span className="muted small">Pico</span>
              <strong className="mono">{listenerHistory.peakListeners ?? "—"}</strong>
            </div>
            <div className="reports-stat-card">
              <span className="muted small">Promedio</span>
              <strong className="mono">{listenerHistory.avgListeners ?? "—"}</strong>
            </div>
            <div className="reports-stat-card">
              <span className="muted small">Última muestra</span>
              <strong className="mono">{listenerHistory.latest?.listeners ?? "—"}</strong>
              {listenerHistory.latest?.targetName ? (
                <span className="muted small">{listenerHistory.latest.targetName}</span>
              ) : null}
            </div>
          </div>
          {listenerHistory.samples.length === 0 ? (
            <p className="muted mt">Sin muestras aún. Active un destino Icecast y espere el primer ciclo de muestreo.</p>
          ) : (
            <>
              <h3 className="small mt">Historial 24 h</h3>
              <div className="reports-listener-chart" role="img" aria-label="Gráfico de oyentes">
                {listenerHistory.samples.map((s, i) => (
                  <div
                    key={`${s.recordedAt}-${i}`}
                    className="reports-listener-bar-wrap"
                    title={`${new Date(s.recordedAt).toLocaleString()} — ${s.listeners ?? "?"} oyentes`}
                  >
                    <div
                      className="reports-listener-bar"
                      style={{
                        height: `${Math.max(4, ((s.listeners ?? 0) / maxListeners) * 100)}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === "air" ? (
        <>
          <h3 className="small">Auditoría al aire (7 días)</h3>
          <p className="muted small">
            Pistas reproducidas y eventos de automatización (jingles, locución, AutoDJ, programador).
          </p>
          <ul className="log-list">
            {airRows.map((r) => (
              <li key={r.id}>
                <span className="mono small">{new Date(r.createdAt).toLocaleString()}</span>
                <strong>{r.action === "TRACK_PLAYED" ? "▶" : "⚙"}</strong>
                <span>{formatAirRow(r)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {tab === "log" ? (
        <>
          <h3 className="small">Registro de operaciones</h3>
          <ul className="log-list">
            {rows.map((r) => (
              <li key={r.id}>
                <span className="mono small">{new Date(r.createdAt).toLocaleString()}</span>
                <strong>{r.action}</strong>
                {r.user && <span className="muted"> · {r.user.email}</span>}
                {r.asset && <span className="muted"> · {r.asset.title}</span>}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

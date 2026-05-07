import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type LogRow = {
  id: string;
  action: string;
  createdAt: string;
  user: { email: string } | null;
  asset: { title: string } | null;
  details: unknown;
};

export function ReportsPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const ok = user?.role === "admin" || user?.role === "editor";

  useEffect(() => {
    if (!token || !ok) return;
    apiFetch<LogRow[]>("/api/reports/play-log?limit=150", { token })
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : "Error"));
  }, [token, ok]);

  if (!token) return <p className="card">Inicia sesión (editor/admin).</p>;
  if (!ok) return <p className="card">No tienes permiso para ver informes.</p>;
  if (err) return <p className="error card">{err}</p>;

  return (
    <section className="card">
      <h1>Registro de operaciones</h1>
      <p className="muted">Eventos recientes de cola, estación y subidas.</p>
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
    </section>
  );
}

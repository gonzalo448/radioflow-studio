import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import type { ApiSongRequestPendingCount } from "@radioflow/shared";

export function ShellRequestsPeek() {
  const { token, user } = useAuth();
  const [pending, setPending] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const canSee =
    Boolean(token) && (user?.role === "admin" || user?.role === "editor" || user?.role === "dj");

  useEffect(() => {
    if (!canSee || !token) {
      setPending(0);
      return;
    }
    const ac = new AbortController();
    const load = () => {
      void apiFetch<ApiSongRequestPendingCount>("/api/requests/pending-count", {
        token,
        signal: ac.signal,
      })
        .then((r) => {
          if (!ac.signal.aborted) {
            setPending(r.pending);
            setErr(null);
          }
        })
        .catch((e) => {
          if (ac.signal.aborted) return;
          if (e instanceof DOMException && e.name === "AbortError") return;
          setErr(e instanceof Error ? e.message : "Error");
        });
    };
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [canSee, token]);

  if (!canSee) return null;

  return (
    <>
      <div className="shell-rail-divider" />
      <div className="shell-rail-panel">
        <div className="shell-rail-head">
          <strong>Pedidos</strong>
          <Link to="/requests" className="shell-rail-link">
            Moderar{pending > 0 ? ` (${pending})` : ""}
          </Link>
        </div>
        {err ? (
          <p className="shell-rail-muted small error">{err}</p>
        ) : pending > 0 ? (
          <p className="shell-rail-muted small">
            <strong>{pending}</strong> pendiente{pending === 1 ? "" : "s"} de revisión.
          </p>
        ) : (
          <p className="shell-rail-muted small">Sin pedidos pendientes.</p>
        )}
      </div>
    </>
  );
}

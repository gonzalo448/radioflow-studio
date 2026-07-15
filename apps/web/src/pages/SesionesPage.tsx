import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useNotification } from "../context/NotificationContext";
import { authFetch } from "../utils/authFetch";
import "./SesionesPage.css";

type SesionRow = {
  id: string;
  userId: string;
  email: string;
  rol: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  activa: boolean;
};

export function SesionesPage() {
  const { token, user } = useAuth();
  const { showNotification } = useNotification();
  const [sesiones, setSesiones] = useState<SesionRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [soloActivas, setSoloActivas] = useState(false);
  const [revocandoId, setRevocandoId] = useState<string | null>(null);
  const esAdmin = user?.role === "admin";

  const cargar = useCallback(async () => {
    if (!token || !esAdmin) return;
    setErr(null);
    const q = soloActivas ? "?activas=1" : "";
    try {
      const res = await authFetch(`/api/sesiones${q}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as SesionRow[];
      setSesiones(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Error al cargar sesiones", e);
      setErr(e instanceof Error ? e.message : "Error al cargar sesiones");
      setSesiones([]);
    }
  }, [token, esAdmin, soloActivas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const revocarSesion = async (id: string) => {
    if (!token || !esAdmin) return;
    setErr(null);
    setRevocandoId(id);
    try {
      const res = await authFetch(`/api/sesiones/revocar/${encodeURIComponent(id)}`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await res.json();
      setSesiones((prev) =>
        prev.map((s) => (s.id === id ? { ...s, revoked: true, activa: false } : s)),
      );
      showNotification("Sesión revocada", "success");
    } catch (e) {
      console.error("Error al revocar sesión", e);
      const msg = e instanceof Error ? e.message : "Error al revocar sesión";
      setErr(msg);
      showNotification(`❌ ${msg}`, "error");
    } finally {
      setRevocandoId(null);
    }
  };

  if (!token) {
    return (
      <p className="card">
        Debe <NavLink to="/login">iniciar sesión</NavLink>.
      </p>
    );
  }
  if (!esAdmin) {
    return <p className="card">Solo administradores pueden ver sesiones de refresh.</p>;
  }

  return (
    <div className="sesiones-page sesiones-container">
      <h2 className="sesiones-title">Sesiones de refresh</h2>
      {err ? (
        <p className="error" role="alert">
          {err}
        </p>
      ) : null}
      <div className="sesiones-toolbar">
        <label className="muted small">
          <input
            type="checkbox"
            checked={soloActivas}
            onChange={(ev) => setSoloActivas(ev.target.checked)}
          />{" "}
          Solo activas (no revocadas y vigentes)
        </label>
      </div>
      <div className="sesiones-table-wrap">
        <table className="sesiones-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>IP</th>
              <th>Inicio</th>
              <th>Expira</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sesiones.map((s) => (
              <tr key={s.id}>
                <td>{s.email}</td>
                <td className="mono small">{s.ip}</td>
                <td className="mono small">{new Date(s.createdAt).toLocaleString()}</td>
                <td className="mono small">{new Date(s.expiresAt).toLocaleString()}</td>
                <td>
                  {!s.revoked ? (
                    <button
                      type="button"
                      className="sesiones-revoke"
                      disabled={revocandoId === s.id}
                      onClick={() => void revocarSesion(s.id)}
                    >
                      Revocar
                    </button>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sesiones.length === 0 && !err ? <p className="muted">No hay sesiones para mostrar.</p> : null}
    </div>
  );
}

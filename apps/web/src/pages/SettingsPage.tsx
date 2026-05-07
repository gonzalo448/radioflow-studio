import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type Settings = {
  id: string;
  stationName: string;
  tagline: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  activeStreamingTargetId: string | null;
};

type StreamStub = { id: string; name: string };

export function SettingsPage() {
  const { token, user } = useAuth();
  const [s, setS] = useState<Settings | null>(null);
  const [streamTargets, setStreamTargets] = useState<StreamStub[]>([]);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canEdit = user?.role === "admin" || user?.role === "editor";

  useEffect(() => {
    apiFetch<Settings>("/api/settings")
      .then((data) => {
        setS(data);
        setBootErr(null);
      })
      .catch((e) => setBootErr(e instanceof Error ? e.message : "Error"));
  }, []);

  useEffect(() => {
    if (!token || !canEdit) return;
    apiFetch<{ id: string; name: string }[]>("/api/streaming/targets", { token })
      .then(setStreamTargets)
      .catch(() => setStreamTargets([]));
  }, [token, canEdit]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !s) return;
    try {
      const updated = await apiFetch<Settings>("/api/settings", {
        method: "PATCH",
        token,
        body: JSON.stringify({
          stationName: s.stationName,
          tagline: s.tagline,
          primaryColor: s.primaryColor,
          logoUrl: s.logoUrl,
          activeStreamingTargetId: s.activeStreamingTargetId ?? null,
        }),
      });
      setS(updated);
      if (updated.primaryColor) {
        document.documentElement.style.setProperty("--accent", updated.primaryColor);
      }
      setMsg("Guardado");
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  if (bootErr) return <p className="error card">{bootErr}</p>;
  if (!s) return <p>Cargando…</p>;

  return (
    <section className="card">
      <h1>Marca y cabecera</h1>
      <p className="muted">
        Afecta al panel (variable CSS <code>--accent</code>), metadatos públicos y el destino que el encoder puede
        resolver vía API (token dj+).
      </p>
      {!canEdit && <p className="badge">Solo lectura · editor o admin para cambiar</p>}
      {msg && <p className={msg === "Guardado" ? "badge" : "error"}>{msg}</p>}
      <form className="form" onSubmit={onSave}>
        <label>
          Nombre de la emisora
          <input
            value={s.stationName}
            disabled={!canEdit}
            onChange={(e) => setS({ ...s, stationName: e.target.value })}
          />
        </label>
        <label>
          Eslogan
          <input
            value={s.tagline ?? ""}
            disabled={!canEdit}
            onChange={(e) => setS({ ...s, tagline: e.target.value || null })}
          />
        </label>
        <label>
          Color primario (hex)
          <input
            value={s.primaryColor ?? ""}
            disabled={!canEdit}
            onChange={(e) => setS({ ...s, primaryColor: e.target.value || null })}
          />
        </label>
        <label>
          URL del logo
          <input
            value={s.logoUrl ?? ""}
            disabled={!canEdit}
            onChange={(e) => setS({ ...s, logoUrl: e.target.value || null })}
          />
        </label>
        {canEdit && token && streamTargets.length > 0 && (
          <label>
            Destino activo para el encoder (FFmpeg)
            <select
              className="select"
              value={s.activeStreamingTargetId ?? ""}
              disabled={!canEdit}
              onChange={(e) =>
                setS({ ...s, activeStreamingTargetId: e.target.value ? e.target.value : null })
              }
            >
              <option value="">Ninguno — solo variable de entorno del encoder</option>
              {streamTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {canEdit && token && streamTargets.length === 0 && (
          <p className="muted small">
            Crea primero un destino en <strong>Streaming</strong> para elegir la salida del encoder aquí.
          </p>
        )}
          <button type="submit" className="btn primary">
            Guardar
          </button>
        )}
      </form>
    </section>
  );
}

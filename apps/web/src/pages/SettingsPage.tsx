import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type Settings = {
  id: string;
  stationName: string;
  tagline: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
};

export function SettingsPage() {
  const { token, user } = useAuth();
  const [s, setS] = useState<Settings | null>(null);
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
      <p className="muted">Afecta al panel (variable CSS <code>--accent</code>) y metadatos públicos.</p>
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
        {canEdit && token && (
          <button type="submit" className="btn primary">
            Guardar
          </button>
        )}
      </form>
    </section>
  );
}

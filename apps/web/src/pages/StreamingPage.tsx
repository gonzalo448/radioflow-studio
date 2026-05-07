import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type Target = {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  mountPath: string;
  tls: boolean;
  enabled: boolean;
  hasSourcePassword: boolean;
  publicBaseUrl: string | null;
};

export function StreamingPage() {
  const { token, user } = useAuth();
  const [targets, setTargets] = useState<Target[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("Icecast principal");
  const [protocol, setProtocol] = useState<"icecast" | "shoutcast" | "azuracast">("icecast");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(8000);
  const [mountPath, setMountPath] = useState("/stream");
  const [sourcePassword, setSourcePassword] = useState("");

  const [activeEncoderId, setActiveEncoderId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ activeStreamingTargetId?: string | null }>("/api/settings")
      .then((st) => setActiveEncoderId(st.activeStreamingTargetId ?? null))
      .catch(() => setActiveEncoderId(null));
  }, []);

  const load = useCallback(async () => {
    if (!token) {
      setTargets([]);
      setLoadErr(null);
      return;
    }
    try {
      const data = await apiFetch<Target[]>("/api/streaming/targets", { token });
      setTargets(data);
      setLoadErr(null);
    } catch (e) {
      setTargets([]);
      setLoadErr(e instanceof Error ? e.message : "Error");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setMsg("Inicia sesión (editor/admin)");
      return;
    }
    try {
      await apiFetch("/api/streaming/targets", {
        method: "POST",
        token,
        body: JSON.stringify({
          name,
          protocol,
          host,
          port,
          mountPath,
          sourcePassword: sourcePassword || "changeme",
          tls: false,
          enabled: true,
        }),
      });
      setMsg(null);
      setSourcePassword("");
      await load();
      const st = await apiFetch<{ activeStreamingTargetId?: string | null }>("/api/settings");
      setActiveEncoderId(st.activeStreamingTargetId ?? null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function remove(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/streaming/targets/${id}`, { method: "DELETE", token });
      await load();
      const st = await apiFetch<{ activeStreamingTargetId?: string | null }>("/api/settings");
      setActiveEncoderId(st.activeStreamingTargetId ?? null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <section className="card">
      <h1>Destinos de streaming</h1>
      <p className="muted">
        Metadatos para Icecast, Shoutcast o AzuraCast. Las contraseñas de fuente no se muestran en el panel; solo el
        indicador hasSourcePassword. Ver destinos requiere sesión.
      </p>
      {!token && <p className="badge">Inicia sesión para listar destinos.</p>}
      {user && (
        <p className="badge">
          Rol: <code>{user.role}</code>
        </p>
      )}
      {loadErr && <p className="error">{loadErr}</p>}
      {msg && <p className="error">{msg}</p>}
      <form className="form inline-grid" onSubmit={onCreate}>
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Protocolo
          <select className="select" value={protocol} onChange={(e) => setProtocol(e.target.value as typeof protocol)}>
            <option value="icecast">Icecast</option>
            <option value="shoutcast">Shoutcast</option>
            <option value="azuracast">AzuraCast</option>
          </select>
        </label>
        <label>
          Host
          <input value={host} onChange={(e) => setHost(e.target.value)} required />
        </label>
        <label>
          Puerto
          <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} min={1} max={65535} />
        </label>
        <label>
          Mount
          <input value={mountPath} onChange={(e) => setMountPath(e.target.value)} />
        </label>
        <label>
          Contraseña de fuente
          <input
            type="password"
            value={sourcePassword}
            onChange={(e) => setSourcePassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>
        <button type="submit" className="btn primary">
          Guardar destino
        </button>
      </form>
      <h3 className="mt">Configurados</h3>
      <ul className="list">
        {targets.map((t) => (
          <li key={t.id}>
            <div>
              <strong>{t.name}</strong>{" "}
              {activeEncoderId === t.id && (
                <span className="badge" style={{ marginLeft: "0.35rem" }}>
                  Salida encoder
                </span>
              )}{" "}
              <span className="muted">
                {t.protocol}://{t.host}:{t.port}
                {t.mountPath} · TLS: {t.tls ? "sí" : "no"} · clave: {t.hasSourcePassword ? "definida" : "no"}
              </span>
            </div>
            {token && (user?.role === "admin" || user?.role === "editor") && (
              <button type="button" className="btn ghost" onClick={() => void remove(t.id)}>
                Eliminar
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

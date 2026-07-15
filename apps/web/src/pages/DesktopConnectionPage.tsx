import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  defaultApiOriginForSetup,
  markDesktopSetupDone,
  setStoredApiOrigin,
  STORAGE_API_ORIGIN_KEY,
} from "../lib/api-base";

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

/** Ajuste de URL del API (escritorio contra servidor remoto). */
export function DesktopConnectionPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState(() => defaultApiOriginForSetup());
  const [msg, setMsg] = useState<string | null>(null);
  const [okHint, setOkHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function testConnection() {
    setMsg(null);
    setOkHint(null);
    const base = normalizeBase(url);
    if (!base) {
      setMsg("Indique la URL del servidor (ej. http://127.0.0.1:4000)");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/health`);
      if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
      const j = (await r.json()) as { status?: string; version?: string };
      setOkHint(`Conexión correcta · API ${j.version ?? "—"} · estado ${j.status ?? "—"}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo conectar");
    } finally {
      setBusy(false);
    }
  }

  function applyAndEnter() {
    setMsg(null);
    const base = normalizeBase(url);
    if (!base) {
      setMsg("Indique la URL del servidor o use «Continuar con la del instalador».");
      return;
    }
    setStoredApiOrigin(base);
    markDesktopSetupDone();
    setOkHint("Guardado. La cabina usará esta URL.");
    void navigate("/station", { replace: true });
  }

  function continueWithPackagedDefault(e: FormEvent) {
    e.preventDefault();
    try {
      localStorage.removeItem(STORAGE_API_ORIGIN_KEY);
    } catch {
      /* ignore */
    }
    markDesktopSetupDone();
    window.dispatchEvent(new CustomEvent("radioflow:api-origin-changed"));
    void navigate("/station", { replace: true });
  }

  return (
    <section className="card desktop-conn-page">
      <h1 className="desktop-conn-title">Conexión al servidor</h1>
      <p className="muted desktop-conn-lead">
        Cambie la URL si el servidor se movió de máquina o de puerto.
      </p>

      <form className="desktop-conn-form" onSubmit={(e) => e.preventDefault()}>
        <label className="desktop-conn-label">
          URL del API (sin /api al final)
          <input
            className="desktop-conn-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:4000"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="desktop-conn-actions row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void testConnection()}>
            {busy ? "Probando…" : "Probar conexión"}
          </button>
          <button type="button" className="btn primary" onClick={() => applyAndEnter()}>
            Guardar y continuar
          </button>
          <button type="button" className="btn ghost" onClick={continueWithPackagedDefault}>
            Continuar con la del instalador
          </button>
        </div>
      </form>

      {okHint ? <p className="muted small desktop-conn-ok">{okHint}</p> : null}
      {msg ? <p className="error small desktop-conn-err">{msg}</p> : null}

      <p className="muted small desktop-conn-foot">
        Puede volver aquí desde <strong>Vista → Servidor API…</strong> en cualquier momento.
      </p>
    </section>
  );
}

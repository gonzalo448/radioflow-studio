import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { dispatchSettingsBranding, applyStationTitle } from "../lib/settings-branding";
import { AppLogo } from "../components/AppLogo";
import type { ApiAuthRegisterResponse } from "@radioflow/shared";
import "./SetupAccountPage.css";

export function SetupAccountPage() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [stationName, setStationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!stationName.trim()) {
      setError("Indique el nombre de su emisora.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const data = await apiFetch<ApiAuthRegisterResponse>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
          displayName: displayName.trim() || undefined,
          stationName: stationName.trim(),
        }),
      });
      setSession(data.token, data.refreshToken, data.user);
      dispatchSettingsBranding({ stationName: stationName.trim() });
      applyStationTitle(stationName.trim());
      nav("/station", { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo crear su usuario";
      setError(msg);
      if (msg.includes("ya está configurada") || msg.includes("Inicia sesión")) {
        nav("/login", { replace: true });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-account-page">
      <div className="setup-account-card card">
        <p className="muted small">
          <Link to="/bienvenida">← Bienvenida</Link>
        </p>
        <AppLogo variant="auth" />
        <h1>Cree su usuario</h1>
        <p className="setup-account-lead muted">
          Este correo y contraseña son solo para esta instalación en su equipo. Tendrá acceso a todas las
          funciones de la emisora.
        </p>
        <form className="setup-account-form" onSubmit={(e) => void onSubmit(e)}>
          <label>
            Nombre de la emisora
            <input
              type="text"
              value={stationName}
              onChange={(e) => setStationName(e.target.value)}
              required
              autoComplete="organization"
              placeholder="Ej. FM Sol, Radio del Pueblo"
            />
          </label>
          <label>
            Su nombre (opcional)
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              placeholder="Ej. Gonzalo"
            />
          </label>
          <label>
            Correo
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="tu@correo.com"
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label>
            Repetir contraseña
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <button type="submit" className="btn primary setup-account-submit" disabled={busy}>
            {busy ? "Creando…" : "Entrar a RadioFlow"}
          </button>
        </form>
        {error ? <p className="error setup-account-error">{error}</p> : null}
      </div>
    </div>
  );
}

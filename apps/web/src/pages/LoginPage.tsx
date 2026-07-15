import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { AppLogo } from "../components/AppLogo";
import { isDesktopProduct } from "../lib/desktop-product";
import type { ApiAuthLoginResponse } from "@radioflow/shared";
import "./LoginPage.css";

export function LoginPage() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const returnTo =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/station";
  const embedded = isDesktopProduct();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await apiFetch<ApiAuthLoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setSession(data.token, data.refreshToken, data.user);
      nav(returnTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Correo o contraseña incorrectos");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-standalone">
      <div className="login-container login-container--wide">
        <AppLogo variant="auth" />
        <p className="login-product-lead muted">
          {embedded
            ? "Inicia sesión con el usuario que creaste en esta instalación."
            : "Inicia sesión para operar la emisora."}
        </p>

        <form onSubmit={handleLogin} className="login-form">
          <label>
            Correo
            <input
              type="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="btn primary login-submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        {error ? <p className="error login-error">{error}</p> : null}

        {embedded ? (
          <p className="muted small login-foot">
            ¿Primera vez?{" "}
            <Link to="/bienvenida">Volver al asistente de bienvenida</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

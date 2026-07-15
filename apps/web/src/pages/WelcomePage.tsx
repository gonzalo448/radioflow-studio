import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useSetupStatus } from "../hooks/useSetupStatus";
import { markWelcomeSeen } from "../lib/welcome-session";
import "./WelcomePage.css";

function welcomeNextPath(needsAccount: boolean, hasSession: boolean): string {
  if (needsAccount) return "/configuracion";
  if (hasSession) return "/station";
  return "/login";
}

export function WelcomePage() {
  const nav = useNavigate();
  const { user, token } = useAuth();
  const { needsAccount } = useSetupStatus();

  function onComenzar() {
    markWelcomeSeen();
    nav(welcomeNextPath(needsAccount, Boolean(user || token)), { replace: true });
  }

  return (
    <div className="welcome-page">
      <div className="welcome-backdrop" aria-hidden />
      <div className="welcome-shell">
        <figure className="welcome-hero">
          <img
            src="./welcome-hero.png"
            alt="Bienvenido a RadioFlow Studio — Automatización radial eficiente. Su música, su radio, su control."
            className="welcome-hero-img"
            width={720}
            height={720}
            decoding="async"
          />
        </figure>

        <div className="welcome-actions">
          <button type="button" className="welcome-cta" onClick={onComenzar}>
            {needsAccount ? "Comenzar" : "Entrar"}
          </button>
        </div>

        <p className="welcome-foot">
          {needsAccount
            ? "En el siguiente paso cree su usuario y el nombre de su emisora. Todo queda en este equipo."
            : "Su emisora ya está en este equipo. Inicia sesión o entre directamente si ya está conectado."}
        </p>
      </div>
    </div>
  );
}

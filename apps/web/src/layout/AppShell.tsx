import { useEffect, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppLogo } from "../components/AppLogo";
import { StationLogo } from "../components/StationLogo";
import { FileExplorerNavIcon } from "../components/icons/FileExplorerNavIcon";
import { NowPlayingRibbon } from "./NowPlayingRibbon";
import { ShellNowPlayingBar } from "../components/playout/ShellNowPlayingBar";
import { ShellQueuePeek } from "./ShellQueuePeek";
import { ShellSchedulerPeek } from "./ShellSchedulerPeek";
import { ShellRequestsPeek } from "./ShellRequestsPeek";
import { RadioflowTopMenuBar } from "./RadioflowTopMenuBar";
import { useShellLayout } from "./ShellLayoutContext";
import { TransportStrip } from "./TransportStrip";
import { DesktopQuickNav } from "../components/DesktopQuickNav";
import { useDesktopNavigationBridge } from "../hooks/useDesktopNavigationBridge";
import { useCabinaHotkeys } from "../hooks/useCabinaHotkeys";
import { useGlobalCartHotkeys } from "../hooks/useGlobalCartHotkeys";
import { useAppSettingsBranding } from "../hooks/useAppSettingsBranding";
import { useAutoResumeEncoder } from "../hooks/useAutoResumeEncoder";
import { CartFireToast } from "../components/jingles/CartFireToast";
import { isDesktopProduct, isDesktopShell } from "../lib/desktop-product";

type NavItem = {
  to: string;
  label: string;
  title?: string;
  ariaLabel?: string;
  end?: boolean;
  icon?: string;
  Icon?: ComponentType<{ className?: string }>;
  emphasize?: boolean;
};

const PRIMARY_NAV: NavItem[] = [
  { to: "/station", label: "Playout", icon: "▶" },
  { to: "/schedule", label: "Parrilla", icon: "▦" },
  { to: "/ads", label: "Publicidad", icon: "◈" },
  { to: "/admin/eventos", label: "Eventos", icon: "🔔" },
  { to: "/playlists", label: "Listas", icon: "≡" },
  {
    to: "/explorador",
    label: "Explorador",
    title: "Discos y carpetas del equipo — importar música",
    ariaLabel: "Explorador de archivos del equipo",
    Icon: FileExplorerNavIcon,
    emphasize: true,
  },
  { to: "/library", label: "Librería", icon: "♫" },
  { to: "/emitir", label: "Emitir", icon: "◉" },
  { to: "/reports", label: "Informes", icon: "▤" },
  { to: "/settings", label: "Marca", icon: "◆" },
  { to: "/panel", label: "Panel", icon: "▣", end: true },
];

function sessionNav(loggedIn: boolean): NavItem[] {
  if (!loggedIn) return [];
  return [{ to: "/account/password", label: "Contraseña", icon: "∗" }];
}

function extraNav(role: string | undefined): NavItem[] {
  const out: NavItem[] = [];
  if (role === "admin" || role === "editor") {
    out.push({ to: "/scheduler", label: "Scheduler", icon: "⏱" });
  }
  if (role === "admin") {
    out.push({ to: "/admin", label: "Administración", icon: "🛠", end: true });
  }
  return out;
}

function useClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/** Build instalable (Electron): HashRouter + una sola navegación = menús superiores (opción A). */

export function AppShell() {
  const { user, logout } = useAuth();
  const { stationName, logoUrl, logoVersion } = useAppSettingsBranding();
  const { railsVisible } = useShellLayout();
  const { pathname } = useLocation();
  const onCabina = pathname === "/station" || pathname.endsWith("/station");
  const clock = useClock();
  useCabinaHotkeys();
  useGlobalCartHotkeys();
  useDesktopNavigationBridge();
  useAutoResumeEncoder();
  const navItems = [...PRIMARY_NAV, ...sessionNav(!!user), ...extraNav(user?.role)];

  return (
    <div
      className={`app-shell${railsVisible ? "" : " app-shell--no-rails"}${isDesktopShell() ? " app-shell--desktop-menu-only" : ""}${onCabina ? " app-shell--cabina" : ""}`}
    >
      <CartFireToast />
      {import.meta.env.DEV && !isDesktopShell() ? (
        <div className="dev-banner dev-banner--shell" role="status">
          Desarrollo · panel web solo CI (`VITE_ALLOW_WEB_PANEL`)
        </div>
      ) : null}

      <header className="shell-menubar">
        <div className="shell-menubar-toprow">
          <div className="shell-menubar-left">
            <NavLink to="/station" className="shell-menubar-brand" title="RadioFlow Studio">
              <AppLogo variant="header" />
            </NavLink>
            <time className="shell-clock mono" dateTime={clock.toISOString()}>
              {clock.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              <span className="shell-clock-date muted">
                {clock.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "numeric" })}
              </span>
            </time>
          </div>
          <div className="shell-menubar-right">
            {user ? (
              <>
                <StationLogo logoUrl={logoUrl} stationName={stationName} cacheVersion={logoVersion} />
                {stationName && stationName !== "RadioFlow Studio" ? (
                  <>
                    <span className="shell-station" title="Emisora">
                      {stationName}
                    </span>
                    <span className="shell-identity-sep muted" aria-hidden>
                      ·
                    </span>
                  </>
                ) : null}
                <span className="shell-user mono small" title={user.email}>
                  {user.displayName?.trim() || user.email}
                </span>
                {!isDesktopProduct() ? <span className="badge shell-role">{user.role}</span> : null}
                <button type="button" className="btn btn-menubar" onClick={() => logout()}>
                  Cerrar sesión
                </button>
              </>
            ) : (
              <NavLink to="/login" className="btn btn-menubar primary">
                Entrar
              </NavLink>
            )}
          </div>
        </div>
        {isDesktopShell() ? (
          <div className="shell-menubar-menubarrow">
            <span className="shell-menubar-menutag">Menú</span>
            <RadioflowTopMenuBar layout="menubar" />
          </div>
        ) : null}
      </header>

      {isDesktopProduct() ? <DesktopQuickNav /> : null}

      {!isDesktopShell() ? (
        <div className="shell-toolbar-wrap">
          <nav className="shell-toolbar" aria-label="Módulos">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.title}
                aria-label={item.ariaLabel ?? item.title ?? item.label}
                className={({ isActive }) =>
                  `shell-toolbtn${isActive ? " is-active" : ""}${item.emphasize ? " shell-toolbtn--module-key" : ""}`
                }
              >
                <span className="shell-toolbtn-icon" aria-hidden>
                  {item.Icon ? <item.Icon className="shell-toolbtn-svg" /> : item.icon}
                </span>
                <span className="shell-toolbtn-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <details className="shell-more-menu">
            <summary className="btn btn-compact shell-more-summary">Más…</summary>
            <div className="shell-more-panel">
              <RadioflowTopMenuBar layout="popover" />
            </div>
          </details>
        </div>
      ) : null}

      <NowPlayingRibbon />

      <div className="shell-desk">
        <aside className="shell-rail shell-rail--left" aria-label="Programador y registro">
          <ShellSchedulerPeek />
          <ShellRequestsPeek />
        </aside>
        <div className="shell-main-col">
          <main className="shell-work">
            <Outlet />
          </main>
          {/* B1: en Cabina el transporte vive en rb-transport; no duplicar TransportStrip */}
          {!isDesktopShell() && !onCabina ? <TransportStrip /> : null}
        </div>
        <aside className="shell-rail shell-rail--right" aria-label="Cola">
          <ShellQueuePeek />
        </aside>
      </div>

      <footer className="shell-statusbar">
        {/* B1: en Cabina strip+dock ya muestran la pista; barra inferior compacta */}
        {onCabina ? (
          <span className="shell-status-item muted" title="Metadatos al aire en la franja superior y el dock">
            Cabina · strip + dock
          </span>
        ) : (
          <ShellNowPlayingBar />
        )}
        {!isDesktopShell() ? (
          <>
            <span className="shell-status-item muted">WebSocket y cola en tiempo real</span>
            <span className="shell-status-item muted mono" title="Identificador del build empaquetado (escritorio)">
              {import.meta.env.VITE_BUILD_STAMP ? `build ${import.meta.env.VITE_BUILD_STAMP}` : "dev"}
            </span>
          </>
        ) : null}
      </footer>
    </div>
  );
}

import { NavLink } from "react-router-dom";
import { FileExplorerNavIcon } from "./icons/FileExplorerNavIcon";

const ITEMS = [
  { to: "/station", label: "Cabina", icon: "▶" },
  { to: "/jingles", label: "Jingles", icon: "⌨" },
  { to: "/explorador", label: "Explorador", Icon: FileExplorerNavIcon, emphasize: true },
  { to: "/library", label: "Librería", icon: "♫" },
  { to: "/playlists", label: "Listas", icon: "≡" },
  { to: "/schedule", label: "Parrilla", icon: "▦" },
  { to: "/emitir", label: "Emitir", icon: "◉", title: "Icecast, encoder y reproductor web" },
  { to: "/settings", label: "Marca", icon: "◆", title: "Nombre, logo y color" },
] as const;

/** Accesos directos visibles en la app instalada (el menú Archivo/Vista sigue disponible arriba). */
export function DesktopQuickNav() {
  return (
    <nav className="desktop-quick-nav" aria-label="Accesos rápidos">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          title={"title" in item && item.title ? item.title : item.label}
          className={({ isActive }) =>
            `desktop-quick-nav-btn${isActive ? " is-active" : ""}${"emphasize" in item && item.emphasize ? " desktop-quick-nav-btn--key" : ""}`
          }
        >
          <span className="desktop-quick-nav-icon" aria-hidden>
            {"Icon" in item && item.Icon ? (
              <item.Icon className="desktop-quick-nav-svg" />
            ) : (
              "icon" in item ? item.icon : null
            )}
          </span>
          <span className="desktop-quick-nav-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import "./AdminConsoleLayout.css";

type AdminNavItem = {
  to: string;
  label: string;
  icon: string;
  featured?: boolean;
};

const ADMIN_NAV: AdminNavItem[] = [
  { to: "/admin/usuarios", label: "Usuarios", icon: "👤" },
  { to: "/admin/eventos", label: "Eventos", icon: "📢" },
  { to: "/admin/sesiones", label: "Sesiones", icon: "🔑", featured: true },
  { to: "/admin/security", label: "Seguridad", icon: "⚿" },
];

function isEventosPath(pathname: string): boolean {
  return pathname === "/admin/eventos" || pathname.startsWith("/admin/eventos/");
}

export function AdminConsoleLayout() {
  const { user, token } = useAuth();
  const location = useLocation();
  const esAdmin = user?.role === "admin";

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!esAdmin) {
    if (!isEventosPath(location.pathname)) {
      return <Navigate to="/inicio" replace />;
    }
    return <Outlet />;
  }

  return (
    <div className="admin-console">
      <div className="admin-console-body">
        <nav className="admin-console-sidebar" aria-label="Navegación administración">
          <div className="admin-console-nav-title">Administración</div>
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `admin-console-nav-link${isActive ? " is-active" : ""}${item.featured ? " admin-console-nav-link--featured" : ""}`
              }
            >
              <span className="admin-console-nav-icon" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="admin-console-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

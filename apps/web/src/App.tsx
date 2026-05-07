import { useEffect } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Dashboard } from "./pages/Dashboard";
import { LibraryPage } from "./pages/LibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlaylistDetailPage } from "./pages/PlaylistDetailPage";
import { PlaylistsPage } from "./pages/PlaylistsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SchedulePage } from "./pages/SchedulePage";
import { SettingsPage } from "./pages/SettingsPage";
import { StationPage } from "./pages/StationPage";
import { StreamingPage } from "./pages/StreamingPage";

function useBranding() {
  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => {
        if (!r.ok) return;
        const text = await r.text();
        let s: { stationName?: string; primaryColor?: string | null; tagline?: string | null };
        try {
          s = text ? JSON.parse(text) : {};
        } catch {
          return;
        }
        if (s.primaryColor) {
          document.documentElement.style.setProperty("--accent", s.primaryColor);
        }
        if (s.stationName) {
          document.title = s.stationName;
        }
      })
      .catch(() => {
        /* red / marca no crítico */
      });
  }, []);
}

export default function App() {
  const { user, logout } = useAuth();
  useBranding();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <strong>RadioFlow Studio</strong>
            <p className="muted">Autom radial · PWA · IA semántica</p>
          </div>
        </div>
        <nav className="nav">
          <Link to="/">Panel</Link>
          <Link to="/station">Estación</Link>
          <Link to="/schedule">Parrilla</Link>
          <Link to="/playlists">Playlists</Link>
          <Link to="/library">Librería</Link>
          <Link to="/streaming">Streaming</Link>
          <Link to="/reports">Informes</Link>
          <Link to="/settings">Marca</Link>
          {user ? (
            <button type="button" className="btn linkish" onClick={() => logout()}>
              Salir
            </button>
          ) : (
            <Link to="/login">Entrar</Link>
          )}
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/station" element={<StationPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/streaming" element={<StreamingPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}

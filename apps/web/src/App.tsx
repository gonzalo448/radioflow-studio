import { Link, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Dashboard } from "./pages/Dashboard";
import { LibraryPage } from "./pages/LibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { SchedulePage } from "./pages/SchedulePage";
import { StationPage } from "./pages/StationPage";
import { StreamingPage } from "./pages/StreamingPage";

export default function App() {
  const { user, logout } = useAuth();

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
          <Link to="/library">Librería</Link>
          <Link to="/streaming">Streaming</Link>
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
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/streaming" element={<StreamingPage />} />
        </Routes>
      </main>
    </div>
  );
}

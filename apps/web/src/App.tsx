import { Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { apiUrl } from "./lib/api-base";
import { isDesktopProduct } from "./lib/desktop-product";
import { AppShell } from "./layout/AppShell";
import { AdminConsoleLayout } from "./layout/AdminConsoleLayout";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { DesktopConnectionPage } from "./pages/DesktopConnectionPage";
import { RoutePageFallback } from "./components/RoutePageFallback";
import {
  AdsSchedulerPage,
  ChangePasswordPage,
  Dashboard,
  DesktopStatusPage,
  EventosPage,
  FxPage,
  HelpPage,
  InsumosPage,
  JinglesPage,
  LibraryPage,
  PlaylistDetailPage,
  PlaylistsPage,
  ReportsPage,
  RequestsPage,
  SchedulePage,
  SchedulerEventsPage,
  SecurityOpsPage,
  SesionesPage,
  SettingsPage,
  StationPage,
  StreamingPage,
  UsuariosPage,
  VoicetrackEditorPage,
  ClockTemplatesPage,
  EmitirPage,
  ListenPage,
  AzuraRadioPage,
} from "./lazy-pages";
import { NotificationProvider } from "./context/NotificationContext";
import { InstallOnboardingGate } from "./components/InstallOnboardingGate";
import { InstallRequiredPage } from "./pages/InstallRequiredPage";
import { WelcomePage } from "./pages/WelcomePage";
import { SetupAccountPage } from "./pages/SetupAccountPage";
import { shouldShowInstallGate, allowsWebPanel } from "./lib/installable-client";

/** Reproductores públicos: se pueden abrir en el navegador sin la app instalada. */
function isPublicListenerPath(pathname: string): boolean {
  return pathname === "/radio" || pathname === "/listen";
}

function useBranding() {
  useEffect(() => {
    const ac = new AbortController();
    void fetch(apiUrl("/api/settings"), { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok || ac.signal.aborted) return;
        const text = await r.text();
        let s: { stationName?: string; primaryColor?: string | null; tagline?: string | null };
        try {
          s = text ? JSON.parse(text) : {};
        } catch {
          return;
        }
        if (ac.signal.aborted) return;
        if (s.primaryColor) {
          document.documentElement.style.setProperty("--accent", s.primaryColor);
        }
        if (s.stationName) {
          document.title = s.stationName;
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });
    return () => ac.abort();
  }, []);
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RoutePageFallback />}>{children}</Suspense>;
}

function AppRoutes() {
  useBranding();

  return (
    <Routes>
      <Route path="/bienvenida" element={<WelcomePage />} />
      <Route path="/configuracion" element={<SetupAccountPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/listen" element={<Lazy><ListenPage /></Lazy>} />
      <Route path="/radio" element={<Lazy><AzuraRadioPage /></Lazy>} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/station" replace />} />
        <Route path="inicio" element={<Navigate to="/station" replace />} />
        <Route
          path="conexion"
          element={
            isDesktopProduct() || !allowsWebPanel() ? (
              <Navigate to="/station" replace />
            ) : (
              <DesktopConnectionPage />
            )
          }
        />
        <Route path="station" element={<Lazy><StationPage /></Lazy>} />
        <Route path="schedule" element={<Lazy><SchedulePage /></Lazy>} />
        <Route path="programacion" element={<Navigate to="/schedule?legacy=programacion" replace />} />
        <Route path="historial" element={<Navigate to="/reports" replace />} />
        <Route path="usuarios" element={<Navigate to="/admin/usuarios" replace />} />
        <Route path="eventos" element={<Navigate to="/admin/eventos" replace />} />
        <Route path="scheduler" element={<Lazy><SchedulerEventsPage /></Lazy>} />
        <Route path="ads" element={<Lazy><AdsSchedulerPage /></Lazy>} />
        <Route path="playlists" element={<Lazy><PlaylistsPage /></Lazy>} />
        <Route path="playlists/:id" element={<Lazy><PlaylistDetailPage /></Lazy>} />
        <Route path="explorador" element={<Lazy><InsumosPage /></Lazy>} />
        <Route path="insumos" element={<Navigate to="/explorador" replace />} />
        <Route path="panel" element={<Lazy><Dashboard /></Lazy>} />
        <Route path="library" element={<Lazy><LibraryPage /></Lazy>} />
        <Route path="streaming" element={<Lazy><StreamingPage /></Lazy>} />
        <Route path="emitir" element={<Lazy><EmitirPage /></Lazy>} />
        <Route path="reports" element={<Lazy><ReportsPage /></Lazy>} />
        <Route path="settings" element={<Lazy><SettingsPage /></Lazy>} />
        <Route path="account/password" element={<Lazy><ChangePasswordPage /></Lazy>} />
        <Route path="security" element={<Navigate to="/admin/security" replace />} />
        <Route path="sesiones" element={<Navigate to="/admin/sesiones" replace />} />
        <Route path="admin" element={<AdminConsoleLayout />}>
          <Route index element={<Navigate to="usuarios" replace />} />
          <Route path="usuarios" element={<Lazy><UsuariosPage /></Lazy>} />
          <Route path="eventos" element={<Lazy><EventosPage /></Lazy>} />
          <Route path="sesiones" element={<Lazy><SesionesPage /></Lazy>} />
          <Route path="security" element={<Lazy><SecurityOpsPage /></Lazy>} />
        </Route>
        <Route path="jingles" element={<Lazy><JinglesPage /></Lazy>} />
        <Route path="fx" element={<Lazy><FxPage /></Lazy>} />
        <Route path="requests" element={<Lazy><RequestsPage /></Lazy>} />
        <Route path="help" element={<Lazy><HelpPage /></Lazy>} />
        <Route path="desktop" element={<Lazy><DesktopStatusPage /></Lazy>} />
        <Route path="voicetrack" element={<Lazy><VoicetrackEditorPage /></Lazy>} />
        <Route path="clocks" element={<Lazy><ClockTemplatesPage /></Lazy>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const publicListener = isPublicListenerPath(pathname);

  if (shouldShowInstallGate() && !publicListener) {
    return <InstallRequiredPage />;
  }

  if (shouldShowInstallGate() && publicListener) {
    return (
      <Routes>
        <Route path="/listen" element={<Lazy><ListenPage /></Lazy>} />
        <Route path="/radio" element={<Lazy><AzuraRadioPage /></Lazy>} />
        <Route path="*" element={<Navigate to="/radio" replace />} />
      </Routes>
    );
  }

  return (
    <NotificationProvider>
      <InstallOnboardingGate>
        <AppRoutes />
      </InstallOnboardingGate>
    </NotificationProvider>
  );
}

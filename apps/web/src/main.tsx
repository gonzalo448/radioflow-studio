import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ShellLayoutProvider } from "./layout/ShellLayoutContext";
import { PlaylistMenuBridgeProvider } from "./playlist/PlaylistMenuBridgeContext";
import { StationLiveProvider } from "./station/StationLiveContext";
import { StationAirPlaybackProvider } from "./station/StationAirPlaybackContext";
import App from "./App";
import { isDesktopShell } from "./lib/desktop-product";
import "./styles.css";

/** Evita que un SW viejo (sesiones anteriores con PWA) sirva bundles obsoletos en desarrollo. */
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) void r.unregister();
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("root no encontrado");

if (isDesktopShell()) {
  document.documentElement.classList.add("desktop-shell");
}

const Router = isDesktopShell() ? HashRouter : BrowserRouter;

createRoot(root).render(
  <StrictMode>
    <Router>
      <AuthProvider>
        <ShellLayoutProvider>
          <PlaylistMenuBridgeProvider>
            <StationLiveProvider>
              <StationAirPlaybackProvider>
                <App />
              </StationAirPlaybackProvider>
            </StationLiveProvider>
          </PlaylistMenuBridgeProvider>
        </ShellLayoutProvider>
      </AuthProvider>
    </Router>
  </StrictMode>,
);

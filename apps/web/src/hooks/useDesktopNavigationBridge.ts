import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** Recibe rutas desde el menú nativo de Electron (Archivo / Vista). */
export function useDesktopNavigationBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const api = window.radioflow?.navigation;
    if (!api?.onNavigate) return;
    return api.onNavigate((path) => {
      if (typeof path === "string" && path.startsWith("/")) navigate(path);
    });
  }, [navigate]);
}

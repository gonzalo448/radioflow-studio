/** Origen guardado en el navegador (prioridad sobre el build). Clave usada por la app de escritorio. */
export const STORAGE_API_ORIGIN_KEY = "radioflow_api_origin";
export const STORAGE_DESKTOP_SETUP_KEY = "radioflow_desktop_setup_v1";

export const API_ORIGIN_CHANGED_EVENT = "radioflow:api-origin-changed";

function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

/** Origen persistido por el usuario (escritorio); vacío si no hay override. */
export function getStoredApiOrigin(): string {
  try {
    const v = localStorage.getItem(STORAGE_API_ORIGIN_KEY);
    if (typeof v === "string" && v.trim()) return normalizeOrigin(v);
  } catch {
    /* private mode */
  }
  return "";
}

/** Origen del build Vite (sin barra final). */
function envApiOrigin(): string {
  const v = import.meta.env.VITE_API_ORIGIN;
  if (typeof v === "string" && v.trim()) return normalizeOrigin(v);
  return "";
}

/**
 * Origen HTTP(S) del backend, sin barra final.
 * Orden: `localStorage` (escritorio) → variable de entorno del build → vacío (proxy / mismo host en web).
 */
function readApiOrigin(): string {
  const stored = getStoredApiOrigin();
  if (stored) return stored;
  return envApiOrigin();
}

export function apiOrigin(): string {
  return readApiOrigin();
}

/** Persiste la URL del API y notifica para reconectar WebSocket / refrescar vistas. */
export function setStoredApiOrigin(url: string | null | undefined): void {
  try {
    if (!url?.trim()) {
      localStorage.removeItem(STORAGE_API_ORIGIN_KEY);
    } else {
      localStorage.setItem(STORAGE_API_ORIGIN_KEY, normalizeOrigin(url));
    }
    window.dispatchEvent(new CustomEvent(API_ORIGIN_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export function markDesktopSetupDone(): void {
  try {
    localStorage.setItem(STORAGE_DESKTOP_SETUP_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Resuelve una ruta de API (`/api/...`) a URL absoluta cuando la app corre en `file://` (Electron). */
export function apiUrl(path: string): string {
  const base = readApiOrigin();
  if (!base) {
    if (path.startsWith("/")) return path;
    return `/${path}`;
  }
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
}

/** URL del WebSocket de cabina; alinea con origen efectivo (guardado o env). */
export function stationWsBaseUrl(): string {
  const base = readApiOrigin();
  if (base) {
    const u = new URL(base);
    const wsProto = u.protocol === "https:" ? "wss" : "ws";
    return `${wsProto}://${u.host}`;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

export function stationWsUrl(): string {
  return `${stationWsBaseUrl()}/api/ws/station`;
}

/** Origen para URLs copiables (Prometheus, etc.). */
export function appPublicOrigin(): string {
  const base = readApiOrigin();
  if (base) return base;
  return window.location.origin;
}

/** URL por defecto en el asistente (empaquetado o desarrollo). */
export function defaultApiOriginForSetup(): string {
  const s = getStoredApiOrigin();
  if (s) return s;
  const e = envApiOrigin();
  if (e) return e;
  return "http://127.0.0.1:4000";
}

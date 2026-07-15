import { apiUrl } from "./api-base";

const ACCESS_KEY = "radioflow_token";
const REFRESH_KEY = "radioflow_refresh";
/** Clientes CRA / guías que usan `accessToken` + `refreshToken` en localStorage. */
const LEGACY_ACCESS_KEY = "accessToken";
const LEGACY_REFRESH_KEY = "refreshToken";
/** Otro alias visto en CRA antiguo. */
const LEGACY_TOKEN_KEY = "token";

const SESSION_EVENT = "radioflow:session";

let refreshInFlight: Promise<string | null> | null = null;

/** Limpia tokens y blob `user` (mismo criterio que `logout` / CRA al fallar refresh). */
export function clearStoredAuth(): void {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(LEGACY_ACCESS_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem("user");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/** Redirección dura a login (SPA BrowserRouter vs HashRouter empaquetado). */
export function hardRedirectToLogin(): void {
  if (import.meta.env.VITE_HASH_ROUTER === "true") {
    window.location.hash = "#/login";
    window.location.reload();
    return;
  }
  const base = import.meta.env.BASE_URL || "/";
  const path = `${base}login`.replace(/\/{2,}/g, "/");
  window.location.assign(path.startsWith("/") ? path : `/${path}`);
}

export function getStoredAccessToken(): string | null {
  return (
    localStorage.getItem(ACCESS_KEY) ??
    localStorage.getItem(LEGACY_ACCESS_KEY) ??
    localStorage.getItem(LEGACY_TOKEN_KEY)
  );
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY) ?? localStorage.getItem(LEGACY_REFRESH_KEY);
}

export function persistAuthTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  localStorage.setItem(LEGACY_ACCESS_KEY, access);
  localStorage.setItem(LEGACY_REFRESH_KEY, refresh);
  localStorage.setItem(LEGACY_TOKEN_KEY, access);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/** Renueva sesión vía `POST /api/refresh` (compatible con flujos tipo CRA). */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const rt = getStoredRefreshToken();
    if (!rt) return null;
    const r = await fetch(apiUrl("/api/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt, token: rt }),
    });
    if (!r.ok) {
      clearStoredAuth();
      return null;
    }
    let data: { accessToken?: string; token?: string; refreshToken?: string };
    try {
      data = (await r.json()) as typeof data;
    } catch {
      clearStoredAuth();
      return null;
    }
    const access = data.accessToken ?? data.token;
    /** API RadioFlow rota el refresh; backends Express mínimos suelen devolver solo `accessToken` y el mismo refresh JWT sigue válido. */
    const hasNewRefresh =
      typeof data.refreshToken === "string" && data.refreshToken.length >= 20;
    const refreshNext = hasNewRefresh ? data.refreshToken! : rt;
    if (!access || !refreshNext) {
      clearStoredAuth();
      return null;
    }
    persistAuthTokens(access, refreshNext);
    return access;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Igual que el helper CRA `authFetch`: adjunta Bearer + JSON, ante 401 intenta `/api/refresh`
 * y devuelve el `Response` final (sin parsear). Si el refresh falla, limpia sesión y redirige a login.
 */
export async function authFetch(input: string, options: RequestInit = {}): Promise<Response> {
  const url = /^https?:\/\//i.test(input) ? input : apiUrl(input);
  const headers = new Headers(options.headers);
  const access = getStoredAccessToken();
  if (access) headers.set("Authorization", `Bearer ${access}`);
  if (!headers.has("Content-Type") && options.body !== undefined && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const buildInit = (): RequestInit => ({ ...options, headers });
  let res = await fetch(url, buildInit());
  if (res.status === 401 && !/\/api\/(auth\/)?refresh/.test(url)) {
    const next = await refreshAccessToken();
    if (next) {
      headers.set("Authorization", `Bearer ${next}`);
      res = await fetch(url, buildInit());
    } else {
      hardRedirectToLogin();
    }
  }
  return res;
}

/**
 * Patrón tipo `fetchWithAuth`: Bearer desde almacenamiento, en 401 intenta `POST /api/refresh` y repite.
 * La URL puede ser ruta `/api/...` o absoluta.
 */
export async function fetchWithAuth(input: string, options: RequestInit = {}): Promise<unknown> {
  const url = /^https?:\/\//i.test(input) ? input : apiUrl(input);
  const headers = new Headers(options.headers);
  const attachBearer = (t: string | null) => {
    if (t) headers.set("Authorization", `Bearer ${t}`);
  };
  attachBearer(getStoredAccessToken());

  const buildInit = (): RequestInit => ({
    ...options,
    headers,
  });

  let res = await fetch(url, buildInit());

  if (res.status === 401 && !/\/api\/(auth\/)?refresh/.test(url)) {
    const next = await refreshAccessToken();
    if (next) {
      headers.set("Authorization", `Bearer ${next}`);
      res = await fetch(url, buildInit());
    } else {
      hardRedirectToLogin();
    }
  }

  if (res.status === 204) return undefined;

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!res.ok) throw new Error(res.statusText || `Error ${res.status}`);
      throw new Error("Respuesta no válida del servidor");
    }
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
        ? (parsed as { error?: string }).error
        : null;
    throw new Error(typeof msg === "string" ? msg : res.status === 404 ? "Ruta no encontrada en el servidor (reinicie la aplicación)" : res.statusText || "Error de API");
  }
  return parsed;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string | null },
): Promise<T> {
  const doFetch = async (token?: string | null) => {
    const headers = new Headers(init?.headers);
    const finalToken = token ?? init?.token ?? getStoredAccessToken();
    if (finalToken) headers.set("Authorization", `Bearer ${finalToken}`);
    if (!headers.has("Content-Type") && init?.body && typeof init.body === "string") {
      headers.set("Content-Type", "application/json");
    }
    return fetch(apiUrl(path), { ...init, headers });
  };

  let r = await doFetch();
  if (
    r.status === 401 &&
    !path.startsWith("/api/auth/refresh") &&
    !path.startsWith("/api/refresh")
  ) {
    const next = await refreshAccessToken();
    if (next) r = await doFetch(next);
    else hardRedirectToLogin();
  }
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  let data: { error?: string } | unknown | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!r.ok) throw new Error(r.statusText || `Error ${r.status}`);
      throw new Error("Respuesta no válida del servidor");
    }
  }
  if (!r.ok) {
    const msg =
      data && typeof data === "object" && data !== null && "error" in data
        ? (data as { error?: string }).error
        : null;
    throw new Error(typeof msg === "string" ? msg : r.statusText || "Error de API");
  }
  return data as T;
}

export async function updateUserPassword(
  id: string,
  newPassword: string,
  token?: string | null,
): Promise<{
  mensaje: string;
  usuario: { id: string; nombre: string; email: string; rol: string; createdAt: string };
}> {
  return apiFetch<{
    mensaje: string;
    usuario: { id: string; nombre: string; email: string; rol: string; createdAt: string };
  }>(`/api/usuarios/${id}/password`, {
    method: "PUT",
    token,
    body: JSON.stringify({ password: newPassword }),
  });
}

export async function changeMyPassword(
  oldPassword: string,
  newPassword: string,
  token?: string | null,
): Promise<{ mensaje: string }> {
  return apiFetch<{ mensaje: string }>(`/api/usuarios/me/password`, {
    method: "PUT",
    token,
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

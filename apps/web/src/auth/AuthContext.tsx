import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ApiAuthRefreshResponse } from "@radioflow/shared";
import { apiUrl } from "../lib/api-base";
import { persistAuthTokens, clearStoredAuth } from "../lib/api";

type User = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
};

type AuthState = {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  setSession: (token: string, refreshToken: string, user: User) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "radioflow_token";
const REFRESH_KEY = "radioflow_refresh";
const SESSION_EVENT = "radioflow:session";

/** Mismo criterio que el CRA: `localStorage.user` = `{ rol, id }` (`rol` ↔ `role` en la API). */
function persistLegacyUserBlob(u: User | null) {
  try {
    if (!u) {
      localStorage.removeItem("user");
      return;
    }
    localStorage.setItem("user", JSON.stringify({ rol: u.role, id: u.id }));
  } catch {
    /* quota / modo privado */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [refreshToken, setRefreshToken] = useState<string | null>(() => localStorage.getItem(REFRESH_KEY));
  const [user, setUser] = useState<User | null>(null);

  const logout = useCallback(() => {
    const t = token ?? localStorage.getItem(STORAGE_KEY);
    const rt = refreshToken ?? localStorage.getItem(REFRESH_KEY);
    if (t && rt) {
      // best-effort: revoca este refresh token en el backend
      void fetch(apiUrl("/api/auth/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ refreshToken: rt }),
      }).catch(() => {});
    }
    clearStoredAuth();
    setToken(null);
    setRefreshToken(null);
    setUser(null);
  }, [token, refreshToken]);

  const setSession = useCallback((t: string, rt: string, u: User) => {
    persistAuthTokens(t, rt);
    setToken(t);
    setRefreshToken(rt);
    setUser(u);
    persistLegacyUserBlob(u);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!token) {
      setUser(null);
      persistLegacyUserBlob(null);
      return;
    }
    const r = await fetch(apiUrl("/api/users/me"), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      // Intenta refresh si tenemos refreshToken
      const rt = refreshToken ?? localStorage.getItem(REFRESH_KEY);
      if (rt) {
        const rr = await fetch(apiUrl("/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (rr.ok) {
          const data = (await rr.json()) as ApiAuthRefreshResponse;
          setSession(data.token, data.refreshToken, data.user);
          return;
        }
      }
      logout();
      return;
    }
    const text = await r.text();
    try {
      const next = text ? (JSON.parse(text) as User) : null;
      setUser(next);
      persistLegacyUserBlob(next);
    } catch {
      logout();
    }
  }, [token, refreshToken, logout, setSession]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onSession = () => {
      setToken(localStorage.getItem(STORAGE_KEY));
      setRefreshToken(localStorage.getItem(REFRESH_KEY));
    };
    window.addEventListener(SESSION_EVENT, onSession);
    return () => window.removeEventListener(SESSION_EVENT, onSession);
  }, []);

  const value = useMemo(
    () => ({ token, refreshToken, user, setSession, logout, refreshMe }),
    [token, refreshToken, user, setSession, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth dentro de AuthProvider");
  return ctx;
}

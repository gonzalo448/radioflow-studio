import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type User = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
};

type AuthState = {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "radioflow_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [user, setUser] = useState<User | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const setSession = useCallback((t: string, u: User) => {
    localStorage.setItem(STORAGE_KEY, t);
    setToken(t);
    setUser(u);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!token) {
      setUser(null);
      return;
    }
    const r = await fetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      logout();
      return;
    }
    setUser(await r.json());
  }, [token, logout]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const value = useMemo(
    () => ({ token, user, setSession, logout, refreshMe }),
    [token, user, setSession, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth dentro de AuthProvider");
  return ctx;
}

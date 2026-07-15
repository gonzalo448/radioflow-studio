import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ShellLayoutCtx = {
  railsVisible: boolean;
  setRailsVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  toggleRails: () => void;
  toggleFullscreen: () => Promise<void>;
};

const Ctx = createContext<ShellLayoutCtx | null>(null);

const RAILS_LS_KEY = "rf-shell-rails";

function readRailsPreference(): boolean {
  try {
    return window.localStorage.getItem(RAILS_LS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRailsPreference(visible: boolean) {
  try {
    window.localStorage.setItem(RAILS_LS_KEY, visible ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function ShellLayoutProvider({ children }: { children: ReactNode }) {
  /* Por defecto ocultos: Cabina tipo RadioBOSS (sin riel Programador/Cola). Vista → Paneles laterales. */
  const [railsVisible, setRailsVisibleState] = useState(readRailsPreference);

  const setRailsVisible = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    setRailsVisibleState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      writeRailsPreference(next);
      return next;
    });
  }, []);

  const toggleRails = useCallback(() => {
    setRailsVisible((p) => !p);
  }, [setRailsVisible]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      window.alert("Pantalla completa no disponible en este entorno.");
    }
  }, []);

  const value = useMemo(
    () => ({ railsVisible, setRailsVisible, toggleRails, toggleFullscreen }),
    [railsVisible, setRailsVisible, toggleRails, toggleFullscreen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShellLayout(): ShellLayoutCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShellLayout fuera de ShellLayoutProvider");
  return v;
}

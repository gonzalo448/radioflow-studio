import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./NotificationContext.css";

export type NotificationType = "info" | "success" | "warning" | "error";

type NotificationContextValue = {
  showNotification: (msg: string, msgType?: NotificationType) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

const AUTO_HIDE_MS = 3000;

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotification debe usarse dentro de NotificationProvider");
  return ctx;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [type, setType] = useState<NotificationType>("info");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const showNotification = useCallback((msg: string, msgType: NotificationType = "info") => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(msg);
    setType(msgType);
    hideTimer.current = setTimeout(() => {
      setMessage(null);
      hideTimer.current = null;
    }, AUTO_HIDE_MS);
  }, []);

  const value = useMemo(() => ({ showNotification }), [showNotification]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {message ? (
        <div className={`notification ${type}`} role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </NotificationContext.Provider>
  );
}

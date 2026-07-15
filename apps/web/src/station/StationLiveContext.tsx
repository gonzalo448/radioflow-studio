import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "../lib/api";
import { API_ORIGIN_CHANGED_EVENT, stationWsUrl } from "../lib/api-base";
import { STATION_REFRESH_EVENT } from "../lib/local-audio-import";
import type { ApiStationState } from "@radioflow/shared";

export type StationWsStatus = "off" | "connecting" | "live" | "error";

type StationLiveContextValue = {
  state: ApiStationState | null;
  loadError: string | null;
  wsStatus: StationWsStatus;
  refresh: () => Promise<void>;
};

const StationLiveContext = createContext<StationLiveContextValue | null>(null);

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function StationLiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ApiStationState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<StationWsStatus>("off");
  const [transportEpoch, setTransportEpoch] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const activeConnectionIdRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeCurrentSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;

    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;

    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }, []);

  const refresh = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const ac = new AbortController();
    refreshAbortRef.current = ac;

    try {
      const nextState = await apiFetch<ApiStationState>("/api/station", { signal: ac.signal });
      if (ac.signal.aborted) return;
      setState(nextState);
      setLoadError(null);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setLoadError(e instanceof Error ? e.message : "No se pudo cargar la estación");
    } finally {
      if (refreshAbortRef.current === ac) refreshAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    const bump = () => setTransportEpoch((n) => n + 1);
    window.addEventListener(API_ORIGIN_CHANGED_EVENT, bump);
    return () => window.removeEventListener(API_ORIGIN_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    void refresh();
    return () => refreshAbortRef.current?.abort();
  }, [refresh, transportEpoch]);

  useEffect(() => {
    const onStationRefresh = () => void refresh();
    window.addEventListener(STATION_REFRESH_EVENT, onStationRefresh);
    return () => window.removeEventListener(STATION_REFRESH_EVENT, onStationRefresh);
  }, [refresh]);

  useEffect(() => {
    let stopped = false;
    const connectionId = ++activeConnectionIdRef.current;

    const scheduleReconnect = () => {
      if (stopped || activeConnectionIdRef.current !== connectionId) return;
      clearReconnectTimer();

      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;

      const delay = Math.min(RECONNECT_MIN_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (stopped || activeConnectionIdRef.current !== connectionId) return;

      clearReconnectTimer();
      closeCurrentSocket();
      setWsStatus("connecting");

      const ws = new WebSocket(stationWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (stopped || activeConnectionIdRef.current !== connectionId || wsRef.current !== ws) {
          ws.close();
          return;
        }
        reconnectAttemptRef.current = 0;
        setWsStatus("live");
      };

      ws.onmessage = (ev) => {
        if (stopped || activeConnectionIdRef.current !== connectionId || wsRef.current !== ws) {
          return;
        }

        try {
          const data = JSON.parse(ev.data as string) as {
            type?: string;
            payload?: ApiStationState;
          };

          if (data.type === "station" && data.payload) {
            setState(data.payload);
            setLoadError(null);
          }
        } catch {
          // Ignorar payloads inválidos
        }
      };

      ws.onerror = () => {
        if (stopped || activeConnectionIdRef.current !== connectionId || wsRef.current !== ws) {
          return;
        }
        setWsStatus("error");
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        if (stopped || activeConnectionIdRef.current !== connectionId) {
          return;
        }

        setWsStatus("off");
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      stopped = true;
      activeConnectionIdRef.current += 1;
      clearReconnectTimer();
      closeCurrentSocket();
      setWsStatus("off");
    };
  }, [transportEpoch, clearReconnectTimer, closeCurrentSocket]);

  const value: StationLiveContextValue = { state, loadError, wsStatus, refresh };

  return <StationLiveContext.Provider value={value}>{children}</StationLiveContext.Provider>;
}

export function useStationLive(): StationLiveContextValue {
  const ctx = useContext(StationLiveContext);
  if (!ctx) {
    throw new Error("useStationLive debe usarse dentro de StationLiveProvider");
  }
  return ctx;
}

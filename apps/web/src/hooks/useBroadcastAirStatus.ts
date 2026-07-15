import { useCallback, useEffect, useState } from "react";
import type { ApiBroadcastStatus } from "@radioflow/shared";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

/** Poll ligero de broadcast-status para C1 listen-through. */
export function useBroadcastAirStatus(pollMs = 10_000): {
  status: ApiBroadcastStatus | null;
  refresh: () => Promise<void>;
} {
  const { token } = useAuth();
  const [status, setStatus] = useState<ApiBroadcastStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      setStatus(null);
      return;
    }
    try {
      const data = await apiFetch<ApiBroadcastStatus>("/api/streaming/broadcast-status", { token });
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    if (!token) return;
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [token, pollMs, refresh]);

  return { status, refresh };
}

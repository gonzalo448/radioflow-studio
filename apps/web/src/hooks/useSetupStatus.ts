import { useEffect, useState } from "react";
import type { ApiAuthSetupStatus } from "@radioflow/shared";
import { useAuth } from "../auth/AuthContext";
import { apiUrl } from "../lib/api-base";
import { isDesktopProduct } from "../lib/desktop-product";

export function useSetupStatus() {
  const { user } = useAuth();
  const [state, setState] = useState<{ loading: boolean; needsAccount: boolean }>({
    loading: isDesktopProduct(),
    needsAccount: false,
  });

  useEffect(() => {
    if (!isDesktopProduct()) return;

    if (user) {
      setState({ loading: false, needsAccount: false });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void (async () => {
      try {
        const r = await fetch(apiUrl("/api/auth/setup-status"));
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as ApiAuthSetupStatus;
        if (!cancelled) setState({ loading: false, needsAccount: data.needsAccount });
      } catch {
        if (!cancelled) setState({ loading: false, needsAccount: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return state;
}

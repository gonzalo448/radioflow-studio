import { useEffect, useRef } from "react";
import type { ApiSettings, ApiStreamingTarget } from "@radioflow/shared";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import {
  getLocalEncoderStatus,
  hasDesktopEncoderBridge,
  startLocalEncoder,
} from "../lib/broadcast-encoder";

function readAdminMeta() {
  try {
    return {
      icecastAdminUser: localStorage.getItem("radioflow.emitir.icecastAdminUser")?.trim() || "admin",
      icecastAdminPassword: localStorage.getItem("radioflow.emitir.icecastAdminPassword")?.trim() || "",
    };
  } catch {
    return { icecastAdminUser: "admin", icecastAdminPassword: "" };
  }
}

/**
 * En escritorio: si ya hay destino Icecast/AzuraCast guardado, activa emisión
 * y arranca el encoder al iniciar sesión — sin pasar por Emitir ni pulsar botones.
 */
export function useAutoResumeEncoder() {
  const { token, user } = useAuth();
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current) return;
    if (!token || !user) return;
    if (!hasDesktopEncoderBridge()) return;

    const canEdit =
      user.role === "admin" || user.role === "editor" || user.role === "dj";
    if (!canEdit) return;

    let cancelled = false;
    triedRef.current = true;

    void (async () => {
      try {
        const local = await getLocalEncoderStatus();
        if (cancelled || local?.running) return;

        const [settings, targets] = await Promise.all([
          apiFetch<ApiSettings>("/api/settings"),
          apiFetch<ApiStreamingTarget[]>("/api/streaming/targets", { token }),
        ]);
        if (cancelled || targets.length === 0) return;

        let activeId = settings.activeStreamingTargetId;
        const activeExists = activeId ? targets.some((t) => t.id === activeId) : false;
        if (!activeExists) {
          activeId = targets[0]!.id;
          await apiFetch<ApiSettings>("/api/streaming/broadcast-config", {
            method: "PATCH",
            token,
            body: JSON.stringify({
              activeStreamingTargetId: activeId,
              broadcastEnabled: true,
            }),
          });
        } else if (!settings.broadcastEnabled) {
          await apiFetch<ApiSettings>("/api/streaming/broadcast-config", {
            method: "PATCH",
            token,
            body: JSON.stringify({
              activeStreamingTargetId: activeId,
              broadcastEnabled: true,
            }),
          });
        }

        if (cancelled) return;
        const meta = readAdminMeta();
        await startLocalEncoder(token, meta);
      } catch {
        // Silencioso: Emitir sigue disponible para arranque manual.
        triedRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, user]);
}

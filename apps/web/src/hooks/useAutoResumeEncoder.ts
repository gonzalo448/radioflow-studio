import { useEffect, useRef } from "react";
import type { ApiSettings, ApiStreamingTarget } from "@radioflow/shared";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import {
  getLocalEncoderStatus,
  hasDesktopEncoderBridge,
  startLocalEncoder,
} from "../lib/broadcast-encoder";

const WATCHDOG_MS = 12_000;

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
 * Escritorio: arranca el encoder al iniciar sesión y lo vigila.
 * Si se cae (reinicio de API, crash FFmpeg, kill accidental), lo vuelve a levantar.
 */
export function useAutoResumeEncoder() {
  const { token, user } = useAuth();
  const inFlightRef = useRef(false);
  const enabledRef = useRef(false);

  useEffect(() => {
    if (!token || !user) {
      enabledRef.current = false;
      return;
    }
    if (!hasDesktopEncoderBridge()) return;

    const canEdit =
      user.role === "admin" || user.role === "editor" || user.role === "dj";
    if (!canEdit) return;

    enabledRef.current = true;
    let cancelled = false;

    async function ensureRunning(reason: string) {
      if (cancelled || !enabledRef.current || !token) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const local = await getLocalEncoderStatus();
        if (cancelled) return;
        if (local?.running) return;

        const [settings, targets] = await Promise.all([
          apiFetch<ApiSettings>("/api/settings"),
          apiFetch<ApiStreamingTarget[]>("/api/streaming/targets", { token }),
        ]);
        if (cancelled || targets.length === 0) return;

        let activeId = settings.activeStreamingTargetId;
        const activeExists = activeId ? targets.some((t) => t.id === activeId) : false;
        if (!activeExists || !settings.broadcastEnabled) {
          activeId = activeExists ? activeId! : targets[0]!.id;
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
        const res = await startLocalEncoder(token, meta);
        if (!res.running && res.error) {
          console.warn(`[radioflow] encoder ensure (${reason}):`, res.error);
        }
      } catch (e) {
        console.warn(`[radioflow] encoder ensure (${reason}) falló`, e);
      } finally {
        inFlightRef.current = false;
      }
    }

    void ensureRunning("login");
    const id = window.setInterval(() => void ensureRunning("watchdog"), WATCHDOG_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void ensureRunning("visible");
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      inFlightRef.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, user]);
}

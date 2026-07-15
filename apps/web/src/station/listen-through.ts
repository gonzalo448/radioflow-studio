import {
  cabinaMayAutoSkip,
  isListenThroughEligible,
  type ApiBroadcastStatus,
  type ApiEncoderHeartbeatStatus,
} from "@radioflow/shared";
import { detectLocalDevHost, resolveStreamUrl, type LiveStreamEnv } from "../radio/live-stream-urls";

export const CABINA_MONITOR_MODE_KEY = "radioflow.cabina.monitorMode";

export type CabinaMonitorMode = "air" | "local";

export function loadCabinaMonitorMode(): CabinaMonitorMode {
  try {
    const v = localStorage.getItem(CABINA_MONITOR_MODE_KEY);
    if (v === "local" || v === "air") return v;
  } catch {
    /* ignore */
  }
  return "air";
}

export function saveCabinaMonitorMode(mode: CabinaMonitorMode): void {
  try {
    localStorage.setItem(CABINA_MONITOR_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** URL reproducible en el `<audio>` de Cabina (proxies LAN en local si aplica). */
export function resolveCabinaListenUrl(
  publicListenUrl: string,
  env: LiveStreamEnv = { isLocalDev: detectLocalDevHost() },
): string {
  return resolveStreamUrl(publicListenUrl.trim(), env);
}

export function listenThroughFromBroadcastStatus(
  status: Pick<ApiBroadcastStatus, "broadcastEnabled" | "publicListenUrl" | "encoder"> | null | undefined,
  preferLocalMonitor: boolean,
): boolean {
  if (!status) return false;
  return isListenThroughEligible({
    broadcastEnabled: status.broadcastEnabled,
    publicListenUrl: status.publicListenUrl,
    encoder: status.encoder,
    preferLocalMonitor,
  });
}

export { cabinaMayAutoSkip, isListenThroughEligible };
export type { ApiEncoderHeartbeatStatus };

import { apiFetch } from "./api";

/** Informa a la API que el cliente UI reproduce (evita doble avance con headless playout). */
export function sendPlayoutHeartbeat(
  token: string,
  body: { queueItemId?: string; playing?: boolean; currentSec?: number },
): void {
  void apiFetch("/api/station/playout-heartbeat", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  }).catch(() => {});
}

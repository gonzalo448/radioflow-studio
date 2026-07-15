import { prisma } from "../db.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { skipStation } from "../services/station-skip.js";
import { ensureMainStation, MAIN_STATION_ID } from "../services/station-state.js";
import { logAndBroadcastSkip, logAndBroadcastStationUpdate } from "../services/station-events.js";

export type DtmfAction =
  | { type: "skip" }
  | { type: "cart"; slotKey: string; pageKey?: string }
  | { type: "mode"; mode: "AUTO" | "LIVE" | "LIVE_ASSIST" };

export const JINGLE_PAGE_KEYS = ["A", "B", "C"] as const;
export type JinglePageKey = (typeof JINGLE_PAGE_KEYS)[number];

export const DEFAULT_DTMF_ACTIONS: Record<string, DtmfAction> = {
  "5": { type: "skip" },
  "1": { type: "cart", slotKey: "1" },
  "2": { type: "cart", slotKey: "2" },
  "3": { type: "cart", slotKey: "3" },
};

export function parseDtmfActionsJson(raw: string | null | undefined): Record<string, DtmfAction> {
  if (!raw?.trim()) return { ...DEFAULT_DTMF_ACTIONS };
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, DtmfAction> = {};
    for (const [digit, val] of Object.entries(j)) {
      if (!val || typeof val !== "object") continue;
      const o = val as { type?: string; slotKey?: string; pageKey?: string; mode?: string };
      if (o.type === "skip") out[digit] = { type: "skip" };
      else if (o.type === "cart" && o.slotKey) {
        out[digit] = { type: "cart", slotKey: o.slotKey, pageKey: o.pageKey };
      }       else if (o.type === "mode" && (o.mode === "AUTO" || o.mode === "LIVE" || o.mode === "LIVE_ASSIST")) {
        out[digit] = { type: "mode", mode: o.mode };
      }
    }
    return Object.keys(out).length > 0 ? out : { ...DEFAULT_DTMF_ACTIONS };
  } catch {
    return { ...DEFAULT_DTMF_ACTIONS };
  }
}

export function serializeDtmfActions(map: Record<string, DtmfAction>): string {
  return JSON.stringify(map);
}

export async function executeDtmfAction(action: DtmfAction, env?: import("../config.js").Env): Promise<string> {
  if (action.type === "skip") {
    const result = await skipStation({ stationId: MAIN_STATION_ID, env });
    await logAndBroadcastSkip({ userId: null, details: { source: "dtmf", ...result.logDetails } });
    return "skip";
  }
  if (action.type === "mode") {
    await ensureMainStation();
    await prisma.station.update({ where: { id: MAIN_STATION_ID }, data: { mode: action.mode } });
    await logAndBroadcastStationUpdate({ userId: null, details: { mode: action.mode, source: "dtmf" } });
    void broadcastStationState();
    return `mode:${action.mode}`;
  }
  if (action.type === "cart") {
    const pageKey = action.pageKey ?? "A";
    const slot = await prisma.jingleSlot.findUnique({
      where: { stationId_pageKey_slotKey: { stationId: MAIN_STATION_ID, pageKey, slotKey: action.slotKey } },
    });
    if (!slot) throw new Error(`Cart ${pageKey}${action.slotKey} sin asignar`);
    const last = await prisma.playQueueItem.findFirst({
      where: { stationId: MAIN_STATION_ID },
      orderBy: { position: "desc" },
    });
    const position = (last?.position ?? -1) + 1;
    await prisma.playQueueItem.create({
      data: { stationId: MAIN_STATION_ID, assetId: slot.assetId, position, kind: "track" },
    });
    void broadcastStationState();
    return `cart:${pageKey}${action.slotKey}`;
  }
  throw new Error("Acción DTMF no soportada");
}

export async function handleDtmfDigit(digit: string, env?: import("../config.js").Env): Promise<string> {
  const station = await prisma.station.findUniqueOrThrow({ where: { id: MAIN_STATION_ID } });
  const map = parseDtmfActionsJson(station.dtmfActionsJson);
  const action = map[digit];
  if (!action) throw new Error(`DTMF ${digit} sin acción configurada`);
  return executeDtmfAction(action, env);
}

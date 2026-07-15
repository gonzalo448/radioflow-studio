import { writePlayLog } from "../lib/play-log.js";
import { broadcastStationState } from "../realtime/station-hub.js";

type LogInput = {
  userId: string | null;
  assetId?: string | null;
  details?: Record<string, unknown>;
};

export async function logAndBroadcastQueueAppend(input: LogInput): Promise<void> {
  void writePlayLog({
    action: "QUEUE_APPEND",
    userId: input.userId,
    assetId: input.assetId ?? null,
    details: input.details,
  });
  // Await: varios appends en paralelo pueden completar enrich fuera de orden y
  // pisar en el cliente un estado más reciente (p. ej. «A cabina» masivo).
  await broadcastStationState();
}

export async function logAndBroadcastQueueRemove(input: LogInput & { queueItemId?: string }): Promise<void> {
  void writePlayLog({
    action: "QUEUE_REMOVE",
    userId: input.userId,
    assetId: input.assetId ?? null,
    details: {
      ...(input.details ?? {}),
      ...(input.queueItemId ? { queueItemId: input.queueItemId } : {}),
    },
  });
  void broadcastStationState();
}

export async function logAndBroadcastSkip(input: LogInput): Promise<void> {
  void writePlayLog({
    action: "SKIP",
    userId: input.userId,
    assetId: input.assetId ?? null,
    details: input.details,
  });
  void broadcastStationState();
}

export async function logAndBroadcastStationUpdate(input: {
  userId: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  void writePlayLog({
    action: "STATION_UPDATE",
    userId: input.userId,
    details: input.details,
  });
  void broadcastStationState();
}

export async function broadcastOnly(): Promise<void> {
  await broadcastStationState();
}

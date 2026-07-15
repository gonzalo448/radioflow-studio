import WebSocket from "ws";
import { loadEnv } from "../config.js";
import { resolvePublicApiOrigin } from "../lib/api-base-url.js";
import { publishStationBroadcast, setStationWsRelayHandler } from "../lib/redis.js";
import { enrichStationState } from "../services/now-playing.js";
import { exportNowPlayingSidecarIfChanged } from "../services/now-playing-export.js";

const env = loadEnv();
const clients = new Set<WebSocket>();

function cleanupSocket(socket: WebSocket) {
  clients.delete(socket);
}

function publicOrigin(): string {
  return resolvePublicApiOrigin(null, env);
}

function fanOutStationPayload(payload: unknown) {
  const message = JSON.stringify({ type: "station", payload });
  for (const socket of clients) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(message);
      } catch {
        cleanupSocket(socket);
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    } else {
      cleanupSocket(socket);
    }
  }
}

setStationWsRelayHandler((payload) => {
  if (clients.size === 0) return;
  fanOutStationPayload(payload);
});

export function registerStationSocket(socket: WebSocket) {
  clients.add(socket);

  socket.once("close", () => cleanupSocket(socket));
  socket.once("error", () => cleanupSocket(socket));

  void enrichStationState(publicOrigin())
    .then((payload) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "station", payload }));
      } else {
        cleanupSocket(socket);
      }
    })
    .catch(() => {
      cleanupSocket(socket);
      try {
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }
      } catch {
        // ignore
      }
    });
}

export async function broadcastStationState() {
  const payload = await enrichStationState(publicOrigin());
  void exportNowPlayingSidecarIfChanged(publicOrigin(), env).catch((err) => {
    console.warn("[now-playing-export]", err instanceof Error ? err.message : err);
  });

  if (clients.size > 0) {
    fanOutStationPayload(payload);
  }
  void publishStationBroadcast(payload);
}

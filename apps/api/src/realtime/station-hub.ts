import WebSocket from "ws";
import { getStationState } from "../services/station-state.js";

const clients = new Set<WebSocket>();

export function registerStationSocket(socket: WebSocket) {
  clients.add(socket);
  void getStationState().then((payload) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "station", payload }));
    }
  });
  socket.once("close", () => clients.delete(socket));
}

export async function broadcastStationState() {
  if (clients.size === 0) return;
  const payload = await getStationState();
  const message = JSON.stringify({ type: "station", payload });
  for (const socket of clients) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(message);
      } catch {
        clients.delete(socket);
      }
    }
  }
}

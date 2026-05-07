import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "ws";
import { registerStationSocket } from "../realtime/station-hub.js";

export const wsStationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ws/station", { websocket: true }, (socket: WebSocket) => {
    registerStationSocket(socket);
  });
};

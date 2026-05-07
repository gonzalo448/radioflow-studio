import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { loadEnv } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { usersRoutes } from "./routes/users.js";
import { libraryRoutes } from "./routes/library.js";
import { stationRoutes } from "./routes/station.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { playlistRoutes } from "./routes/playlists.js";
import { streamingRoutes } from "./routes/streaming.js";
import { wsStationRoutes } from "./routes/ws-station.js";
import { settingsRoutes } from "./routes/settings.js";
import { semanticRoutes } from "./routes/semantic.js";
import { reportsRoutes } from "./routes/reports.js";
import { runInternalScheduleTick } from "./services/internal-scheduler.js";

const env = loadEnv();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
  credentials: true,
});

await app.register(multipart, {
  limits: { fileSize: 280 * 1024 * 1024 },
});
await app.register(websocket);

await app.register(healthRoutes, { prefix: "/api" });
await app.register(authRoutes, { prefix: "/api", env });
await app.register(usersRoutes, { prefix: "/api", env });
await app.register(settingsRoutes, { prefix: "/api", env });
await app.register(semanticRoutes, { prefix: "/api", env });
await app.register(reportsRoutes, { prefix: "/api", env });
await app.register(libraryRoutes, { prefix: "/api", env });
await app.register(stationRoutes, { prefix: "/api", env });
await app.register(scheduleRoutes, { prefix: "/api", env });
await app.register(playlistRoutes, { prefix: "/api", env });
await app.register(streamingRoutes, { prefix: "/api", env });
await app.register(wsStationRoutes, { prefix: "/api" });

app.get("/", async () => ({
  name: "RadioFlow Studio API",
  docs: "/api/health",
}));

const start = async () => {
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    const poll = env.INTERNAL_SCHEDULE_POLL_MS;
    if (poll > 0) {
      const replace = env.SCHEDULE_REPLACE_QUEUE;
      app.log.warn(
        { pollMs: poll, replaceQueue: replace },
        "Scheduler interno de parrilla activo: evita correr @radioflow/schedule-worker en paralelo (mismos ticks / más carga).",
      );
      const tick = () => {
        void runInternalScheduleTick(replace).catch((err) => app.log.error({ err }, "internal-scheduler"));
      };
      tick();
      setInterval(tick, poll);
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

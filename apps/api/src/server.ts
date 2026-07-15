import Fastify from "fastify";
import crypto from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { loadEnv, type Env } from "./config.js";
import { closeRedis, initRedis } from "./lib/redis.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { sesionesRoutes } from "./routes/sesiones.js";
import { usersRoutes } from "./routes/users.js";
import { libraryRoutes } from "./routes/library.js";
import { stationRoutes } from "./routes/station.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { programacionRoutes } from "./routes/programacion.js";
import { eventosRoutes } from "./routes/eventos.js";
import { playlistRoutes } from "./routes/playlists.js";
import { streamingRoutes } from "./routes/streaming.js";
import { wsStationRoutes } from "./routes/ws-station.js";
import { settingsRoutes } from "./routes/settings.js";
import { semanticRoutes } from "./routes/semantic.js";
import { reportsRoutes } from "./routes/reports.js";
import { opsRoutes } from "./routes/ops.js";
import { schedulerRoutes } from "./routes/scheduler.js";
import { timeAnnounceRoutes } from "./routes/time-announce.js";
import { stationIntroRoutes } from "./routes/station-intro.js";
import { requestsRoutes } from "./routes/requests.js";
import { jinglesRoutes } from "./routes/jingles.js";
import { adsRoutes } from "./routes/ads.js";
import { publicRoutes } from "./routes/public.js";
import { liquidsoapRoutes } from "./routes/liquidsoap.js";
import { ensureBootstrapLocalAdmin } from "./services/bootstrap-local-admin.js";
import { registerOpenApi, registerOpenApiUi } from "./lib/openapi.js";
import { inc, observeRouteRequest, observeRouteResponse } from "./lib/metrics.js";
import { startPeriodicJobs, type PeriodicJobsHandle } from "./lib/periodic-jobs.js";
import { registerGracefulShutdown } from "./lib/graceful-shutdown.js";
import { mapHttpError } from "./lib/http-error-map.js";

export async function createApp(env: Env) {
  await initRedis(env.REDIS_URL);

  const app = Fastify({
    logger: true,
    bodyLimit: env.BODY_LIMIT_BYTES,
    genReqId: () => crypto.randomUUID(),
  });

  app.addHook("onClose", async () => {
    await closeRedis();
  });

  if (env.CORS_ORIGIN) {
    const origins = env.CORS_ORIGIN.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await app.register(cors, {
      origin: origins.length > 0 ? origins : false,
      credentials: env.CORS_CREDENTIALS,
    });
  } else if (env.NODE_ENV === "development") {
    app.log.warn("CORS desactivado (CORS_ORIGIN vacío).");
  }

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapHttpError(error);
    if (mapped) {
      if (mapped.statusCode >= 500) request.log.error(error);
      return reply.status(mapped.statusCode).send({
        error: mapped.error,
        ...(mapped.code ? { code: mapped.code } : {}),
        ...(mapped.details ? { details: mapped.details } : {}),
      });
    }
    request.log.error(error);
    return reply.status(500).send({ error: "Error interno del servidor" });
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
    (request as unknown as { _t0?: number })._t0 = Date.now();
    inc("http.requests.total");
    const route =
      request.routeOptions?.url ??
      (request as unknown as { routerPath?: string }).routerPath ??
      request.url.split("?")[0] ??
      "unknown";
    observeRouteRequest({ method: request.method, route });
  });

  app.addHook("onResponse", async (request, reply) => {
    const code = reply.statusCode;
    if (code >= 200 && code < 300) inc("http.responses.2xx");
    else if (code >= 300 && code < 400) inc("http.responses.3xx");
    else if (code >= 400 && code < 500) inc("http.responses.4xx");
    else if (code >= 500) inc("http.responses.5xx");
    const t0 = (request as unknown as { _t0?: number })._t0 ?? Date.now();
    const durationMs = Date.now() - t0;
    const route =
      request.routeOptions?.url ??
      (request as unknown as { routerPath?: string }).routerPath ??
      request.url.split("?")[0] ??
      "unknown";
    observeRouteResponse({ method: request.method, route, statusCode: code, durationMs });
    request.log.info(
      { reqId: request.id, method: request.method, url: request.url, statusCode: code, userId: request.userId ?? null },
      "request",
    );
  });

  await app.register(multipart, {
    limits: { fileSize: 280 * 1024 * 1024 },
  });
  await app.register(websocket);

  await registerOpenApi(app, env);

  await app.register(healthRoutes, { prefix: "/api", env });
  await app.register(publicRoutes, { prefix: "/api", env });
  await app.register(liquidsoapRoutes, { prefix: "/api", env });
  await app.register(authRoutes, { prefix: "/api", env });
  await app.register(sesionesRoutes, { prefix: "/api", env });
  await app.register(usersRoutes, { prefix: "/api", env });
  await app.register(settingsRoutes, { prefix: "/api", env });
  await app.register(semanticRoutes, { prefix: "/api", env });
  await app.register(reportsRoutes, { prefix: "/api", env });
  await app.register(opsRoutes, { prefix: "/api", env });
  await app.register(schedulerRoutes, { prefix: "/api", env });
  await app.register(timeAnnounceRoutes, { prefix: "/api", env });
  await app.register(stationIntroRoutes, { prefix: "/api", env });
  await app.register(requestsRoutes, { prefix: "/api", env });
  await app.register(jinglesRoutes, { prefix: "/api", env });
  await app.register(adsRoutes, { prefix: "/api", env });
  await app.register(libraryRoutes, { prefix: "/api", env });
  await app.register(stationRoutes, { prefix: "/api", env });
  await app.register(scheduleRoutes, { prefix: "/api", env });
  await app.register(programacionRoutes, { prefix: "/api", env });
  await app.register(eventosRoutes, { prefix: "/api", env });
  await app.register(playlistRoutes, { prefix: "/api", env });
  await app.register(streamingRoutes, { prefix: "/api", env });
  await app.register(wsStationRoutes, { prefix: "/api" });

  await registerOpenApiUi(app, env);

  app.get("/", async () => ({
    name: "RadioFlow Studio API",
    docs: "/api/docs",
    health: "/api/health",
  }));

  return app;
}

const env = loadEnv();
const app = await createApp(env);
let periodicJobs: PeriodicJobsHandle | null = null;

registerGracefulShutdown({
  app,
  env,
  getPeriodicJobs: () => periodicJobs,
});

const start = async () => {
  try {
    if (env.BOOTSTRAP_LOCAL_ADMIN && env.NODE_ENV === "production") {
      app.log.warn(
        {},
        "BOOTSTRAP_LOCAL_ADMIN está activo en producción: use solo en redes de confianza y desactive cuando ya existan usuarios.",
      );
    }
    await ensureBootstrapLocalAdmin(env, app.log);
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    periodicJobs = startPeriodicJobs(app, env);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();

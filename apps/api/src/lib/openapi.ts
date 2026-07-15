import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Env } from "../config.js";

export async function registerOpenApi(app: FastifyInstance, env: Env) {
  if (!env.OPENAPI_ENABLED) return;

  const serverUrl = env.OPENAPI_SERVER_URL ?? `http://127.0.0.1:${env.PORT}`;

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "RadioFlow Studio API",
        description:
          "REST de RadioFlow Studio. La mayoría de rutas requieren `Authorization: Bearer <access_token>`. " +
          "Obtené tokens con `POST /api/auth/login` o `POST /api/auth/register`.",
        version: "0.1.0",
      },
      servers: [{ url: serverUrl, description: "Origen para pruebas desde Swagger UI" }],
      tags: [
        { name: "health", description: "Salud y readiness" },
        { name: "auth", description: "Registro, login y refresh" },
        { name: "users", description: "Usuarios y perfil" },
        { name: "sesiones", description: "Sesiones de refresh (admin)" },
        { name: "eventos", description: "Eventos programados" },
        { name: "playlists", description: "Playlists" },
        { name: "library", description: "Biblioteca de medios" },
        { name: "station", description: "Estación en vivo / cola" },
        { name: "streaming", description: "Destinos de streaming" },
        { name: "settings", description: "Marca y ajustes" },
        { name: "reports", description: "Informes" },
        { name: "ops", description: "Operaciones internas / seguridad" },
        { name: "other", description: "Programación, scheduler, semántica, etc." },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Access token JWT devuelto por login o refresh.",
          },
        },
      },
    },
  });
}

export async function registerOpenApiUi(app: FastifyInstance, env: Env) {
  if (!env.OPENAPI_ENABLED) return;

  await app.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: true,
  });
}

import type { FastifyRequest } from "fastify";
import type { Env } from "../config.js";

/** Origen público de la API (sin `/api` final) para URLs absolutas de carátulas y logo. */
export function resolvePublicApiOrigin(request: FastifyRequest | null, env: Env): string {
  const configured =
    env.PUBLIC_API_BASE_URL?.trim().replace(/\/$/, "") ||
    env.OPENAPI_SERVER_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;

  if (request) {
    const xfProto = request.headers["x-forwarded-proto"];
    const proto =
      (typeof xfProto === "string" ? xfProto.split(",")[0]?.trim() : undefined) ||
      request.protocol ||
      "http";
    const xfHost = request.headers["x-forwarded-host"];
    const host =
      (typeof xfHost === "string" ? xfHost.split(",")[0]?.trim() : undefined) ||
      request.headers.host ||
      `127.0.0.1:${env.PORT}`;
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  return `http://127.0.0.1:${env.PORT}`;
}

export function apiPathUrl(origin: string, apiPath: string): string {
  const base = origin.replace(/\/$/, "");
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return `${base}${path}`;
}

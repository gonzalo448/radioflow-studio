import type { FastifyPluginAsync } from "fastify";
import type { Role } from "@prisma/client";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles } from "../lib/auth.js";

const ADMIN: Role[] = ["admin"];

function toSesionJson(r: {
  id: string;
  userId: string;
  clientIp: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  replacesId: string | null;
  user: { email: string; role: Role };
}) {
  const now = new Date();
  return {
    id: r.id,
    userId: r.userId,
    user_id: r.userId,
    email: r.user.email,
    rol: r.user.role,
    ip: r.clientIp ?? "—",
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    revoked: r.revokedAt !== null,
    activa: r.revokedAt === null && r.expiresAt > now,
    replacedById: r.replacedById,
    replacesId: r.replacesId,
  };
}

/** Listado y revocación de refresh tokens (admin) — equivalente Express `/api/sesiones`. */
const sesionesListSchema = {
  tags: ["sesiones"],
  summary: "Listar sesiones de refresh",
  description: "Query `activas=1` para solo vigentes no revocadas.",
  security: [{ bearerAuth: [] }],
  querystring: {
    type: "object",
    properties: {
      activas: { type: "string", enum: ["1", "0", "true", "false"] },
    },
  },
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
} as const;

const sesionesRevocarSchema = {
  tags: ["sesiones"],
  summary: "Revocar una sesión de refresh",
  security: [{ bearerAuth: [] }],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 1, description: "id del refresh token (cuid)" },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        mensaje: { type: "string" },
        sesion: { type: "object", additionalProperties: true },
      },
    },
    400: { type: "object", properties: { error: { type: "string" } } },
    404: { type: "object", properties: { error: { type: "string" } } },
  },
} as const;

export const sesionesRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/sesiones", { schema: sesionesListSchema }, async (request, reply) => {
    if (!requireRoles(request, reply, ADMIN)) return;
    const q = request.query as { activas?: string };
    const onlyActive = q.activas === "1" || q.activas === "true";

    const rows = await prisma.refreshToken.findMany({
      where: onlyActive
        ? { revokedAt: null, expiresAt: { gt: new Date() } }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        userId: true,
        clientIp: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
        replacesId: true,
        user: { select: { email: true, role: true } },
      },
    });

    return rows.map(toSesionJson);
  });

  app.post<{ Params: { id: string } }>("/sesiones/revocar/:id", { schema: sesionesRevocarSchema }, async (request, reply) => {
    if (!requireRoles(request, reply, ADMIN)) return;
    const { id } = request.params;
    if (!id?.trim()) return reply.status(400).send({ error: "id requerido" });

    const row = await prisma.refreshToken.findUnique({
      where: { id },
      include: { user: { select: { email: true, role: true } } },
    });
    if (!row) return reply.status(404).send({ error: "Sesión no encontrada" });

    const sesion = await prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: row.revokedAt ?? new Date() },
      include: { user: { select: { email: true, role: true } } },
    });

    return {
      mensaje: row.revokedAt ? "Sesión ya estaba revocada" : "Sesión revocada",
      sesion: toSesionJson(sesion),
    };
  });
};

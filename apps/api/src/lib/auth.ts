import type { Role } from "@prisma/client";
import type { Env } from "../config.js";
import {
  roleSatisfies,
  ROLES_LIBRARY_WRITE,
  ROLES_PROGRAMACION_DELETE,
  ROLES_REPORTS_READ,
  ROLES_SCHEDULE_WRITE,
  ROLES_STATION_WRITE,
  ROLES_STREAMING_WRITE,
} from "@radioflow/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    userRole?: Role;
  }
}

export async function optionalAuth(request: FastifyRequest, env: Env): Promise<void> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return;
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    request.userId = payload.sub;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { role: true },
    });
    if (user) request.userRole = user.role;
  } catch {
    request.userId = undefined;
    request.userRole = undefined;
  }
}

export function requireUser(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.userId) {
    void reply.status(401).send({ error: "No autorizado" });
    return false;
  }
  return true;
}

function embeddedFullAccess(): boolean {
  const v = process.env.EMBEDDED_STANDALONE;
  return v === "1" || v === "true";
}

export function requireRoles(
  request: FastifyRequest,
  reply: FastifyReply,
  allowed: Role[],
): boolean {
  if (!requireUser(request, reply)) return false;
  if (embeddedFullAccess()) return true;
  if (!roleSatisfies(request.userRole, allowed)) {
    void reply.status(403).send({ error: "Permisos insuficientes" });
    return false;
  }
  return true;
}

/**
 * Equivalente a Express `checkRole(roles)` con `req.user` ya cargado:
 * - sin usuario → 401 `{ error: "No autenticado" }`
 * - rol fuera de la lista → 403 `{ error: "Acceso denegado" }` (tu `usuario.rol` ↔ `request.userRole`).
 *
 * Usar en `preHandler` **después** de `optionalAuth` para tener `userId` y `userRole`.
 *
 * @example
 * ```ts
 * preHandler: async (req, reply) => {
 *   await optionalAuth(req, env);
 *   await checkRole(["admin", "editor"])(req, reply);
 * },
 * ```
 */
export function checkRole(allowed: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.userId) {
      void reply.status(401).send({ error: "No autenticado" });
      return;
    }
    if (embeddedFullAccess()) return;
    if (!roleSatisfies(request.userRole, allowed)) {
      void reply.status(403).send({ error: "Acceso denegado" });
      return;
    }
  };
}

export {
  ROLES_STATION_WRITE,
  ROLES_SCHEDULE_WRITE,
  ROLES_PROGRAMACION_DELETE,
  ROLES_STREAMING_WRITE,
  ROLES_LIBRARY_WRITE,
  ROLES_REPORTS_READ,
} from "@radioflow/shared";
export { roleSatisfies } from "@radioflow/shared";

import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import type { Env } from "../config.js";
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

export function requireRoles(
  request: FastifyRequest,
  reply: FastifyReply,
  allowed: Role[],
): boolean {
  if (!requireUser(request, reply)) return false;
  if (!request.userRole || !allowed.includes(request.userRole)) {
    void reply.status(403).send({ error: "Permisos insuficientes" });
    return false;
  }
  return true;
}

export const ROLES_STATION_WRITE: Role[] = ["admin", "editor", "dj"];
export const ROLES_SCHEDULE_WRITE: Role[] = ["admin", "editor"];
export const ROLES_STREAMING_WRITE: Role[] = ["admin", "editor"];

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../db.js";
import type { Env } from "../config.js";
import { optionalAuth } from "../lib/auth.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!request.userId) {
    void reply.status(401).send({ error: "No autorizado" });
    return false;
  }
  const me = await prisma.user.findUnique({ where: { id: request.userId }, select: { role: true } });
  if (!me || me.role !== "admin") {
    void reply.status(403).send({ error: "Prohibido" });
    return false;
  }
  return true;
}

function toUsuarioRow(u: {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  createdAt: Date;
}) {
  return {
    id: u.id,
    nombre: u.displayName ?? "",
    email: u.email,
    rol: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}

const roleSchema = z.nativeEnum(Role);

/** Equivalente al CRA: nombre, email, rol y password obligatorios (contraseña mín. 8 para alinear con el front). */
const createUsuarioBody = z.object({
  nombre: z.string().trim().min(1),
  email: z.string().email(),
  rol: roleSchema,
  password: z.string().min(8),
});

/** CRA: siempre `nombre`, `email`, `rol`; `password` opcional (mín. 8) como extensión del front. */
const updateUsuarioBody = z.object({
  nombre: z.string().trim().min(1),
  email: z.string().email(),
  rol: roleSchema,
  password: z.string().min(8).optional(),
});

const changeMyPasswordBody = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const usersRoutes: FastifyPluginAsync<{ env: Env }> = async (app, _opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, _opts.env));

  app.get("/users/me", async (request, reply) => {
    if (!request.userId) return reply.status(401).send({ error: "No autorizado" });
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
    });
    if (!user) return reply.status(404).send({ error: "Usuario no encontrado" });
    return user;
  });

  /** Listado CRA (`nombre` / `rol`) — mismo origen que `GET /users`. */
  app.get("/usuarios", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const rows = await prisma.user.findMany({
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(toUsuarioRow);
  });

  app.post("/usuarios", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = createUsuarioBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Datos incompletos" });
    }
    const body = parsed.data;
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) return reply.status(409).send({ error: "El correo ya está registrado" });
    const passwordHash = await hashPassword(body.password);
    try {
      const u = await prisma.user.create({
        data: {
          email: body.email,
          displayName: body.nombre.trim(),
          role: body.rol,
          passwordHash,
        },
        select: { id: true, email: true, displayName: true, role: true, createdAt: true },
      });
      return reply.status(201).send(toUsuarioRow(u));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return reply.status(409).send({ error: "El correo ya está registrado" });
      }
      request.log.error({ err: e }, "POST /usuarios");
      return reply.status(503).send({ error: "Error al crear usuario" });
    }
  });

  app.put("/usuarios/me/password", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ error: "No autorizado" });
    }
    const parsed = changeMyPasswordBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Datos incompletos" });
    }
    const { oldPassword, newPassword } = parsed.data;
    try {
      const user = await prisma.user.findUnique({
        where: { id: request.userId },
        select: { id: true, passwordHash: true },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }
      const valid = await verifyPassword(oldPassword, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ error: "Contraseña actual incorrecta" });
      }
      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      return { mensaje: "Contraseña actualizada correctamente" };
    } catch (e) {
      request.log.error({ err: e }, "PUT /usuarios/me/password");
      return reply.status(503).send({ error: "Error al actualizar contraseña" });
    }
  });

  app.put<{ Params: { id: string } }>("/usuarios/:id/password", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const password = (request.body as { password?: unknown })?.password;
    if (typeof password !== "string" || password.length === 0) {
      return reply.status(400).send({ error: "Contraseña requerida" });
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: "La contraseña debe tener al menos 8 caracteres" });
    }
    const passwordHash = await hashPassword(password);
    try {
      const u = await prisma.user.update({
        where: { id },
        data: { passwordHash },
        select: { id: true, email: true, displayName: true, role: true, createdAt: true },
      });
      return { mensaje: "Contraseña actualizada", usuario: toUsuarioRow(u) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }
      request.log.error({ err: e }, "PUT /usuarios/:id/password");
      return reply.status(503).send({ error: "Error al actualizar contraseña" });
    }
  });

  app.put<{ Params: { id: string } }>("/usuarios/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = updateUsuarioBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Datos incompletos" });
    }
    const body = parsed.data;
    const clash = await prisma.user.findFirst({ where: { email: body.email, NOT: { id } } });
    if (clash) return reply.status(409).send({ error: "El correo ya está en uso" });

    const data: { displayName: string; email: string; role: Role; passwordHash?: string } = {
      displayName: body.nombre.trim(),
      email: body.email,
      role: body.rol,
    };
    if (body.password) data.passwordHash = await hashPassword(body.password);

    try {
      const u = await prisma.user.update({
        where: { id },
        data,
        select: { id: true, email: true, displayName: true, role: true, createdAt: true },
      });
      return toUsuarioRow(u);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === "P2025") {
          return reply.status(404).send({ error: "Usuario no encontrado" });
        }
        if (e.code === "P2002") {
          return reply.status(409).send({ error: "El correo ya está en uso" });
        }
      }
      request.log.error({ err: e }, "PUT /usuarios/:id");
      return reply.status(503).send({ error: "Error al editar usuario" });
    }
  });

  app.delete<{ Params: { id: string } }>("/usuarios/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    if (id === request.userId) {
      return reply.status(400).send({ error: "No puede eliminar su propia cuenta" });
    }
    try {
      await prisma.user.delete({ where: { id } });
      return { mensaje: "Usuario eliminado" };
    } catch {
      return reply.status(404).send({ error: "Usuario no encontrado" });
    }
  });

  /** Listado JSON interno (admin) — mismo dataset que `GET /usuarios` sin mapeo CRA. */
  app.get("/users", async (request, reply) => {
    if (!request.userId) return reply.status(401).send({ error: "No autorizado" });
    const me = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!me || me.role !== "admin") return reply.status(403).send({ error: "Prohibido" });
    return prisma.user.findMany({
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
};

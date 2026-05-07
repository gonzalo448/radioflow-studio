import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import jwt from "jsonwebtoken";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";

const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().optional(),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const authRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.post("/auth/register", async (request, reply) => {
    const body = registerBody.parse(request.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) return reply.status(409).send({ error: "El correo ya está registrado" });
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        displayName: body.displayName,
        role: "viewer",
      },
      select: { id: true, email: true, displayName: true, role: true },
    });
    const token = jwt.sign({ sub: user.id }, opts.env.JWT_SECRET, { expiresIn: "7d" });
    return { user, token };
  });

  app.post("/auth/login", async (request, reply) => {
    const body = loginBody.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.status(401).send({ error: "Credenciales inválidas" });
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return reply.status(401).send({ error: "Credenciales inválidas" });
    const token = jwt.sign({ sub: user.id }, opts.env.JWT_SECRET, { expiresIn: "7d" });
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      token,
    };
  });
};

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  ApiAuthLoginBody,
  ApiAuthLoginResponse,
  ApiAuthOk,
  ApiAuthLogoutBody,
  ApiAuthRefreshBody,
  ApiAuthRefreshResponse,
  ApiAuthRegisterBody,
  ApiAuthRegisterResponse,
  ApiAuthSetupStatus,
  ApiError,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { allowAuthAttempt, applyAuthRateLimitHeaders, getClientIp } from "../lib/rate-limit.js";
import { hashRefreshToken, newRefreshToken, parseTtlToMs, signAccessToken } from "../lib/tokens.js";
import { optionalAuth, requireUser } from "../lib/auth.js";
import { recordRefreshReuseDetection } from "../lib/auth-security-metrics.js";
import { revokeRefreshTokenDescendants } from "../lib/refresh-chain.js";
import { inc } from "../lib/metrics.js";

const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().optional(),
  stationName: z.string().min(1).max(120).optional(),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshBody = z.object({
  refreshToken: z.string().min(20),
});

const authRegisterSchema = {
  tags: ["auth"],
  summary: "Registro de usuario",
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 8 },
      displayName: { type: "string" },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        token: { type: "string" },
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        id: { type: "string" },
        rol: { type: "string" },
        user: { type: "object", additionalProperties: true },
      },
    },
    409: { type: "object", properties: { error: { type: "string" } } },
    429: { type: "object", properties: { error: { type: "string" } } },
  },
} as const;

const authLoginSchema = {
  tags: ["auth"],
  summary: "Iniciar sesión",
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string" },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        token: { type: "string" },
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        id: { type: "string" },
        rol: { type: "string" },
        user: { type: "object", additionalProperties: true },
      },
    },
    401: { type: "object", properties: { error: { type: "string" } } },
    429: { type: "object", properties: { error: { type: "string" } } },
  },
} as const;

const authRefreshSchema = {
  tags: ["auth"],
  summary: "Renovar access token (rota refresh)",
  body: {
    type: "object",
    required: ["refreshToken"],
    properties: {
      refreshToken: { type: "string", minLength: 20 },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        token: { type: "string" },
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        user: { type: "object", additionalProperties: true },
      },
    },
    401: { type: "object", properties: { error: { type: "string" } } },
  },
} as const;

const authLogoutSchema = {
  tags: ["auth"],
  summary: "Cerrar sesión (revoca refresh indicado)",
  security: [{ bearerAuth: [] }],
  body: {
    type: "object",
    required: ["refreshToken"],
    properties: {
      refreshToken: { type: "string", minLength: 20 },
    },
  },
  response: {
    200: { type: "object", properties: { ok: { type: "boolean" } } },
    400: { type: "object", properties: { error: { type: "string" } } },
    404: { type: "object", properties: { error: { type: "string" } } },
  },
} as const;

const authLogoutAllSchema = {
  tags: ["auth"],
  summary: "Revocar todos los refresh del usuario autenticado",
  security: [{ bearerAuth: [] }],
  response: {
    200: { type: "object", properties: { ok: { type: "boolean" } } },
  },
} as const;

function clipClientIp(request: FastifyRequest): string | null {
  const raw = getClientIp(request).trim();
  if (!raw || raw === "unknown") return null;
  return raw.slice(0, 100);
}

export const authRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.get<{ Reply: ApiAuthSetupStatus }>("/auth/setup-status", async (_request, reply) => {
    const count = await prisma.user.count();
    return reply.send({ needsAccount: count === 0 });
  });

  /** Rotación de refresh opaco + nuevo JWT (compartido por `/auth/refresh` y `/refresh`). */
  async function rotateRefreshSession(
    env: Env,
    refreshTokenPlain: string,
    log: FastifyRequest["log"],
    clientIp: string | null,
  ): Promise<{ ok: true; session: ApiAuthRefreshResponse } | { ok: false; error: string }> {
    const tokenHash = hashRefreshToken(refreshTokenPlain);

    void prisma.refreshToken
      .deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }] } })
      .catch(() => {});

    const rt = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, displayName: true, role: true } } },
    });
    if (!rt) {
      inc("auth.refresh.fail");
      log.info({ route: "auth/refresh" }, "auth: refresh fail");
      return { ok: false, error: "Refresh token inválido" };
    }
    if (rt.revokedAt) {
      if (rt.replacedById) {
        log.warn({ userId: rt.userId }, "refresh token reutilizado (posible robo); revocando todos");
        recordRefreshReuseDetection();
        await revokeRefreshTokenDescendants(rt.id);
        await prisma.refreshToken.updateMany({
          where: { userId: rt.userId, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { revokedAt: new Date() },
        });
      }
      inc("auth.refresh.fail");
      return { ok: false, error: "Refresh token inválido" };
    }
    if (rt.expiresAt <= new Date()) {
      inc("auth.refresh.fail");
      log.info({ route: "auth/refresh", userId: rt.userId }, "auth: refresh expired");
      return { ok: false, error: "Refresh token inválido" };
    }

    const newRt = newRefreshToken();
    const expiresAt = new Date(Date.now() + parseTtlToMs(env.JWT_REFRESH_TTL));
    const created = await prisma.refreshToken.create({
      data: {
        userId: rt.userId,
        tokenHash: hashRefreshToken(newRt),
        expiresAt,
        replacesId: rt.id,
        clientIp,
      },
      select: { id: true },
    });
    await prisma.refreshToken.update({
      where: { id: rt.id },
      data: { revokedAt: new Date(), replacedById: created.id },
    });

    const token = signAccessToken(env, rt.userId, rt.user.role);
    inc("auth.refresh.ok");
    log.info({ route: "auth/refresh", userId: rt.userId }, "auth: refresh ok");
    return {
      ok: true,
      session: {
        token,
        accessToken: token,
        refreshToken: newRt,
        user: rt.user,
        id: rt.user.id,
        rol: rt.user.role,
      },
    };
  }

  app.post<{ Body: ApiAuthRegisterBody; Reply: ApiAuthRegisterResponse | ApiError }>(
    "/auth/register",
    { schema: authRegisterSchema },
    async (request, reply) => {
    const ip = getClientIp(request);
    const rl = await allowAuthAttempt(ip, opts.env, "register");
    applyAuthRateLimitHeaders(reply, opts.env, rl);
    if (!rl.allowed) {
      if (rl.retryAfterSec != null) reply.header("Retry-After", String(rl.retryAfterSec));
      request.log.warn({ route: "auth/register" }, "auth: register rate-limited");
      return reply.status(429).send({ error: "Demasiados intentos. Prueba más tarde." });
    }
    const body = registerBody.parse(request.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) {
      inc("auth.register.conflict");
      request.log.info({ route: "auth/register" }, "auth: register conflict");
      return reply.status(409).send({ error: "El correo ya está registrado" });
    }
    const userCount = await prisma.user.count();
    if (opts.env.EMBEDDED_STANDALONE && userCount > 0) {
      return reply.status(403).send({
        error: "Esta copia ya está configurada. Inicia sesión con su usuario.",
      });
    }
    const passwordHash = await hashPassword(body.password);
    const role = opts.env.EMBEDDED_STANDALONE
      ? "editor"
      : userCount === 0 || opts.env.BOOTSTRAP_LOCAL_ADMIN
        ? "admin"
        : "viewer";
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        displayName: body.displayName,
        role,
      },
      select: { id: true, email: true, displayName: true, role: true },
    });
    const stationName = body.stationName?.trim();
    if (stationName) {
      await prisma.appSettings.upsert({
        where: { id: "global" },
        create: { id: "global", stationName },
        update: { stationName },
      });
    }
    const token = signAccessToken(opts.env, user.id, user.role);
    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + parseTtlToMs(opts.env.JWT_REFRESH_TTL));
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt,
        clientIp: clipClientIp(request),
      },
    });
    inc("auth.register.ok");
    request.log.info({ route: "auth/register", userId: user.id }, "auth: register ok");
    return {
      user,
      token,
      accessToken: token,
      refreshToken,
      id: user.id,
      rol: user.role,
    };
    },
  );

  const loginHandler = async (
    request: FastifyRequest<{ Body: ApiAuthLoginBody }>,
    reply: FastifyReply,
  ): Promise<ApiAuthLoginResponse | void> => {
    const ip = getClientIp(request);
    const rl = await allowAuthAttempt(ip, opts.env, "login");
    applyAuthRateLimitHeaders(reply, opts.env, rl);
    if (!rl.allowed) {
      if (rl.retryAfterSec != null) reply.header("Retry-After", String(rl.retryAfterSec));
      request.log.warn({ route: "auth/login" }, "auth: login rate-limited");
      return reply.status(429).send({ error: "Demasiados intentos. Prueba más tarde." });
    }
    const body = loginBody.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      inc("auth.login.fail");
      request.log.info({ route: "auth/login" }, "auth: login fail");
      return reply.status(401).send({ error: "Usuario no encontrado" });
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      inc("auth.login.fail");
      request.log.info({ route: "auth/login", userId: user.id }, "auth: login fail");
      return reply.status(401).send({ error: "Contraseña incorrecta" });
    }
    const token = signAccessToken(opts.env, user.id, user.role);
    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + parseTtlToMs(opts.env.JWT_REFRESH_TTL));
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt,
        clientIp: clipClientIp(request),
      },
    });
    inc("auth.login.ok");
    request.log.info({ route: "auth/login", userId: user.id }, "auth: login ok");
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      token,
      accessToken: token,
      refreshToken,
      id: user.id,
      rol: user.role,
    };
  };

  app.post<{ Body: ApiAuthLoginBody; Reply: ApiAuthLoginResponse | ApiError }>(
    "/auth/login",
    { schema: authLoginSchema },
    loginHandler,
  );

  /** Alias compatible con clientes CRA que usan `POST /api/login`. */
  app.post<{ Body: ApiAuthLoginBody; Reply: ApiAuthLoginResponse | ApiError }>(
    "/login",
    {
      schema: {
        ...authLoginSchema,
        summary: "Iniciar sesión (alias CRA)",
        description: "Equivalente a `POST /api/auth/login`.",
      },
    },
    loginHandler,
  );

  app.post<{ Body: ApiAuthRefreshBody; Reply: ApiAuthRefreshResponse | ApiError }>(
    "/auth/refresh",
    { schema: authRefreshSchema },
    async (request, reply) => {
      const body = refreshBody.parse(request.body);
      const out = await rotateRefreshSession(opts.env, body.refreshToken, request.log, clipClientIp(request));
      if (!out.ok) return reply.status(401).send({ error: out.error });
      return out.session;
    },
  );

  /**
   * Alias tipo CRA: `POST /api/refresh` con `{ refreshToken }`.
   * Errores alineados a mensajes típicos; en fallo de validación devuelve 403 `Token inválido`.
   * Incluye `refreshToken` nuevo en la respuesta porque aquí el refresh se **rota** (el anterior queda revocado).
   */
  app.post("/refresh", async (request, reply) => {
    const body = request.body as { refreshToken?: unknown; token?: unknown } | undefined;
    const raw =
      typeof body?.refreshToken === "string"
        ? body.refreshToken
        : typeof body?.token === "string"
          ? body.token
          : undefined;
    if (typeof raw !== "string" || raw.length < 20) {
      return reply.status(401).send({ error: "Token requerido" });
    }
    const out = await rotateRefreshSession(opts.env, raw, request.log, clipClientIp(request));
    if (!out.ok) return reply.status(403).send({ error: "Token inválido" });
    return reply.send({
      accessToken: out.session.token,
      refreshToken: out.session.refreshToken,
    });
  });

  app.post<{ Body: ApiAuthLogoutBody; Reply: ApiAuthOk | ApiError }>(
    "/auth/logout",
    { schema: authLogoutSchema },
    async (request, reply) => {
    await optionalAuth(request, opts.env);
    if (!requireUser(request, reply)) return;
    const body = refreshBody.safeParse(request.body);
    if (!body.success) {
      inc("auth.logout.fail");
      request.log.info({ route: "auth/logout", userId: request.userId }, "auth: logout fail");
      return reply.status(400).send({ error: "refreshToken requerido" });
    }
    const tokenHash = hashRefreshToken(body.data.refreshToken);
    const rt = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!rt || rt.userId !== request.userId) {
      inc("auth.logout.fail");
      request.log.info({ route: "auth/logout", userId: request.userId }, "auth: logout fail");
      return reply.status(404).send({ error: "No encontrado" });
    }
    await prisma.refreshToken.update({ where: { id: rt.id }, data: { revokedAt: new Date() } });
    inc("auth.logout.ok");
    request.log.info({ route: "auth/logout", userId: request.userId }, "auth: logout ok");
    return { ok: true };
    },
  );

  /**
   * Alias CRA: `POST /api/logout` con `{ refreshToken }` o `{ token }` — sin Bearer.
   * Revoca la sesión de refresh si el token existe; siempre responde éxito como en `UPDATE …` sin comprobar filas.
   */
  app.post("/logout", async (request, reply) => {
    const body = request.body as { refreshToken?: unknown; token?: unknown } | undefined;
    const raw =
      typeof body?.refreshToken === "string"
        ? body.refreshToken
        : typeof body?.token === "string"
          ? body.token
          : undefined;
    if (typeof raw === "string" && raw.length >= 20) {
      const tokenHash = hashRefreshToken(raw);
      const rt = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      if (rt && rt.revokedAt === null) {
        await prisma.refreshToken.update({ where: { id: rt.id }, data: { revokedAt: new Date() } });
      }
    }
    request.log.info({ route: "auth/logout-cra" }, "auth: logout CRA alias");
    return reply.send({ mensaje: "Sesión cerrada" });
  });

  app.post<{ Reply: ApiAuthOk | ApiError }>("/auth/logout-all", { schema: authLogoutAllSchema }, async (request, reply) => {
    await optionalAuth(request, opts.env);
    if (!requireUser(request, reply)) return;
    await prisma.refreshToken.updateMany({
      where: { userId: request.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    inc("auth.logoutAll.ok");
    request.log.info({ route: "auth/logout-all", userId: request.userId }, "auth: logout-all ok");
    return { ok: true };
  });
};

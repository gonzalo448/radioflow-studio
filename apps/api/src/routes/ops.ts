import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  ApiError,
  ApiOpsAuthCleanupRefreshTokens,
  ApiOpsAuthRefreshChains,
  ApiOpsAuthRevokeRefreshChain,
  ApiOpsAuthRevokeRefreshToken,
  ApiOpsAuthUserSessions,
  ApiOpsMetrics,
  ApiOpsRateLimit,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { optionalAuth, requireRoles } from "../lib/auth.js";
import { getAuthRateLimitStats } from "../lib/rate-limit.js";
import { readAuthRateLimitMetrics } from "../lib/rate-limit-metrics.js";
import { guardOpsRequest } from "../lib/ops-guard.js";
import { getLocalRefreshReuseDetections, readRefreshReuseDetections } from "../lib/auth-security-metrics.js";
import { computeRefreshChainAgg } from "../lib/refresh-chain-metrics.js";
import { revokeRefreshTokenChain } from "../lib/refresh-chain.js";
import { getLocalOpsRevocations, readOpsRevocations, recordOpsRevocation } from "../lib/ops-audit-metrics.js";
import { prisma } from "../db.js";
import { cleanupRefreshTokens } from "../lib/refresh-token-cleanup.js";
import { snapshotCounters, snapshotPrometheusText, snapshotRoutes } from "../lib/metrics.js";

export const opsRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiOpsMetrics }>("/ops/metrics", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin"])) return;
    if (!guardOpsRequest(request, reply)) return;
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      counters: snapshotCounters(),
      routes: snapshotRoutes(),
    };
  });

  app.get("/ops/metrics/prometheus", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin"])) return;
    if (!guardOpsRequest(request, reply)) return;
    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return reply.send(snapshotPrometheusText());
  });

  app.get<{ Reply: ApiOpsRateLimit }>("/ops/rate-limit", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin"])) return;
    if (!guardOpsRequest(request, reply)) return;
    const q = z
      .object({
        window: z.coerce.number().int().min(1).max(60).optional(),
      })
      .safeParse(request.query);
    const windowMinutes = q.success ? q.data.window : undefined;
    const local = getAuthRateLimitStats();
    const global = await readAuthRateLimitMetrics(windowMinutes);
    const refreshReuseGlobal = await readRefreshReuseDetections(windowMinutes ?? 60);
    const opsRevocationsGlobal = await readOpsRevocations(windowMinutes ?? 60);

    const combined =
      global && {
        windowMinutes: global.windowMinutes,
        totals: {
          login: {
            allowed: global.totals.login.redis.allowed + global.totals.login.memory.allowed,
            blocked: global.totals.login.redis.blocked + global.totals.login.memory.blocked,
          },
          register: {
            allowed: global.totals.register.redis.allowed + global.totals.register.memory.allowed,
            blocked: global.totals.register.redis.blocked + global.totals.register.memory.blocked,
          },
          all: {
            allowed:
              global.totals.login.redis.allowed +
              global.totals.login.memory.allowed +
              global.totals.register.redis.allowed +
              global.totals.register.memory.allowed,
            blocked:
              global.totals.login.redis.blocked +
              global.totals.login.memory.blocked +
              global.totals.register.redis.blocked +
              global.totals.register.memory.blocked,
          },
        },
      };

    request.log.info(
      { userId: request.userId, windowMinutes: windowMinutes ?? null, hasRedis: global !== null },
      "ops: rate-limit metrics read",
    );
    return {
      local,
      global,
      combined,
      requestedWindowMinutes: windowMinutes ?? null,
      refreshReuseDetections: {
        local: getLocalRefreshReuseDetections(),
        global: refreshReuseGlobal,
      },
      opsRevocations: {
        local: getLocalOpsRevocations(),
        global: opsRevocationsGlobal,
      },
    };
  });

  app.get<{ Reply: ApiOpsAuthRefreshChains }>("/ops/auth/refresh-chains", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin"])) return;
    if (!guardOpsRequest(request, reply)) return;
    const q = z
      .object({
        window: z.coerce.number().int().min(1).max(60).optional(),
      })
      .safeParse(request.query);
    const windowMinutes = q.success ? q.data.window : undefined;
    const agg = await computeRefreshChainAgg();
    request.log.info({ userId: request.userId, windowMinutes: windowMinutes ?? null }, "ops: refresh chain agg");
    return { windowMinutes: windowMinutes ?? null, agg };
  });

  app.post<{ Reply: ApiOpsAuthRevokeRefreshChain }>("/ops/auth/revoke-refresh-chain", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin"])) return;
    if (!guardOpsRequest(request, reply)) return;
    const body = z
      .object({
        refreshTokenId: z.string().min(1),
      })
      .parse(request.body);
    const { rootId, revoked } = await revokeRefreshTokenChain(body.refreshTokenId);
    recordOpsRevocation();
    request.log.warn({ userId: request.userId, rootId, revoked }, "ops: refresh chain revoked");
    return { ok: true, rootId, revoked };
  });

  app.get<{ Reply: ApiOpsAuthUserSessions | ApiError }>("/ops/auth/user-sessions", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin"])) return;
    if (!guardOpsRequest(request, reply)) return;

    const q = z
      .object({
        userId: z.string().min(1).optional(),
        email: z.string().email().optional(),
      })
      .refine((v) => Boolean(v.userId || v.email), { message: "userId o email requerido" })
      .parse(request.query);

    const user = await prisma.user.findFirst({
      where: q.userId ? { id: q.userId } : { email: q.email },
      select: { id: true, email: true, displayName: true, role: true },
    });
    if (!user) return reply.status(404).send({ error: "Usuario no encontrado" });

    const rows = await prisma.refreshToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        replacesId: true,
        replacedById: true,
      },
      take: 200,
    });

    return {
      user,
      sessions: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
        replacesId: r.replacesId ?? null,
        replacedById: r.replacedById ?? null,
      })),
    };
  });

  app.post<{ Reply: ApiOpsAuthRevokeRefreshToken | ApiError }>(
    "/ops/auth/revoke-refresh-token",
    async (request, reply) => {
      if (!requireRoles(request, reply, ["admin"])) return;
      if (!guardOpsRequest(request, reply)) return;

      const body = z
        .object({
          refreshTokenId: z.string().min(1),
        })
        .parse(request.body);

      const rt = await prisma.refreshToken.findUnique({
        where: { id: body.refreshTokenId },
        select: { id: true, revokedAt: true },
      });
      if (!rt) return reply.status(404).send({ error: "Refresh token no encontrado" });
      if (rt.revokedAt) {
        return { ok: true, refreshTokenId: rt.id, revokedAt: rt.revokedAt.toISOString() };
      }
      const now = new Date();
      await prisma.refreshToken.update({ where: { id: rt.id }, data: { revokedAt: now } });
      recordOpsRevocation();
      request.log.warn({ userId: request.userId, refreshTokenId: rt.id }, "ops: refresh token revoked");
      return { ok: true, refreshTokenId: rt.id, revokedAt: now.toISOString() };
    },
  );

  app.post<{ Reply: ApiOpsAuthCleanupRefreshTokens | ApiError }>(
    "/ops/auth/cleanup-refresh-tokens",
    async (request, reply) => {
      if (!requireRoles(request, reply, ["admin"])) return;
      if (!guardOpsRequest(request, reply)) return;

      const body = z
        .object({
          revokedRetentionDays: z.coerce.number().int().min(0).max(365).optional(),
          expiredRetentionDays: z.coerce.number().int().min(0).max(365).optional(),
          maxDelete: z.coerce.number().int().min(1).max(10_000).optional(),
        })
        .safeParse(request.body ?? {});

      if (!body.success) return reply.status(400).send({ error: "Body inválido" });

      const deleted = await cleanupRefreshTokens({
        revokedRetentionDays: body.data.revokedRetentionDays ?? 14,
        expiredRetentionDays: body.data.expiredRetentionDays ?? 3,
        maxDelete: body.data.maxDelete ?? 2000,
      });

      request.log.info({ userId: request.userId, deleted }, "ops: refresh token cleanup");
      return { ok: true, deleted };
    },
  );
};


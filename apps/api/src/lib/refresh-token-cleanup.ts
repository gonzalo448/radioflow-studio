import { prisma } from "../db.js";

export type RefreshTokenCleanupOptions = {
  /** Retención (días) para tokens revocados antes de borrar. */
  revokedRetentionDays: number;
  /** Retención (días) para tokens expirados antes de borrar. */
  expiredRetentionDays: number;
  /** Límite máximo de filas a borrar por corrida. */
  maxDelete: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function cleanupRefreshTokens(opts: RefreshTokenCleanupOptions): Promise<number> {
  const now = Date.now();
  const revokedCutoff = new Date(now - opts.revokedRetentionDays * DAY_MS);
  const expiredCutoff = new Date(now - opts.expiredRetentionDays * DAY_MS);

  const candidates = await prisma.refreshToken.findMany({
    where: {
      OR: [
        { revokedAt: { not: null, lt: revokedCutoff } },
        { expiresAt: { lt: expiredCutoff } },
      ],
    },
    select: { id: true },
    take: Math.max(0, Math.min(opts.maxDelete, 10_000)),
  });

  if (candidates.length === 0) return 0;

  const res = await prisma.refreshToken.deleteMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });
  return res.count ?? 0;
}


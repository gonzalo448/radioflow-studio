import { prisma } from "../db.js";

async function findRootRefreshTokenId(startId: string): Promise<string> {
  const seen = new Set<string>();
  let currentId: string | null = startId;
  for (let i = 0; i < 200 && currentId; i++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const rt: { id: string; replacesId: string | null } | null = await prisma.refreshToken.findUnique({
      where: { id: currentId },
      select: { id: true, replacesId: true },
    });
    if (!rt) break;
    if (!rt.replacesId) return rt.id;
    currentId = rt.replacesId;
  }
  return startId;
}

/** Revoca el token inicial y todos sus descendientes por `replacedById` (best-effort). */
export async function revokeRefreshTokenDescendants(startId: string): Promise<number> {
  const now = new Date();
  const seen = new Set<string>();
  let currentId: string | null = startId;
  let revoked = 0;
  // Límite defensivo ante ciclos/corrupción
  for (let i = 0; i < 200 && currentId; i++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const rt: { id: string; revokedAt: Date | null; replacedById: string | null } | null =
      await prisma.refreshToken.findUnique({
      where: { id: currentId },
      select: { id: true, revokedAt: true, replacedById: true },
      });
    if (!rt) break;
    if (!rt.revokedAt) {
      await prisma.refreshToken.update({ where: { id: rt.id }, data: { revokedAt: now } });
      revoked += 1;
    }
    currentId = rt.replacedById ?? null;
  }
  return revoked;
}

/** Revoca toda la cadena/familia: sube a la raíz y revoca hacia adelante. */
export async function revokeRefreshTokenChain(anyTokenId: string): Promise<{ rootId: string; revoked: number }> {
  const rootId = await findRootRefreshTokenId(anyTokenId);
  const revoked = await revokeRefreshTokenDescendants(rootId);
  return { rootId, revoked };
}


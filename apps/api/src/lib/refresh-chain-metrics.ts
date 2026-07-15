import { prisma } from "../db.js";

export type RefreshChainAgg = {
  sampleSize: number;
  totalTokens: number;
  activeTokens: number;
  roots: number;
  maxDepth: number;
  avgDepth: number;
};

export async function computeRefreshChainAgg(limit: number = 5000): Promise<RefreshChainAgg> {
  const now = new Date();
  const rows = await prisma.refreshToken.findMany({
    take: Math.max(100, Math.min(10_000, limit)),
    orderBy: { createdAt: "desc" },
    select: { id: true, replacesId: true, replacedById: true, revokedAt: true, expiresAt: true },
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const activeTokens = rows.filter((r) => !r.revokedAt && r.expiresAt > now).length;
  const roots = rows.filter((r) => !r.replacesId).length;

  // Depth: longitud hacia atrás hasta raíz (dentro de la muestra)
  const depthMemo = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthMemo.get(id);
    if (cached != null) return cached;
    const r = byId.get(id);
    if (!r) return 1;
    if (!r.replacesId) {
      depthMemo.set(id, 1);
      return 1;
    }
    if (r.replacesId === id) {
      depthMemo.set(id, 1);
      return 1;
    }
    const d = 1 + depthOf(r.replacesId);
    depthMemo.set(id, d);
    return d;
  };

  let maxDepth = 0;
  let sumDepth = 0;
  for (const r of rows) {
    const d = depthOf(r.id);
    sumDepth += d;
    if (d > maxDepth) maxDepth = d;
  }

  return {
    sampleSize: rows.length,
    totalTokens: rows.length,
    activeTokens,
    roots,
    maxDepth,
    avgDepth: rows.length ? sumDepth / rows.length : 0,
  };
}


import { prisma } from "../db.js";

/**
 * Borra jobs de biblioteca en estado terminal más antiguos que `retentionDays`.
 * En lotes de hasta `maxDelete` por corrida para no bloquear la DB demasiado tiempo.
 */
export async function cleanupOldLibraryProcessJobs(params: {
  retentionDays: number;
  maxDelete: number;
}): Promise<number> {
  if (params.retentionDays <= 0 || params.maxDelete <= 0) return 0;
  const cutoff = new Date(Date.now() - params.retentionDays * 86_400_000);
  const rows = await prisma.libraryProcessJob.findMany({
    where: {
      status: { in: ["completed", "failed", "cancelled"] },
      finishedAt: { lt: cutoff },
    },
    select: { id: true },
    take: params.maxDelete,
  });
  if (rows.length === 0) return 0;
  const r = await prisma.libraryProcessJob.deleteMany({
    where: { id: { in: rows.map((x) => x.id) } },
  });
  return r.count;
}

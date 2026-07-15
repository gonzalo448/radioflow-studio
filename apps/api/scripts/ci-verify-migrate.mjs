/**
 * Verificación post-`prisma migrate deploy` (CI / staging).
 * Ejecutar desde apps/api: node scripts/ci-verify-migrate.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const migrations = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "_prisma_migrations"
  `;
  const n = migrations[0]?.n ?? 0;
  if (n < 1) {
    console.error("[ci-verify-migrate] FAIL: sin migraciones aplicadas");
    process.exit(1);
  }
  console.log(`[ci-verify-migrate] OK: ${n} migración(es) registrada(s)`);

  const userTable = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'User'
    ) AS ok
  `;
  if (!userTable[0]?.ok) {
    console.error("[ci-verify-migrate] FAIL: tabla User ausente");
    process.exit(1);
  }
  console.log("[ci-verify-migrate] OK: tabla User presente");

  const pgvector = await prisma.$queryRaw`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok
  `;
  if (pgvector[0]?.ok) {
    const embCol = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'MediaAsset' AND column_name = 'embedding'
      ) AS ok
    `;
    if (embCol[0]?.ok) {
      console.log("[ci-verify-migrate] OK: pgvector + MediaAsset.embedding");
    } else {
      console.warn("[ci-verify-migrate] WARN: extensión vector sin columna embedding");
    }
  } else {
    console.log("[ci-verify-migrate] INFO: pgvector no instalado");
  }
} finally {
  await prisma.$disconnect();
}

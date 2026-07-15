/**
 * Backfill pgvector desde embeddingRef (JSON) ya guardado en MediaAsset.
 * Requiere build previo: npm run build -w @radioflow/api
 * Uso: node scripts/pgvector-backfill-from-ref.mjs [--limit 500]
 */
import { PrismaClient } from "@prisma/client";
import {
  countAssetsForPgVectorBackfill,
  runPgVectorBackfillBatch,
} from "../dist/lib/pgvector-backfill-batch.js";

const args = process.argv.slice(2);
let limit = 500;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--limit" && args[i + 1]) {
    limit = Number(args[i + 1]);
    i += 1;
  }
}

const prisma = new PrismaClient();

try {
  const pending = await countAssetsForPgVectorBackfill(prisma);
  console.log(`[pgvector-backfill] pendientes (embeddingRef sin columna embedding): ${pending}`);
  if (pending < 1) {
    console.log("[pgvector-backfill] nada que hacer");
    process.exit(0);
  }

  const result = await runPgVectorBackfillBatch(prisma, {
    limit,
    onProgress: ({ done, total, updated, skipped, failed }) => {
      if (done % 50 === 0 || done === total) {
        console.log(`[pgvector-backfill] ${done}/${total} ↑${updated} ~${skipped} ✗${failed}`);
      }
    },
  });

  console.log(
    `[pgvector-backfill] OK total=${result.total} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`,
  );
  if (result.failed > 0) process.exit(1);
} finally {
  await prisma.$disconnect();
}

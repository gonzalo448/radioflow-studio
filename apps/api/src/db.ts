import { PrismaClient } from "@prisma/client";
import { PrismaClient as StandalonePrismaClient } from "./generated/prisma-standalone/index.js";
import { isSqliteDatabaseUrl } from "./lib/db-dialect.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const log = process.env.NODE_ENV === "development" ? (["error", "warn"] as const) : (["error"] as const);
  if (isSqliteDatabaseUrl()) {
    const url = process.env.DATABASE_URL!.trim();
    const c = new StandalonePrismaClient({
      datasources: { db: { url } },
      log: [...log],
    });
    return c as unknown as PrismaClient;
  }
  return new PrismaClient({ log: [...log] });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

import { isSqliteDatabaseUrl } from "./db-dialect.js";

type ContainsFilter = { contains: string; mode?: "insensitive" };
type EqualsFilter = { equals: string; mode?: "insensitive" };

/**
 * Prisma `mode: "insensitive"` solo existe en PostgreSQL.
 * En SQLite embebido (desktop) provoca 500; LIKE de SQLite ya es
 * case-insensitive para ASCII, así que basta con omitir el mode.
 */
export function containsCi(value: string): ContainsFilter {
  if (isSqliteDatabaseUrl()) return { contains: value };
  return { contains: value, mode: "insensitive" };
}

export function equalsCi(value: string): EqualsFilter {
  if (isSqliteDatabaseUrl()) return { equals: value };
  return { equals: value, mode: "insensitive" };
}

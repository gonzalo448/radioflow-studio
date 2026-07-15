/** True si la API usa el esquema SQLite embebido (`file:` / `sqlite:`). */
export function isSqliteDatabaseUrl(url?: string): boolean {
  const u = (url ?? process.env.DATABASE_URL ?? "").trim();
  return u.startsWith("file:") || u.toLowerCase().startsWith("sqlite:");
}

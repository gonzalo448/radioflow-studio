import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSqliteDatabaseUrl } from "./db-dialect.js";

/** Resuelve `file:./rel.db` y `file:///C:/…` respecto a la raíz de `apps/api`. */
function normalizeSqliteDatabaseUrl(apiRoot: string): void {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw || !isSqliteDatabaseUrl(raw)) return;
  let filePart = raw.replace(/^file:/i, "");
  if (filePart.startsWith("//")) {
    filePart = filePart.slice(2);
  }
  if (path.isAbsolute(filePart)) {
    process.env.DATABASE_URL = `file:${filePart.replace(/\\/g, "/")}`;
    return;
  }
  const abs = path.resolve(apiRoot, filePart);
  process.env.DATABASE_URL = `file:${abs.replace(/\\/g, "/")}`;
}

/**
 * Aplica migraciones del esquema standalone (SQLite) antes de instanciar Prisma.
 * Debe ejecutarse solo con `DATABASE_URL` tipo `file:` (sin importar `./db.js`).
 */
export function runStandaloneMigrationsSync(): void {
  if (!isSqliteDatabaseUrl()) return;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiRoot = path.join(here, "..", "..");
  normalizeSqliteDatabaseUrl(apiRoot);
  const prismaCli = path.join(apiRoot, "node_modules", "prisma", "build", "index.js");
  const schema = path.join(apiRoot, "prisma", "standalone", "schema.prisma");

  const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", `--schema=${schema}`], {
    cwd: apiRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error("[radioflow] prisma migrate deploy (standalone SQLite) falló con código", r.status);
    process.exit(r.status ?? 1);
  }
}

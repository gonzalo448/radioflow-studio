/**
 * Promoción directa en BD para E2E (misma `DATABASE_URL` que la API).
 * Solo tests locales / CI; no uses esto en producción expuesta.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { loadRepoEnv } from "./load-env";

export async function promoteUserToAdmin(email: string): Promise<void> {
  loadRepoEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL es requerida para promover usuario a admin en E2E");

  // @prisma/client vive en el workspace de la API (npm workspaces), no en la raíz.
  // process.cwd() = raíz del repo (playwright / npm run test:e2e). Evitar import.meta:
  // Playwright puede cargar este helper fuera de ESM estricto.
  const apiPkg = path.join(process.cwd(), "apps", "api", "package.json");
  const require = createRequire(apiPkg);
  const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const { count } = await prisma.user.updateMany({
      where: { email },
      data: { role: "admin" },
    });
    if (count !== 1) {
      throw new Error(`promoteUserToAdmin: se esperaba 1 fila, obtuvo ${count} para email=${email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

import path from "node:path";
import dotenv from "dotenv";

/** Carga `.env` de la raíz y `apps/api/.env` (workers Playwright no heredan archivos, solo variables). */
export function loadRepoEnv(): void {
  dotenv.config({ path: path.join(process.cwd(), ".env") });
  dotenv.config({ path: path.join(process.cwd(), "apps", "api", ".env") });
}

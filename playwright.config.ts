import { defineConfig, devices } from "@playwright/test";

/**
 * E2E: asume API en PLAYWRIGHT_API_URL (4000) y panel en PLAYWRIGHT_BASE_URL (5173).
 * En local: `npm run dev` en otra terminal, luego `npm run test:e2e`.
 * En CI: el workflow levanta API + Vite y ejecuta las pruebas.
 * Para promover admin vía Prisma hace falta `DATABASE_URL` (CI o `apps/api/.env`; véase `e2e/db-admin.ts`).
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

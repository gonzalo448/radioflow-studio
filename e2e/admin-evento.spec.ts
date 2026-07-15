import { test, expect } from "@playwright/test";
import { loginThroughUi, registerFreshUser, apiBase, loadRepoEnv } from "./helpers";
import { promoteUserToAdmin } from "./db-admin";

/**
 * Admin crea evento y aparece toast de éxito.
 * - Con `DATABASE_URL` (entorno o `.env`): registra usuario, lo promueve a admin vía Prisma.
 * - Con `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD`: usa esa cuenta (debe existir y ser admin).
 */
test.describe("Admin · eventos", () => {
  test("crear evento desde el panel y notificación de éxito", async ({ page, request }) => {
    loadRepoEnv();

    const envEmail = process.env.E2E_ADMIN_EMAIL?.trim();
    const envPass = process.env.E2E_ADMIN_PASSWORD?.trim();
    const hasDb = Boolean(process.env.DATABASE_URL?.trim());

    if (envEmail && !envPass) test.skip(true, "E2E_ADMIN_PASSWORD requerido si definís E2E_ADMIN_EMAIL");
    if (!envEmail && !envPass && !hasDb) {
      test.skip(true, "Definí DATABASE_URL (promoción vía Prisma) o E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD");
    }

    let email: string;
    let password: string;

    if (envEmail && envPass) {
      email = envEmail;
      password = envPass;
      const probe = await request.get(`${apiBase()}/api/health/ready`);
      expect(probe.ok()).toBeTruthy();
    } else {
      const u = await registerFreshUser(request);
      email = u.email;
      password = u.password;
      await promoteUserToAdmin(email);
    }

    await loginThroughUi(page, email, password);
    await page.goto("/admin/eventos");

    await expect(page.getByRole("heading", { name: "Gestión de eventos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Nuevo evento" })).toBeVisible();

    const rutaUnica = `media/e2e-evento-${Date.now()}.mp3`;

    await page.getByRole("button", { name: "+ Nuevo evento" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nuevo evento" })).toBeVisible();

    await page.getByPlaceholder("p. ej. uploads/pista.mp3").fill(rutaUnica);
    await page.getByRole("button", { name: "Guardar" }).click();

    await expect(page.locator(".notification.success")).toHaveText(/Evento creado con éxito/);
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(rutaUnica, { exact: true })).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";
import { loginThroughUi, registerFreshUser } from "./helpers";

test.describe("Navegación", () => {
  test("módulo Eventos desde la barra de herramientas", async ({ page, request }) => {
    const { email, password } = await registerFreshUser(request);
    await loginThroughUi(page, email, password);

    await page.getByRole("navigation", { name: "Módulos" }).getByRole("link", { name: "Eventos" }).click();

    await expect(page).toHaveURL(/\/admin\/eventos\/?$/);
    await expect(page.getByRole("heading", { name: "Gestión de eventos" })).toBeVisible();
  });
});

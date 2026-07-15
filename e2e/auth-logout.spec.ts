import { test, expect } from "@playwright/test";
import { loginThroughUi, registerFreshUser } from "./helpers";

test.describe("Cerrar sesión", () => {
  test("vuelve a mostrar Entrar en la barra superior", async ({ page, request }) => {
    const { email, password } = await registerFreshUser(request);
    await loginThroughUi(page, email, password);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();

    await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";
import { loginThroughUi, registerFreshUser } from "./helpers";

test.describe("Autenticación → cabina", () => {
  test("registro por API, login en UI y aterrizaje en /station", async ({ page, request }) => {
    const { email, password } = await registerFreshUser(request);
    await loginThroughUi(page, email, password);
    await expect(page.getByRole("img", { name: "RadioFlow Studio" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  });
});

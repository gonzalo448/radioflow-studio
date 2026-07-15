import { test, expect } from "@playwright/test";
import { loginThroughUi, registerFreshUser } from "./helpers";

test.describe("Autenticación → inicio", () => {
  test("registro por API, login en UI y aterrizaje en /inicio", async ({ page, request }) => {
    const { email, password } = await registerFreshUser(request);
    await loginThroughUi(page, email, password);
    await expect(page.getByRole("heading", { name: /RadioFlow Studio/i }).first()).toBeVisible();
  });
});

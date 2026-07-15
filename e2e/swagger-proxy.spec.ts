import { test, expect } from "@playwright/test";

test.describe("Proxy Vite → API", () => {
  test("Swagger UI responde bajo /api/docs", async ({ page }) => {
    await page.goto("/api/docs");
    await expect(page).toHaveTitle(/Swagger UI/i);
    await expect(page.getByText("RadioFlow Studio API", { exact: false }).first()).toBeVisible();
  });
});

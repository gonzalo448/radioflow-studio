import { expect, type APIRequestContext, type Page } from "@playwright/test";

export { loadRepoEnv } from "./load-env";

export function apiBase(): string {
  return (process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
}

export async function registerFreshUser(request: APIRequestContext): Promise<{ email: string; password: string }> {
  const suffix = `${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  const email = `e2e.${suffix}@radioflow.test`;
  const password = "E2E_test_pass_9";
  const reg = await request.post(`${apiBase()}/api/auth/register`, {
    data: { email, password, displayName: "E2E" },
    headers: { "Content-Type": "application/json" },
  });
  expect(reg.ok(), await reg.text()).toBeTruthy();
  return { email, password };
}

export async function loginThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("Correo").fill(email);
  await page.getByPlaceholder("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inicio\/?$/);
}

import { afterEach, describe, expect, it } from "vitest";

describe("loadEnv EMBEDDED_STANDALONE vs headless", () => {
  const prev = { ...process.env };

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
    // Recargar módulo con env fresco es frágil; validamos el contrato documentado:
  });

  it("contrato: desktop embebido fuerza headless off si no hay override", async () => {
    process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
    process.env.DATABASE_URL = "file:./tmp-test.db";
    process.env.EMBEDDED_STANDALONE = "1";
    delete process.env.HEADLESS_PLAYOUT_POLL_MS;
    // Import dinámico tras setear env (config llama loadEnv al importarse en otros sitios;
    // aquí importamos solo la función vía re-require del módulo).
    const mod = await import("./config.js");
    // loadEnv ya se ejecutó en bootstrap de otros tests; llamamos de nuevo.
    const env = mod.loadEnv();
    expect(env.EMBEDDED_STANDALONE).toBe(true);
    expect(env.HEADLESS_PLAYOUT_POLL_MS).toBe(0);
  });

  it("respeta override explícito de HEADLESS_PLAYOUT_POLL_MS", async () => {
    process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
    process.env.DATABASE_URL = "file:./tmp-test.db";
    process.env.EMBEDDED_STANDALONE = "1";
    process.env.HEADLESS_PLAYOUT_POLL_MS = "2000";
    const mod = await import("./config.js");
    const env = mod.loadEnv();
    expect(env.HEADLESS_PLAYOUT_POLL_MS).toBe(2000);
  });
});

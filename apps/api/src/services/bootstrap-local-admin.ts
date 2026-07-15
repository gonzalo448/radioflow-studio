import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { hashPassword } from "../lib/crypto.js";

/**
 * Crea un usuario administrador local si está configurado y aún no existe.
 * Uso típico: primera instalación / estación en PC sin pasar por registro manual.
 */
export async function ensureBootstrapLocalAdmin(env: Env, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  if (env.EMBEDDED_STANDALONE) return;
  if (!env.BOOTSTRAP_LOCAL_ADMIN) return;

  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    log.warn(
      {},
      "BOOTSTRAP_LOCAL_ADMIN=1 pero faltan BOOTSTRAP_ADMIN_EMAIL o BOOTSTRAP_ADMIN_PASSWORD (mín. 8 caracteres).",
    );
    return;
  }

  if (password.length < 8) {
    log.warn({}, "BOOTSTRAP_ADMIN_PASSWORD debe tener al menos 8 caracteres.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    log.info({ email }, "bootstrap admin: el usuario ya existe, no se modifica.");
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: "Administrador local",
      role: "admin",
    },
  });
  log.info({ email }, "bootstrap admin: usuario administrador creado (primer arranque).");
}

import { PrismaClient } from "../apps/api/src/generated/prisma-standalone/index.js";
import { hashPassword } from "../apps/api/dist/lib/crypto.js";

const email = process.argv[2];
const newPassword = process.argv[3];
if (!email || !newPassword || newPassword.length < 8) {
  console.error("Uso: node scripts/reset-local-password.mjs <email> <nueva-contraseña-min-8>");
  process.exit(1);
}

const p = new PrismaClient();
const user = await p.user.findUnique({ where: { email } });
if (!user) {
  console.error("Usuario no encontrado:", email);
  await p.$disconnect();
  process.exit(1);
}

const passwordHash = await hashPassword(newPassword);
await p.user.update({ where: { id: user.id }, data: { passwordHash } });
console.log(`Contraseña actualizada para ${email} (rol: ${user.role})`);
await p.$disconnect();

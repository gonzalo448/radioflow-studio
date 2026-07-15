import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "api");
const srcGen = path.join(root, "src", "generated");
const destGen = path.join(root, "dist", "generated");
if (!fs.existsSync(srcGen)) {
  console.warn("[copy-prisma-standalone] sin src/generated; ejecutá npm run db:generate -w @radioflow/api");
  process.exit(0);
}
fs.mkdirSync(path.dirname(destGen), { recursive: true });
fs.cpSync(srcGen, destGen, { recursive: true });
console.log("[copy-prisma-standalone] copiado a dist/generated");

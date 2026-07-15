/**
 * electron-builder resuelve `electron` desde apps/desktop; en workspaces npm puede
 * quedar en la raíz (hoist) o solo en apps/desktop/node_modules. Garantiza un
 * enlace local si hace falta.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const desktopNm = path.join(root, "apps", "desktop", "node_modules");
const linkPath = path.join(desktopNm, "electron");

function resolveElectronPkg() {
  const candidates = [
    path.join(root, "node_modules", "electron"),
    path.join(desktopNm, "electron"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

const electronPkg = resolveElectronPkg();
if (!electronPkg) {
  console.error(
    "Falta el paquete `electron`. Ejecutá `npm install` en la raíz del repo (workspace @radioflow/desktop).",
  );
  process.exit(1);
}

fs.mkdirSync(desktopNm, { recursive: true });

if (fs.existsSync(linkPath)) {
  try {
    const existing = fs.realpathSync(linkPath);
    if (existing === fs.realpathSync(electronPkg)) process.exit(0);
  } catch {
    /* enlace roto o inaccesible — recrear */
  }
} else if (electronPkg === path.resolve(linkPath)) {
  process.exit(0);
}

if (fs.existsSync(linkPath)) {
  try {
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {
    /* junction en Windows */
    fs.unlinkSync(linkPath);
  }
}

const linkType = process.platform === "win32" ? "junction" : "dir";
fs.symlinkSync(electronPkg, linkPath, linkType);

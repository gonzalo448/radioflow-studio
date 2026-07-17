/**
 * Genera iconos para electron-builder desde apps/web/public/favicon.svg
 * Uso: node scripts/generate-desktop-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(root, "apps", "web", "public", "favicon.svg");
const buildDir = path.join(root, "apps", "desktop", "build");
const iconsDir = path.join(buildDir, "icons");

if (!fs.existsSync(svgPath)) {
  console.error("[icons] No existe", svgPath);
  process.exit(1);
}

const svg = fs.readFileSync(svgPath);

fs.mkdirSync(iconsDir, { recursive: true });

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  icoSizes.map((size) => sharp(svg).resize(size, size, { fit: "contain" }).png().toBuffer()),
);
const ico = await pngToIco(pngBuffers);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);

await sharp(svg).resize(1024, 1024, { fit: "contain" }).png().toFile(path.join(buildDir, "icon.png"));

for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  await sharp(svg)
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(path.join(iconsDir, `${size}x${size}.png`));
}

console.log("[icons] Generados en apps/desktop/build/ (icon.ico, icon.png, icons/*)");

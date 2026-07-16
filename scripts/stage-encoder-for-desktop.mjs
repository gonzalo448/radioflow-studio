/**
 * Genera el encoder autocontenido y copia FFmpeg/ffprobe del host para electron-builder.
 * Debe ejecutarse en el mismo SO/arquitectura del artefacto final.
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const encoderEntry = path.join(root, "apps", "encoder", "src", "index.ts");
const encoderDest = path.join(root, "apps", "desktop", ".embedded-encoder");
const toolsDest = path.join(root, "apps", "desktop", ".embedded-tools");

function packageRoot(specifier) {
  let dir = path.dirname(require.resolve(specifier));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function copyLicenses(specifier, label) {
  const pkgRoot = packageRoot(specifier);
  if (!pkgRoot) return;
  const licenseDest = path.join(toolsDest, "licenses");
  fs.mkdirSync(licenseDest, { recursive: true });
  for (const name of fs.readdirSync(pkgRoot)) {
    if (!/^licen[cs]e(?:\..+)?$/i.test(name)) continue;
    fs.copyFileSync(path.join(pkgRoot, name), path.join(licenseDest, `${label}-${name}`));
  }
}

if (!fs.existsSync(encoderEntry)) {
  console.error("[stage-encoder-desktop] Falta", encoderEntry);
  process.exit(1);
}

fs.rmSync(encoderDest, { recursive: true, force: true });
fs.rmSync(toolsDest, { recursive: true, force: true });
fs.mkdirSync(encoderDest, { recursive: true });
fs.mkdirSync(toolsDest, { recursive: true });

await build({
  entryPoints: [encoderEntry],
  outfile: path.join(encoderDest, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "eof",
  // dotenv y otros CJS usan require() dinámico; el banner lo habilita en ESM.
  banner: {
    js: "import { createRequire as __radioflowCreateRequire } from 'node:module';const require = __radioflowCreateRequire(import.meta.url);",
  },
});

const ffmpeg = require("@ffmpeg-installer/ffmpeg");
const ffprobe = require("@ffprobe-installer/ffprobe");
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const ffmpegDest = path.join(toolsDest, `ffmpeg${exeSuffix}`);
const ffprobeDest = path.join(toolsDest, `ffprobe${exeSuffix}`);

for (const [source, dest, label] of [
  [ffmpeg.path, ffmpegDest, "FFmpeg"],
  [ffprobe.path, ffprobeDest, "ffprobe"],
]) {
  if (!source || !fs.existsSync(source)) {
    console.error(`[stage-encoder-desktop] Falta binario ${label} para ${process.platform}/${process.arch}`);
    process.exit(1);
  }
  fs.copyFileSync(source, dest);
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
}

copyLicenses("@ffmpeg-installer/ffmpeg", "ffmpeg");
copyLicenses("@ffprobe-installer/ffprobe", "ffprobe");
fs.writeFileSync(
  path.join(toolsDest, "manifest.json"),
  `${JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      ffmpegVersion: ffmpeg.version ?? null,
      ffprobeVersion: ffprobe.version ?? null,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `[stage-encoder-desktop] listo: encoder + FFmpeg/ffprobe para ${process.platform}/${process.arch}`,
);

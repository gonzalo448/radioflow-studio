#!/usr/bin/env node
/**
 * Verifica que los archivos de texto del repo estén en UTF-8 válido (sin BOM recomendado).
 * Uso: node scripts/check-utf8.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-pack",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
  ".turbo",
  "playwright",
  "radioflow_media",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".sql",
  ".prisma",
  ".env.example",
  ".gitignore",
  ".editorconfig",
]);

const ALWAYS_CHECK = new Set([
  "README.md",
  "package.json",
  "docker-compose.yml",
  "docker-compose.prod.yml",
]);

const decoder = new TextDecoder("utf-8", { fatal: true });

function shouldCheck(filePath, name) {
  if (ALWAYS_CHECK.has(name)) return true;
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (name === ".env.example" || name.endsWith(".env.example")) return true;
  return false;
}

function walk(dir, issues) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(full, issues);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!shouldCheck(full, ent.name)) continue;

    const buf = fs.readFileSync(full);
    const rel = path.relative(ROOT, full).replace(/\\/g, "/");

    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      issues.push(`${rel}: tiene BOM UTF-8 (preferible guardar sin BOM)`);
    }

    const body = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;

    try {
      decoder.decode(body);
    } catch {
      issues.push(`${rel}: no es UTF-8 válido`);
    }
  }
}

const issues = [];
walk(ROOT, issues);

if (issues.length === 0) {
  console.log("[check-utf8] OK — archivos de texto revisados en UTF-8.");
  process.exit(0);
}

console.error("[check-utf8] Se encontraron problemas:\n");
for (const line of issues) {
  console.error(`  - ${line}`);
}
process.exit(1);

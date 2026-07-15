/**
 * Quita menciones a RadioBOSS en literales de apps/web (UI), sin alterar indentación.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/web/src");

const pairReplacements = [
  [/estilo RadioBOSS/gi, ""],
  [/Estilo RadioBOSS:?\s*/g, ""],
  [/Equivalente a RadioBOSS\s*/gi, ""],
  [/Equivalente RadioBOSS:?\s*/gi, ""],
  [/tipo RadioBOSS:?\s*/gi, ""],
  [/Plantillas RadioBOSS:?\s*/gi, "Plantillas: "],
  [/Plantillas tipo RadioBOSS:?\s*/gi, "Plantillas: "],
  [/RadioBOSS Generator Pro/g, "Generador Pro"],
  [/Modo \(RadioBOSS Generator Pro\)/g, "Modo del generador"],
  [/Como en RadioBOSS:\s*/g, ""],
  [/Como Station ID \/ jingle en RadioBOSS/g, "Como Station ID / jingle"],
  [/Selección \(RadioBOSS\)/g, "Selección"],
  [/Comandos de transporte y cola RadioBOSS/g, "Comandos de transporte y cola"],
  [/Sincronización top-of-hour \(RadioBOSS\)/g, "Sincronización top-of-hour"],
  [/Rutas de bóveda · RadioBOSS/g, "Rutas de bóveda"],
  [/Winamp \/ RadioBOSS/g, "Winamp / PLS"],
  [/Menús alineados con la estructura del manual de RadioBOSS \(parte VI\)\./g, "Automatización y cabina para radio."],
  [/la estructura del manual de RadioBOSS \(parte VI\)/g, "RadioFlow Studio"],
  [/Paridad con RadioBOSS:[^\n<]*/g, "Documentación de producto en el repositorio."],
  [/radioboss-parity\.md/g, "roadmap.md"],
  [/checklist de paridad con RadioBOSS[^\n<]*/gi, "documentación de producto"],
  [/ \(RB-\d+\)/g, ""],
  [/RB-\d+\.?\s*/g, ""],
  [/RadioBOSS Ads Scheduler \(MVP\):/g, "Planificador de publicidad:"],
  [/RadioBOSS-style/gi, ""],
  [/RadioBOSS:/g, ""],
  [/\(RadioBOSS\)/g, ""],
  [/RadioBOSS/g, ""],
  [/RadioBoss/g, ""],
];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(ent.name)) processFile(p);
  }
}

function processFile(file) {
  let src = fs.readFileSync(file, "utf8");
  const orig = src;
  for (const [re, to] of pairReplacements) {
    src = src.replace(re, to);
  }
  if (src !== orig) {
    fs.writeFileSync(file, src);
    console.log("updated", path.relative(root, file));
  }
}

walk(root);
console.log("done");

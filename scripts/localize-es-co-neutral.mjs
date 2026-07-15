#!/usr/bin/env node
/**
 * Convierte textos de UI/mensajes de voseo rioplatense a español neutro (Colombia).
 * Solo archivos de código de apps (no documentación).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const dirs = [
  path.join(root, "apps", "web", "src"),
  path.join(root, "apps", "api", "src"),
  path.join(root, "apps", "desktop"),
  path.join(root, "apps", "encoder", "src"),
];

const exts = new Set([".ts", ".tsx", ".cjs", ".html"]);

/** Orden: frases largas primero, luego imperativos y formas verbales. */
const replacements = [
  ["Creá o elegí", "Crea o elige"],
  ["creá o elegí", "crea o elige"],
  ["Elegí o creá", "Elige o crea"],
  ["elegí o creá", "elige o crea"],
  ["Iniciá sesión", "Inicia sesión"],
  ["iniciá sesión", "inicia sesión"],
  ["Iniciá Sesión", "Inicia sesión"],
  ["Esta copia ya está configurada. Iniciá sesión con tu usuario.", "Esta copia ya está configurada. Inicia sesión con su usuario."],
  ["No podés eliminar tu propia cuenta", "No puede eliminar su propia cuenta"],
  ["solo podés ingresar", "solo puede ingresar"],
  ["En el siguiente paso creás tu usuario", "En el siguiente paso crea su usuario"],
  ["Tu emisora ya está en esta PC. Iniciá sesión o entrá directo", "Su emisora ya está en este equipo. Inicia sesión o entre directamente"],
  ["Todo queda en esta PC.", "Todo queda en este equipo."],
  ["en esta instalación en tu PC", "en esta instalación en su equipo"],
  ["desde la aplicación instalada en tu PC", "desde la aplicación instalada en su equipo"],
  ["Esta emisora se opera desde la <strong>aplicación instalada</strong> en tu PC", "Esta emisora se opera desde la <strong>aplicación instalada</strong> en su equipo"],
  ["instalada en tu PC:", "instalada en su equipo:"],
  ["«Instalá la app»", "«Instala la aplicación»"],
  ["Instalá <strong>RadioFlow Studio Setup</strong>", "Instale <strong>RadioFlow Studio Setup</strong>"],
  ["Tras instalar, abrí «RadioFlow Studio»", "Tras instalar, abra «RadioFlow Studio» desde"],
  ["Abrí RadioFlow Studio desde el menú Inicio", "Abra RadioFlow Studio desde el menú Inicio"],
  ["Abrí RadioFlow Studio desde la aplicación instalada en su equipo", "Abra RadioFlow Studio desde la aplicación instalada en su equipo"],
  ["marcá las canciones y pulsá", "marque las canciones y haga clic en"],
  ["Haz clic en <strong>Guardar en la librería</strong>", "Haga clic en <strong>Guardar en la librería</strong>"],
  ["pulsá <strong>Guardar en la librería</strong>", "haga clic en <strong>Guardar en la librería</strong>"],
  ["Marcá canciones y arrastralas", "Marque canciones y arrástrelas"],
  ["arrastralas a la playlist", "arrástrelas a la lista"],
  ["mandar jingles", "enviar jingles"],
  ["Necesitás sesión", "Necesita sesión"],
  ["Necesitás permiso", "Necesita permiso"],
  ["si necesitás cambios", "si necesita cambios"],
  ["Contactá a un admin", "Contacte a un administrador"],
  ["las pistas que querés conservar", "las pistas que desea conservar"],
  ["cuando quieras", "cuando lo desee"],
  ["podés cambiarla", "puede cambiarla"],
  ["Podés copiar", "Puede copiar"],
  ["Podés crear", "Puede crear"],
  ["No tenés permiso", "No tiene permiso"],
  ["Tenés que", "Debe"],
  ["Ya tenés la última versión", "Ya tiene la última versión"],
  ["Volvé a instalar", "Vuelva a instalar"],
  ["Volvé a subir", "Vuelva a subir"],
  ["quitála de la cola", "quítela de la cola"],
  ["Seleccioná una o más", "Seleccione una o más"],
  ["Seleccioná las pistas", "Seleccione las pistas"],
  ["Seleccioná pistas", "Seleccione pistas"],
  ["Seleccioná una playlist", "Seleccione una lista"],
  ["Seleccioná la playlist", "Seleccione la lista"],
  ["Seleccioná una lista", "Seleccione una lista"],
  ["Seleccioná un origen", "Seleccione un origen"],
  ["Seleccioná un audio", "Seleccione un audio"],
  ["Seleccioná una pestaña", "Seleccione una pestaña"],
  ["Elegí una carpeta, género", "Elija una carpeta, género"],
  ["Elegí una playlist", "Elija una lista"],
  ["Elegí una pista", "Elija una pista"],
  ["Elegí una unidad", "Elija una unidad"],
  ["Elegí una carpeta del equipo", "Elija una carpeta del equipo"],
  ["Elegí un audio", "Elija un audio"],
  ["Elegí un origen", "Elija un origen"],
  ["Elegí una lista", "Elija una lista"],
  ["Elegí archivos", "Elija archivos"],
  ["Elegí la música", "Elija la música"],
  ["Ahora elegí la música y guardá", "Ahora elija la música y guarde"],
  ["Empezá en", "Empiece en"],
  ["Volcá esta lista", "Vuelque esta lista"],
  ["Completá hora", "Complete hora"],
  ["Completá el valor", "Complete el valor"],
  ["Previsualizá primero", "Previsualice primero"],
  ["Vinculá una pista", "Vincule una pista"],
  ["Ejecutá:", "Ejecute:"],
  ["Configurá un destino", "Configure un destino"],
  ["Configurá destino", "Configure destino"],
  ["Indicá al menos", "Indique al menos"],
  ["Indicá géneros", "Indique géneros"],
  ["Indicá fecha", "Indique fecha"],
  ["Indicá el nombre", "Indique el nombre"],
  ["Indicá filtros", "Indique filtros"],
  ["Ingresá una URL", "Ingrese una URL"],
  ["Usá «Forzar»", "Use «Forzar»"],
  ["Usá la aplicación", "Use la aplicación"],
  ["Usá la app", "Use la aplicación"],
  ["Usá PNG", "Use PNG"],
  ["usá solo en redes", "use solo en redes de confianza"],
  ["desactivá cuando", "desactive cuando"],
  ["usá rutas", "use rutas"],
  ["usá la Librería", "use la Librería"],
  ["usá «Generar", "use «Generar"],
  ["recurrentes usá", "recurrentes use"],
  ["Para una copia con otro nombre usá", "Para una copia con otro nombre use"],
  ["recorré tus discos", "recorra sus discos"],
  ["guardá la música", "guarde la música"],
  ["guardá en librería", "guarde en la librería"],
  ["Importá música", "Importe música"],
  ["Importá audios", "Importe audios"],
  ["importá archivos", "importe archivos"],
  ["explorá por carpeta", "explore por carpeta"],
  ["explorá tus discos", "explore sus discos"],
  ["Explorá", "Explore"],
  ["Revisá en", "Revise en"],
  ["enviá pistas", "envíe pistas"],
  ["Entrá con permisos", "Ingrese con permisos"],
  ["entrá directo", "entre directamente"],
  ["Arrastrá a la playlist", "Arrastre a la lista"],
  ["Arrastrá a la zona", "Arrastre a la zona"],
  ["Arrastrá o añadí", "Arrastre o añada"],
  ["arrastrá a la playlist", "arrastre a la lista"],
  ["arrastrá a la zona", "arrastre a la zona"],
  ["soltá aquí archivos", "suelte aquí archivos"],
  ["o arrastrá ítems", "o arrastre elementos"],
  ["Pulsá una tecla", "Presione una tecla"],
  ["Probá de nuevo", "Intente de nuevo"],
  ["probá de nuevo", "intente de nuevo"],
  ["Abrí una lista", "Abra una lista"],
  ["Abrí el detalle", "Abra el detalle de"],
  ["abrí una con medios", "abra una con medios"],
  ["abrí la biblioteca", "abra la biblioteca"],
  ["abrí RadioFlow en escritorio", "abra RadioFlow en escritorio"],
  ["Subí el archivo", "Suba el archivo"],
  ["Subí spots", "Suba spots"],
  ["subí los archivos", "suba los archivos"],
  ["subir esos archivos", "subir esos archivos"],
  ["Activá un destino", "Active un destino"],
  ["activá ffmpeg", "active ffmpeg"],
  ["esperá el primer", "espere el primer"],
  ["Esperá ${", "Espere ${"],
  ["Actualizá tags", "Actualice etiquetas"],
  ["reimportá", "reimporte"],
  ["filtrá una vista", "filtre una vista"],
  ["editá la", "edite la"],
  ["Añadí categorías", "Añada categorías"],
  ["añadí a la lista", "añada a la lista"],
  ["Revisá la consola", "Revise la consola"],
  ["reinstalá la aplicación", "reinstale la aplicación"],
  ["corregí la ruta", "corrija la ruta"],
  ["Creá tu usuario", "Cree su usuario"],
  ["Creá una carpeta", "Cree una carpeta"],
  ["creá <strong>carpetas</strong>", "cree <strong>carpetas</strong>"],
  ["Creá la primera", "Cree la primera"],
  ["creá una carpeta", "cree una carpeta"],
  ["Guardá la contraseña", "Guarde la contraseña"],
  ["Guardá en", "Guarde en"],
  ["Ruta no encontrada en el servidor (reiniciá la app)", "Ruta no encontrada en el servidor (reinicie la aplicación)"],
  ["seleccioná una lista y hacé doble clic", "seleccione una lista y haga doble clic"],
  ["hacé doble clic", "haga doble clic"],
  ["Enviá muestras", "Envíe muestras"],
  ["Generá con Ollama", "Genere con Ollama"],
  ["¿Está corriendo", "¿Está en ejecución"],
  ["configurálas", "configúrelas"],
  ["cargá varias pistas", "cargue varias pistas"],
  ["anotá el orden", "anote el orden"],
  ["Reordená desde", "Reordene desde"],
  ["Comprobá que", "Compruebe que"],
  ["Cambiá la URL", "Cambie la URL"],
  ["Podés volver", "Puede volver"],
  ["Añadí al menos", "Añada al menos"],
  ["Revisá FFMPEG_PATH", "Revise FFMPEG_PATH"],
  ["Reintentá en", "Reintente en"],
  ["Seguí el progreso", "Siga el progreso"],
  ["Grabá una locución", "Grabe una locución"],
  ["Actualizá RadioFlow Desktop", "Actualice RadioFlow Desktop"],
  ["Podés seguir usando la app", "Puede seguir usando la aplicación"],
  ["tu emisora", "su emisora"],
  ["tu PC", "su equipo"],
  ["esta PC", "este equipo"],
  ["tus discos", "sus discos"],
  ["Tu rol", "Su rol"],
  ["tu rol", "su rol"],
  ["Tus carpetas", "Sus carpetas"],
  ["tu usuario", "su usuario"],
  ["Tendrás", "Tendrá"],
  ["te entregó tu proveedor", "le entregó su proveedor"],
  ["Te avisaremos cuando puedas", "Le avisaremos cuando pueda"],
  ["Tu nombre (opcional)", "Su nombre (opcional)"],
  ["Tu música, tu radio, tu control", "Su música, su radio, su control"],
  ["creá una pestaña", "cree una pestaña"],
  ["Creá una pestaña", "Cree una pestaña"],
  ["añadí pistas", "añada pistas"],
  ["Elegí pistas", "Elija pistas"],
  ["arrastrá desde", "arrastre desde"],
  ["arrastrá filas", "arrastre filas"],
  ["Usá Reproducir", "Use Reproducir"],
  ["cambies a", "cambie a"],
  ["guardalas", "guárdelas"],
  ["usá ", "use "],
  ["configurá ", "configure "],
  ["desde desde", "desde"],
];

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "generated") continue;
      walk(p, files);
    } else if (exts.has(path.extname(ent.name))) {
      files.push(p);
    }
  }
  return files;
}

let fileCount = 0;
let changeCount = 0;

for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    let text = fs.readFileSync(file, "utf8");
    const orig = text;
    for (const [from, to] of replacements) {
      if (text.includes(from)) {
        text = text.split(from).join(to);
      }
    }
    if (text !== orig) {
      fs.writeFileSync(file, text, "utf8");
      fileCount += 1;
      changeCount += 1;
    }
  }
}

// index.html en web
const indexHtml = path.join(root, "apps", "web", "index.html");
if (fs.existsSync(indexHtml)) {
  let text = fs.readFileSync(indexHtml, "utf8");
  const orig = text;
  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }
  if (text !== orig) {
    fs.writeFileSync(indexHtml, text, "utf8");
    fileCount += 1;
  }
}

console.log(`[localize-es-co] ${fileCount} archivo(s) actualizado(s).`);

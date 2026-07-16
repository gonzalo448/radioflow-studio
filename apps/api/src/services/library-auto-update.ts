import fs from "node:fs";
import path from "node:path";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { isLibraryAudioFilename } from "../lib/library-audio-extensions.js";
import { absPathForMediaPrefix } from "../lib/library-folder-path.js";
import { splitArtistTitleFromBasename, enrichMediaAssetFromAudioFile } from "../lib/id3-enrich-asset.js";
import { isPathInsideRoot, mediaRootAbs, relativeToMediaRoot } from "../lib/media-path.js";
import { isSqliteDatabaseUrl } from "../lib/db-dialect.js";

export type LibraryAutoUpdateLastResult = {
  scanned: number;
  created: number;
  skippedExisting: number;
  errors: number;
  errorSample?: string;
};

export type LibraryAutoUpdateConfig = {
  enabled: boolean;
  /** Minutos entre ejecuciones automáticas (mín. 5). */
  intervalMinutes: number;
  /** Prefijos bajo MEDIA_ROOT; vacío = todas las carpetas bajo `uploads/`. */
  folderPrefixes: string[];
  lastRunAt: string | null;
  lastResult: LibraryAutoUpdateLastResult | null;
};

const CONFIG_BASENAME = path.join(".radioflow", "library-auto-update.json");

const DEFAULT_CONFIG: LibraryAutoUpdateConfig = {
  enabled: false,
  intervalMinutes: 60,
  folderPrefixes: [],
  lastRunAt: null,
  lastResult: null,
};

function configPath(env: Env): string {
  return path.join(mediaRootAbs(env), CONFIG_BASENAME);
}

export async function loadLibraryAutoUpdateConfig(env: Env): Promise<LibraryAutoUpdateConfig> {
  const file = configPath(env);
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<LibraryAutoUpdateConfig>;
    return {
      enabled: parsed.enabled === true,
      intervalMinutes: Math.max(5, Math.min(24 * 60, Number(parsed.intervalMinutes) || 60)),
      folderPrefixes: Array.isArray(parsed.folderPrefixes)
        ? parsed.folderPrefixes.map((p) => String(p).trim().replace(/\\/g, "/")).filter(Boolean)
        : [],
      lastRunAt: parsed.lastRunAt ?? null,
      lastResult: parsed.lastResult ?? null,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveLibraryAutoUpdateConfig(
  env: Env,
  patch: Partial<Pick<LibraryAutoUpdateConfig, "enabled" | "intervalMinutes" | "folderPrefixes">>,
): Promise<LibraryAutoUpdateConfig> {
  const current = await loadLibraryAutoUpdateConfig(env);
  const next: LibraryAutoUpdateConfig = {
    ...current,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.intervalMinutes !== undefined
      ? { intervalMinutes: Math.max(5, Math.min(24 * 60, patch.intervalMinutes)) }
      : {}),
    ...(patch.folderPrefixes !== undefined ? { folderPrefixes: patch.folderPrefixes } : {}),
  };
  const file = configPath(env);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function guessMime(ext: string): string | undefined {
  const m: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wma": "audio/x-ms-wma",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
  };
  return m[ext.toLowerCase()];
}

async function walkAudioFiles(dirAbs: string, root: string, out: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      await walkAudioFiles(abs, root, out);
      continue;
    }
    if (!ent.isFile() || !isLibraryAudioFilename(ent.name)) continue;
    if (!isPathInsideRoot(abs, root)) continue;
    out.push(abs);
  }
}

function resolveScanRoots(env: Env, folderPrefixes: string[]): string[] {
  const root = mediaRootAbs(env);
  const prefixes =
    folderPrefixes.length > 0
      ? folderPrefixes
      : (() => {
          const uploads = path.join(root, "uploads");
          if (!fs.existsSync(uploads)) return ["uploads"];
          const subs = fs
            .readdirSync(uploads, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => `uploads/${d.name}`);
          return subs.length > 0 ? subs : ["uploads"];
        })();

  return prefixes.map((p) => absPathForMediaPrefix(env, p.replace(/\\/g, "/")));
}

/** Escanea carpetas vigiladas y registra pistas nuevas ya presentes en la bóveda. */
export async function runLibraryAutoUpdateScan(env: Env): Promise<{
  config: LibraryAutoUpdateConfig;
  result: LibraryAutoUpdateLastResult;
}> {
  const config = await loadLibraryAutoUpdateConfig(env);
  const roots = resolveScanRoots(env, config.folderPrefixes);
  const mediaRoot = mediaRootAbs(env);
  const absFiles: string[] = [];
  for (const r of roots) {
    await walkAudioFiles(r, mediaRoot, absFiles);
  }

  const result: LibraryAutoUpdateLastResult = {
    scanned: absFiles.length,
    created: 0,
    skippedExisting: 0,
    errors: 0,
  };

  for (const abs of absFiles) {
    const storedRel = relativeToMediaRoot(abs, env).split(path.sep).join("/");
    const existing = await prisma.mediaAsset.findFirst({ where: { path: storedRel } });
    if (existing) {
      result.skippedExisting += 1;
      continue;
    }
    try {
      const base = path.basename(abs, path.extname(abs));
      const { artist, title } = splitArtistTitleFromBasename(base);
      let asset = await prisma.mediaAsset.create({
        data: {
          title,
          artist,
          path: storedRel,
          mimeType: guessMime(path.extname(abs)),
        },
      });
      asset = await enrichMediaAssetFromAudioFile(prisma, env, asset);
      result.created += 1;
    } catch (err) {
      result.errors += 1;
      if (!result.errorSample) {
        result.errorSample = err instanceof Error ? err.message : "Error al importar";
      }
    }
  }

  const updated: LibraryAutoUpdateConfig = {
    ...config,
    lastRunAt: new Date().toISOString(),
    lastResult: result,
  };
  const file = configPath(env);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(updated, null, 2), "utf8");
  return { config: updated, result };
}

export function libraryAutoUpdateIsDue(config: LibraryAutoUpdateConfig, now = Date.now()): boolean {
  if (!config.enabled) return false;
  if (!config.lastRunAt) return true;
  const last = Date.parse(config.lastRunAt);
  if (Number.isNaN(last)) return true;
  return now - last >= config.intervalMinutes * 60_000;
}

export async function runLibraryAutoUpdateTick(env: Env): Promise<void> {
  const config = await loadLibraryAutoUpdateConfig(env);
  if (!libraryAutoUpdateIsDue(config)) return;

  const run = async () => {
    const fresh = await loadLibraryAutoUpdateConfig(env);
    if (!libraryAutoUpdateIsDue(fresh)) return;
    await runLibraryAutoUpdateScan(env);
  };

  if (isSqliteDatabaseUrl()) {
    await run();
    return;
  }

  // xact lock: el lock/unlock de sesión con pool de Prisma puede caer en
  // conexiones distintas y dejar el candado tomado para siempre.
  const lockId = 915_000_042;
  await prisma.$transaction(
    async (tx) => {
      const got = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${lockId}) AS locked`;
      if (!got?.[0]?.locked) return;
      await run();
    },
    { maxWait: 5_000, timeout: 3_600_000 },
  );
}

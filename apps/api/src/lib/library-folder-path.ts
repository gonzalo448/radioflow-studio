import fs from "node:fs";
import path from "node:path";
import sanitize from "sanitize-filename";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { isPathInsideRoot, mediaRootAbs } from "./media-path.js";

/** Nombre visible de carpeta → segmento seguro bajo `uploads/`. */
export function sanitizeLibraryFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 48) return null;
  const safe = sanitize(trimmed.replace(/\s+/g, " ").replace(/\//g, "-"));
  if (!safe || safe === "." || safe === "..") return null;
  return safe;
}

/** Prefijo relativo a MEDIA_ROOT, p. ej. `uploads/salsa`. */
export function pathPrefixForFolderName(name: string): string | null {
  const seg = sanitizeLibraryFolderName(name);
  if (!seg) return null;
  return `uploads/${seg}`;
}

export function resolveUploadDirPrefix(raw: string | undefined): string {
  if (!raw?.trim()) return "uploads";
  const norm = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (norm === "uploads" || norm === "uploads/") return "uploads";
  if (norm.startsWith("uploads/")) {
    const rest = norm.slice("uploads/".length).split("/").filter(Boolean)[0] ?? "";
    const seg = sanitizeLibraryFolderName(rest);
    return seg ? `uploads/${seg}` : "uploads";
  }
  const seg = sanitizeLibraryFolderName(norm);
  return seg ? `uploads/${seg}` : "uploads";
}

export function absPathForMediaPrefix(env: Env, relPrefix: string): string {
  const root = mediaRootAbs(env);
  const abs = path.resolve(root, relPrefix.replace(/\//g, path.sep));
  if (!isPathInsideRoot(abs, root)) {
    throw new Error("Ruta de carpeta no permitida");
  }
  return abs;
}

export async function ensureMediaSubdir(env: Env, relPrefix: string): Promise<void> {
  const abs = absPathForMediaPrefix(env, relPrefix);
  await fs.promises.mkdir(abs, { recursive: true });
}

export type LibraryFolderRow = { name: string; count: number };

/** Carpetas bajo `uploads/` (en disco y/o con pistas en BD). Sin tope artificial de filas. */
export async function listUploadLibraryFolders(env: Env): Promise<LibraryFolderRow[]> {
  const root = mediaRootAbs(env);
  const uploadsRoot = path.join(root, "uploads");
  const map = new Map<string, number>();

  const PAGE = 5000;
  let cursor: string | undefined;
  for (;;) {
    const pathRows = await prisma.mediaAsset.findMany({
      where: {
        path: { startsWith: "uploads/" },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, path: true },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    if (pathRows.length === 0) break;
    for (const { path: p } of pathRows) {
      const norm = p.replace(/\\/g, "/");
      const parts = norm.split("/").filter(Boolean);
      if (parts[0] !== "uploads") continue;
      if (parts.length <= 2) {
        map.set("uploads", (map.get("uploads") ?? 0) + 1);
      } else {
        const key = `uploads/${parts[1]}`;
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    cursor = pathRows[pathRows.length - 1]!.id;
    if (pathRows.length < PAGE) break;
  }

  try {
    if (fs.existsSync(uploadsRoot)) {
      for (const ent of fs.readdirSync(uploadsRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const key = `uploads/${ent.name}`;
        if (!map.has(key)) map.set(key, 0);
      }
    }
  } catch {
    /* ignore */
  }

  const loose = map.get("uploads") ?? 0;
  const rows: LibraryFolderRow[] = [];
  if (loose > 0) rows.push({ name: "uploads", count: loose });

  for (const [name, count] of map.entries()) {
    if (name === "uploads") continue;
    rows.push({ name, count });
  }

  rows.sort((a, b) => {
    if (a.name === "uploads") return -1;
    if (b.name === "uploads") return 1;
    return b.count - a.count || folderDisplayName(a.name).localeCompare(folderDisplayName(b.name), "es");
  });

  return rows;
}

export function folderDisplayName(pathPrefix: string): string {
  if (pathPrefix === "uploads") return "General (uploads)";
  if (pathPrefix.startsWith("uploads/")) return pathPrefix.slice("uploads/".length);
  return pathPrefix;
}

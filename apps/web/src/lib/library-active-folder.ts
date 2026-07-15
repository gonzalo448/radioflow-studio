import type { ApiLibraryFolderRow } from "@radioflow/shared";

const STORAGE_KEY = "radioflow_active_folder";

/** Carpetas de la biblioteca del usuario (incluye «General» si hay pistas sueltas en uploads/). */
export function userLibraryFolders(rows: ApiLibraryFolderRow[]): ApiLibraryFolderRow[] {
  return rows.filter((f) => f.name === "uploads" || f.name.startsWith("uploads/"));
}

export function getStoredActiveFolder(): string | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY)?.trim();
    if (!v || v === "uploads") return null;
    return v;
  } catch {
    return null;
  }
}

export function setStoredActiveFolder(pathPrefix: string | null): void {
  try {
    if (!pathPrefix || pathPrefix === "uploads") sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, pathPrefix);
  } catch {
    /* private mode */
  }
}

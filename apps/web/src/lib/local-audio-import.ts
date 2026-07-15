import type { ApiLibraryImportLocalFilesResult } from "@radioflow/shared";
import { apiFetch } from "./api";
import { apiUrl } from "./api-base";
import { filesFromAbsolutePaths, isRadioflowDesktop } from "./desktop-native";

/** Extensiones de audio habituales en radio (insumo música / jingles / comerciales). */
export const LOCAL_AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|flac|ogg|opus|wma|aif|aiff)$/i;

export const DND_LOCAL_AUDIO_MIME = "application/x-radioflow-local-audio";

/** Arrastre desde el explorador de disco de la app de escritorio (rutas absolutas). */
export const DND_NATIVE_PATHS_MIME = "application/x-radioflow-native-paths";

/** La librería cambió (subidas, borrados, etc.); escuchan Cabina y Librería. */
export const LIBRARY_CHANGED_EVENT = "radioflow:library-changed";

/** Pedir refresco de cola / estado de estación (p. ej. tras encolar tras importar). */
export const STATION_REFRESH_EVENT = "radioflow:station-request-refresh";

/** Iniciar reproducción en cabina (p. ej. tras encolar la primera pista). */
export const STATION_PLAY_REQUEST_EVENT = "radioflow:station-request-play";

export function notifyStationPlay(): void {
  window.dispatchEvent(new Event(STATION_PLAY_REQUEST_EVENT));
}

export type LibraryImportSummary = {
  ids: string[];
  imported: number;
  skipped: number;
  errors: string[];
};

export function notifyLibraryChanged(): void {
  window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
}

export function notifyStationRefresh(): void {
  window.dispatchEvent(new Event(STATION_REFRESH_EVENT));
}

export function isLocalAudioFile(f: File): boolean {
  return LOCAL_AUDIO_EXT_RE.test(f.name);
}

export async function uploadFileToLibrary(
  token: string,
  file: File,
  opts?: { folderPathPrefix?: string },
): Promise<{ id: string }> {
  const body = new FormData();
  body.append("file", file);
  if (opts?.folderPathPrefix?.trim()) {
    body.append("folder", opts.folderPathPrefix.trim());
  }
  const r = await fetch(apiUrl("/api/library/upload"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  if (!j.id) throw new Error("Respuesta de subida inválida");
  return { id: j.id };
}

/** Subidas en paralelo por lotes para no saturar el servidor. */
export async function uploadManyToLibrary(
  token: string,
  files: File[],
  opts?: {
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    folderPathPrefix?: string;
  },
): Promise<string[]> {
  const conc = Math.max(1, Math.min(opts?.concurrency ?? 4, 8));
  const ids: string[] = new Array(files.length);
  let next = 0;
  let done = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const { id } = await uploadFileToLibrary(token, files[i], {
        folderPathPrefix: opts?.folderPathPrefix,
      });
      ids[i] = id;
      done += 1;
      opts?.onProgress?.(done, files.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(conc, files.length) }, () => worker()));
  notifyLibraryChanged();
  return ids;
}

async function uploadPathsViaApiRoute(
  token: string,
  paths: string[],
  folder: string | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<LibraryImportSummary> {
  const batchSize = 500;
  const ids: string[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 0; i < paths.length; i += batchSize) {
    const chunk = paths.slice(i, i + batchSize);
    const result = await apiFetch<ApiLibraryImportLocalFilesResult>("/api/library/import-local-files", {
      method: "POST",
      token,
      body: JSON.stringify({
        paths: chunk,
        folder: folder || undefined,
      }),
    });
    ids.push(...result.ids);
    skipped += result.skipped ?? 0;
    if (result.errors?.length) errors.push(...result.errors);
    onProgress?.(Math.min(i + chunk.length, paths.length), paths.length);
  }

  return { ids, imported: ids.length, skipped, errors };
}

async function uploadPathsViaElectronMain(
  token: string,
  paths: string[],
  folder: string | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<LibraryImportSummary> {
  const upload = window.radioflow?.nativeFs?.uploadPathsToLibrary;
  if (!upload) return { ids: [], imported: 0, skipped: 0, errors: [] };

  const batchSize = 500;
  const ids: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < paths.length; i += batchSize) {
    const chunk = paths.slice(i, i + batchSize);
    const result = await upload({ paths: chunk, folder, token });
    ids.push(...(result.ids ?? []));
    if (result.errors?.length) errors.push(...result.errors);
    onProgress?.(Math.min(i + chunk.length, paths.length), paths.length);
  }

  if (!ids.length && errors.length) {
    throw new Error(errors[0] ?? "No se pudo copiar la música a la librería");
  }

  return { ids, imported: ids.length, skipped: 0, errors };
}

/** Copia archivos desde rutas absolutas del disco (app instalada). */
export async function importNativePathsToLibrary(
  token: string,
  paths: string[],
  opts?: {
    folderPathPrefix?: string;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<LibraryImportSummary> {
  if (!paths.length) return { ids: [], imported: 0, skipped: 0, errors: [] };

  const folder = opts?.folderPathPrefix?.trim() || undefined;

  if (isRadioflowDesktop()) {
    try {
      const summary = await uploadPathsViaApiRoute(token, paths, folder, opts?.onProgress);
      if (summary.imported > 0 || summary.errors.length === 0) {
        notifyLibraryChanged();
        return summary;
      }
      if (summary.errors.length) {
        console.warn("[radioflow] importación API parcial:", summary.errors);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!/not found|404/i.test(msg)) throw err;
    }

    if (window.radioflow?.nativeFs?.uploadPathsToLibrary) {
      const summary = await uploadPathsViaElectronMain(token, paths, folder, opts?.onProgress);
      notifyLibraryChanged();
      return summary;
    }
  }

  const files = (await filesFromAbsolutePaths(paths)).filter(isLocalAudioFile);
  if (!files.length) {
    throw new Error("No se pudieron leer los archivos de audio seleccionados.");
  }
  const ids = await uploadManyToLibrary(token, files, opts);
  return { ids, imported: ids.length, skipped: paths.length - ids.length, errors: [] };
}

export function formatImportSummaryMessage(summary: LibraryImportSummary, totalPaths: number): string {
  const parts = [`Importadas ${summary.imported} de ${totalPaths} pista(s)`];
  if (summary.skipped > 0) parts.push(`${summary.skipped} omitidas`);
  if (summary.errors.length > 0) parts.push(`${summary.errors.length} error(es)`);
  return `${parts.join(" · ")}. Los metadatos se completan en segundo plano.`;
}

import type { ApiLibraryAsset, ApiLibraryAssetsCount, ApiLibraryListQuery } from "@radioflow/shared";
import { apiFetch } from "./api";

/** Página visual de la librería: pocas filas en DOM para no congelar la app. */
export const LIBRARY_UI_PAGE_SIZE = 150;

/** Página para paneles de búsqueda / jingles (no hace falta más). */
export const LIBRARY_PICKER_PAGE_SIZE = 120;

export type FetchLibraryAssetsOpts = Omit<ApiLibraryListQuery, "take" | "skip"> & {
  token?: string | null;
  take?: number;
  skip?: number;
  signal?: AbortSignal;
};

export type LibraryAssetsPage<T extends ApiLibraryAsset = ApiLibraryAsset> = {
  items: T[];
  total: number;
  take: number;
  skip: number;
};

function buildParams(
  filters: Omit<ApiLibraryListQuery, "take" | "skip">,
  take: number,
  skip: number,
): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.genre?.trim()) params.set("genre", filters.genre.trim());
  if (filters.artist?.trim()) params.set("artist", filters.artist.trim());
  if (filters.album?.trim()) params.set("album", filters.album.trim());
  if (filters.pathPrefix?.trim()) params.set("pathPrefix", filters.pathPrefix.trim());
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  params.set("take", String(take));
  if (skip > 0) params.set("skip", String(skip));
  return params.toString();
}

function buildCountParams(filters: Omit<ApiLibraryListQuery, "take" | "skip">): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.genre?.trim()) params.set("genre", filters.genre.trim());
  if (filters.artist?.trim()) params.set("artist", filters.artist.trim());
  if (filters.album?.trim()) params.set("album", filters.album.trim());
  if (filters.pathPrefix?.trim()) params.set("pathPrefix", filters.pathPrefix.trim());
  return params.toString();
}

/**
 * Una sola página de pistas. Nunca descarga el catálogo completo
 * (eso bloqueaba Electron con miles de filas).
 */
export async function fetchLibraryAssets<T extends ApiLibraryAsset = ApiLibraryAsset>(
  opts: FetchLibraryAssetsOpts = {},
): Promise<T[]> {
  const { token, take = LIBRARY_UI_PAGE_SIZE, skip = 0, signal, ...filters } = opts;
  const params = buildParams(filters, take, skip);
  return apiFetch<T[]>(`/api/library/assets?${params}`, { token, signal });
}

/** Página + total coincidente (para paginador y contadores de carpeta/filtro). */
export async function fetchLibraryAssetsPage<T extends ApiLibraryAsset = ApiLibraryAsset>(
  opts: FetchLibraryAssetsOpts = {},
): Promise<LibraryAssetsPage<T>> {
  const { token, take = LIBRARY_UI_PAGE_SIZE, skip = 0, signal, ...filters } = opts;
  const listParams = buildParams(filters, take, skip);
  const countParams = buildCountParams(filters);
  const items = await apiFetch<T[]>(`/api/library/assets?${listParams}`, { token, signal });
  let total = skip + items.length;
  try {
    const count = await apiFetch<ApiLibraryAssetsCount>(`/api/library/assets/count?${countParams}`, {
      token,
      signal,
    });
    total = count.total;
  } catch {
    // Sin endpoint de conteo (API antigua): si la página viene llena, asumimos que hay más.
    if (items.length >= take) total = skip + items.length + 1;
  }
  return { items, total, take, skip };
}

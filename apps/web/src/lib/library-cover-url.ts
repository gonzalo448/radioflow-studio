import { apiUrl } from "./api-base";

/** URL de carátula con bust de caché según `coverPath` en BD. */
export function libraryCoverUrl(assetId: string, coverPath?: string | null): string | null {
  if (!coverPath?.trim()) return null;
  const base = apiUrl(`/api/library/assets/${encodeURIComponent(assetId)}/cover`);
  const token = coverPath.replace(/\\/g, "/").split("/").pop() ?? coverPath;
  return `${base}?v=${encodeURIComponent(token)}`;
}

import type { DragEvent } from "react";

/** Arrastre desde la tabla de Librería hacia Cabina (cola de emisión). */
export const DND_LIBRARY_ASSET_MIME = "application/x-radioflow-library-asset";

export type LibraryAssetDragPayload = {
  assetIds: string[];
};

export function setLibraryAssetDrag(e: DragEvent, assetIds: string[]): void {
  if (assetIds.length === 0) return;
  const payload: LibraryAssetDragPayload = { assetIds };
  const json = JSON.stringify(payload);
  try {
    e.dataTransfer.setData(DND_LIBRARY_ASSET_MIME, json);
  } catch {
    /* ignore */
  }
  e.dataTransfer.setData("text/plain", json);
  e.dataTransfer.effectAllowed = "copy";
}

export function parseLibraryAssetDrag(e: DragEvent): string[] | null {
  let raw = "";
  try {
    raw = e.dataTransfer.getData(DND_LIBRARY_ASSET_MIME);
  } catch {
    /* ignore */
  }
  if (!raw) raw = e.dataTransfer.getData("text/plain");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as LibraryAssetDragPayload;
    if (!Array.isArray(j.assetIds) || !j.assetIds.every((id) => typeof id === "string" && id.length > 0)) {
      return null;
    }
    return j.assetIds;
  } catch {
    return null;
  }
}

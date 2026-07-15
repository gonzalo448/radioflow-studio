export const PL_ITEMS_TAB_DND = "application/x-radioflow-pl-items";

export type PlItemsTabDragPayload = {
 sourcePlaylistId: string;
 itemIds: string[];
};

export function setPlItemsTabDrag(e: React.DragEvent, payload: PlItemsTabDragPayload): void {
 e.dataTransfer.setData(PL_ITEMS_TAB_DND, JSON.stringify(payload));
 e.dataTransfer.effectAllowed = "move";
}

export function parsePlItemsTabDrag(e: React.DragEvent): PlItemsTabDragPayload | null {
 let raw = "";
 try {
 raw = e.dataTransfer.getData(PL_ITEMS_TAB_DND);
 } catch {
 return null;
 }
 if (!raw) return null;
 try {
 const j = JSON.parse(raw) as PlItemsTabDragPayload;
 if (!j.sourcePlaylistId || !Array.isArray(j.itemIds) || j.itemIds.length === 0) return null;
 return j;
 } catch {
 return null;
 }
}

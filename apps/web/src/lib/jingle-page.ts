export const JINGLE_PAGE_STORAGE_KEY = "radioflow_jingle_active_page";
export const JINGLE_PAGES = ["A", "B", "C"] as const;
export type JinglePageKey = (typeof JINGLE_PAGES)[number];

export function readActiveJinglePage(): JinglePageKey {
  try {
    const p = localStorage.getItem(JINGLE_PAGE_STORAGE_KEY)?.trim().toUpperCase();
    if (p === "A" || p === "B" || p === "C") return p;
  } catch {
    /* ignore */
  }
  return "A";
}

export function writeActiveJinglePage(page: JinglePageKey): void {
  try {
    localStorage.setItem(JINGLE_PAGE_STORAGE_KEY, page);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("radioflow-jingle-page"));
}

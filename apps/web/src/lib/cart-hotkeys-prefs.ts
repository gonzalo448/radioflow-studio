const STORAGE_KEY = "radioflow_cart_browser_hotkeys";

/** Teclas 1–0 del cart wall en el navegador (fuera de /jingles). */
export function loadCartBrowserHotkeysEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function saveCartBrowserHotkeysEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new CustomEvent("radioflow-cart-browser-hotkeys"));
}

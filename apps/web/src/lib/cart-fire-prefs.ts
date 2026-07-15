/** Preferencia: cart wall corta lo al aire (playNow) vs encola tras la pista (playNext). */
const STORAGE_KEY = "radioflow_cart_fire_play_now";

/** Default C5: inmediato (sensación RadioBOSS). */
export function loadCartFirePlayNow(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function saveCartFirePlayNow(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new CustomEvent("radioflow-cart-fire-mode"));
}

export type CartFireEventDetail = {
  ok: boolean;
  slotKey: string;
  pageKey: string;
  label?: string;
  playNow?: boolean;
  error?: string;
  source?: "hotkey" | "page";
};

export function emitCartFireEvent(detail: CartFireEventDetail): void {
  window.dispatchEvent(new CustomEvent("radioflow-cart-fired", { detail }));
}

export function emitJingleSlotsChanged(): void {
  window.dispatchEvent(new CustomEvent("radioflow-jingle-slots-changed"));
}

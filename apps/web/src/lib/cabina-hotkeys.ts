export type CabinaHotkeyAction =
  | "play_pause"
  | "skip"
  | "mute_dock"
  | "mode_auto"
  | "mode_live_assist"
  | "mode_live"
  | "cart_page_prev"
  | "cart_page_next";

export type CabinaHotkeyConfig = Record<CabinaHotkeyAction, string>;

const STORAGE_KEY = "radioflow_cabina_hotkeys_v2";

export const DEFAULT_CABINA_HOTKEYS: CabinaHotkeyConfig = {
  play_pause: "Space",
  skip: "KeyN",
  mute_dock: "KeyM",
  mode_auto: "",
  mode_live_assist: "",
  mode_live: "",
  cart_page_prev: "BracketLeft",
  cart_page_next: "BracketRight",
};

export const CABINA_HOTKEY_LABELS: Record<CabinaHotkeyAction, string> = {
  play_pause: "Reproducir / pausar referencia",
  skip: "Siguiente en cabina",
  mute_dock: "Silenciar / activar referencia (dock)",
  mode_auto: "Modo AUTO",
  mode_live_assist: "Modo LIVE ASSIST",
  mode_live: "Modo LIVE",
  cart_page_prev: "Cart wall — página anterior (A←B←C)",
  cart_page_next: "Cart wall — página siguiente (A→B→C)",
};

export function loadCabinaHotkeys(): CabinaHotkeyConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem("radioflow_cabina_hotkeys_v1");
    if (!raw) return { ...DEFAULT_CABINA_HOTKEYS };
    const j = JSON.parse(raw) as Partial<CabinaHotkeyConfig>;
    return { ...DEFAULT_CABINA_HOTKEYS, ...j };
  } catch {
    return { ...DEFAULT_CABINA_HOTKEYS };
  }
}

export function saveCabinaHotkeys(config: CabinaHotkeyConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function captureKeyCode(e: KeyboardEvent): string | null {
  if (e.key === "Escape" || e.key === "Tab") return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return e.code || null;
}

export function hotkeyDisplay(code: string): string {
  if (!code) return "—";
  if (code === "Space") return "Espacio";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  return code;
}

export function eventMatchesHotkey(e: KeyboardEvent, code: string): boolean {
  if (!code) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.code === code;
}

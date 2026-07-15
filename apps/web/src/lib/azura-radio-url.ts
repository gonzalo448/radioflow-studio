import { isDesktopShell } from "./desktop-product";

/** URL del reproductor web (PWA) para abrir en el navegador del sistema. */
export function azuraRadioBrowserUrl(): string {
  if (typeof window !== "undefined" && (window.location.protocol === "http:" || window.location.protocol === "https:")) {
    const origin = window.location.origin;
    return isDesktopShell() ? `${origin}/#/radio` : `${origin}/radio`;
  }
  return "http://127.0.0.1:5173/#/radio";
}

export async function openAzuraRadioInBrowser(): Promise<void> {
  const url = azuraRadioBrowserUrl();
  const open = window.radioflow?.shell?.openExternal;
  if (open) {
    await open(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

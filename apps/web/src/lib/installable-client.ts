import { isDesktopProduct } from "./desktop-product";
import { isRadioflowDesktop } from "./desktop-native";

/**
 * RadioFlow Studio se distribuye como aplicación instalable (Electron).
 * El panel en navegador solo se permite en CI/desarrollo explícito (`VITE_ALLOW_WEB_PANEL`).
 */
export function isInstallableRuntime(): boolean {
  return isRadioflowDesktop();
}

export function allowsWebPanel(): boolean {
  return import.meta.env.VITE_ALLOW_WEB_PANEL === "true";
}

/** true → mostrar pantalla «Instala la aplicación» en lugar del producto completo. */
export function shouldShowInstallGate(): boolean {
  if (allowsWebPanel()) return false;
  if (isInstallableRuntime()) return false;
  return true;
}

export function isInstallableProductBuild(): boolean {
  return isDesktopProduct();
}

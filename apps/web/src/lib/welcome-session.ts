const WELCOME_KEY = "radioflow_welcome_ok";

/** Marca la bienvenida como vista en esta sesión de la app (Electron). */
export function markWelcomeSeen(): void {
  try {
    sessionStorage.setItem(WELCOME_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function isWelcomeSeen(): boolean {
  try {
    return sessionStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    return false;
  }
}

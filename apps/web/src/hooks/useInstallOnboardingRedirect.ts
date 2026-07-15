import { useAuth } from "../auth/AuthContext";
import { useSetupStatus } from "../hooks/useSetupStatus";
import { isDesktopProduct } from "../lib/desktop-product";
import { isWelcomeSeen } from "../lib/welcome-session";

export type OnboardingRedirect = "loading" | "/bienvenida" | "/login" | "/configuracion" | "/station" | null;
export function useInstallOnboardingRedirect(pathname: string): OnboardingRedirect {
  const { user, token } = useAuth();
  const { loading, needsAccount } = useSetupStatus();
  const embedded = isDesktopProduct();
  const hasSession = Boolean(user || token);

  if (!embedded) return null;
  if (loading) return "loading";

  if (pathname === "/bienvenida" || pathname === "/listen" || pathname === "/radio") return null;

  if (pathname === "/configuracion") {
    if (!needsAccount) return hasSession ? "/station" : "/login";
    return null;
  }

  if (pathname === "/login") {
    if (needsAccount) return "/bienvenida";
    if (hasSession) return "/station";
    return null;
  }

  if (hasSession) return null;

  if (!isWelcomeSeen()) return "/bienvenida";

  if (needsAccount) return "/configuracion";

  return "/login";
}

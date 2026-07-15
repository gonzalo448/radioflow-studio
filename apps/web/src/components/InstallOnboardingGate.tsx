import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { RoutePageFallback } from "./RoutePageFallback";
import { useInstallOnboardingRedirect } from "../hooks/useInstallOnboardingRedirect";

export function InstallOnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const redirect = useInstallOnboardingRedirect(location.pathname);

  if (redirect === "loading") return <RoutePageFallback />;
  if (redirect) return <Navigate to={redirect} replace state={{ from: location }} />;

  return <>{children}</>;
}

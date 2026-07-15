import type { UserRole } from "@radioflow/shared";
import { roleSatisfies } from "@radioflow/shared";
import { isDesktopProduct } from "./desktop-product";

export function stationAccess(
  userRole: UserRole | string | null | undefined,
  allowed: readonly UserRole[],
): boolean {
  if (isDesktopProduct() && userRole) return true;
  return roleSatisfies(userRole, allowed);
}

export function canWriteLibraryAccess(userRole: UserRole | string | null | undefined): boolean {
  return stationAccess(userRole, ["admin", "editor", "dj"]);
}

export function canEditPlaylistsAccess(userRole: UserRole | string | null | undefined): boolean {
  return stationAccess(userRole, ["admin", "editor"]);
}

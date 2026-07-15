import type { AppRole } from "./roles.js";
import { roleSatisfies, ROLES_LIBRARY_WRITE, ROLES_SCHEDULE_WRITE, ROLES_REPORTS_READ } from "./roles.js";

export interface ApiAuthSetupStatus {
  /** true si aún no hay ningún usuario (primer arranque de la app instalada). */
  needsAccount: boolean;
}

export function canWriteLibraryRole(role: AppRole | string | null | undefined): boolean {
  return roleSatisfies(role, ROLES_LIBRARY_WRITE);
}

export function canEditPlaylistsRole(role: AppRole | string | null | undefined): boolean {
  return roleSatisfies(role, ROLES_SCHEDULE_WRITE);
}

export function canReadReportsRole(role: AppRole | string | null | undefined): boolean {
  return roleSatisfies(role, ROLES_REPORTS_READ);
}

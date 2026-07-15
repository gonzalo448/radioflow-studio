/** Rol de usuario en la estación (alineado con Prisma `Role` y `UserRole` del paquete). */
export type AppRole = "admin" | "editor" | "dj" | "viewer" | "operador";

/**
 * Comprueba si un rol puede ejecutar una acción.
 * **admin** tiene acceso a todas las funciones (superusuario de la estación).
 */
export function roleSatisfies(
  userRole: AppRole | string | null | undefined,
  allowed: readonly AppRole[],
): boolean {
  if (!userRole) return false;
  if (userRole === "admin") return true;
  return allowed.includes(userRole as AppRole);
}

export const ROLES_STATION_WRITE: AppRole[] = ["admin", "editor", "dj"];
export const ROLES_SCHEDULE_WRITE: AppRole[] = ["admin", "editor"];
export const ROLES_PROGRAMACION_DELETE: AppRole[] = ["admin"];
export const ROLES_STREAMING_WRITE: AppRole[] = ["admin", "editor"];
export const ROLES_LIBRARY_WRITE: AppRole[] = ["admin", "editor", "dj"];
export const ROLES_REPORTS_READ: AppRole[] = ["admin", "editor", "dj", "operador", "viewer"];

export function canWriteLibrary(role: AppRole | string | null | undefined): boolean {
  return roleSatisfies(role, ROLES_LIBRARY_WRITE);
}

export function canEditPlaylists(role: AppRole | string | null | undefined): boolean {
  return roleSatisfies(role, ROLES_SCHEDULE_WRITE);
}

export function canEditSchedule(role: AppRole | string | null | undefined): boolean {
  return roleSatisfies(role, ROLES_SCHEDULE_WRITE);
}

export function canReadReports(role: AppRole | string | null | undefined): boolean {
  return roleSatisfies(role, ROLES_REPORTS_READ);
}

export function isAdminRole(role: AppRole | string | null | undefined): boolean {
  return role === "admin";
}

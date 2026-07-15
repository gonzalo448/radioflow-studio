/**
 * Alias de migración CRA: `import { authFetch } from "../utils/authFetch"`.
 * La implementación vive en `lib/api` (refresh, `apiUrl`, redirección a login).
 */
export { authFetch, clearStoredAuth, hardRedirectToLogin } from "../lib/api";

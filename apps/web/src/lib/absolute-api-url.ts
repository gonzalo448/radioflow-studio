import { apiOrigin, apiUrl } from "./api-base";

/** URL absoluta para copiar/pegar en Liquidsoap; en proxy Vite usa el origen del navegador. */
export function absoluteApiUrl(path: string): string {
 const u = apiUrl(path);
 if (u.startsWith("http://") || u.startsWith("https://")) return u;
 const origin = apiOrigin;
 if (origin) return `${origin}${u.startsWith("/") ? u : `/${u}`}`;
 return new URL(u, typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4000").href;
}

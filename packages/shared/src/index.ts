export type UserRole = "admin" | "editor" | "dj" | "viewer";

export interface ApiHealth {
  status: "ok" | "degraded";
  version: string;
  uptimeSeconds: number;
}

/** Listo para recibir tráfico (p. ej. orquestadores / balanceadores). Incluye comprobación de BD. */
export interface ApiReadiness {
  ready: boolean;
  database: "ok" | "down";
  version: string;
}

export interface MediaAssetStub {
  id: string;
  title: string;
  durationSec?: number;
  path?: string;
}

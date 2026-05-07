export type UserRole = "admin" | "editor" | "dj" | "viewer";

export interface ApiHealth {
  status: "ok" | "degraded";
  version: string;
  uptimeSeconds: number;
}

export interface MediaAssetStub {
  id: string;
  title: string;
  durationSec?: number;
  path?: string;
}

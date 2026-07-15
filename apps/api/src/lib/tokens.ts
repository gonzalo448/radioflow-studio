import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Env } from "../config.js";

export type AccessTokenPayload = {
  sub: string;
  /** Mismo valor que `sub` — útil para clientes que leen `payload.id`. */
  id: string;
  /** Rol del usuario en el token (clientes legacy usan `rol`). */
  rol: string;
};

export function signAccessToken(env: Env, userId: string, role: string): string {
  const payload: AccessTokenPayload = { sub: userId, id: userId, rol: role };
  const expiresInSec = Math.max(1, Math.floor(parseTtlToMs(env.JWT_ACCESS_TTL) / 1000));
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: expiresInSec });
}

export function newRefreshToken(): string {
  // 256 bits de entropía
  return crypto.randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function parseTtlToMs(ttl: string): number {
  const m = /^(\d+)\s*([smhd])$/i.exec(ttl.trim());
  if (!m) throw new Error("TTL inválido; usa formato 15m/30d/3600s");
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}


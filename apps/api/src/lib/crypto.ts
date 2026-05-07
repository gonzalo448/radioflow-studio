import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const SALT_LEN = 16;
const KEY_LEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derivedKey = (await scryptAsync(plain, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const derivedKey = (await scryptAsync(plain, salt, KEY_LEN)) as Buffer;
  if (expected.length !== derivedKey.length) return false;
  return timingSafeEqual(expected, derivedKey);
}

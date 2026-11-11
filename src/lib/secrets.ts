// PINs and resume tokens, using only Node's built-in crypto.
import { randomInt, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** A 6-digit PIN for driver sign-in. Never stored in plain text. */
export function newPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 32);
  return "scrypt$" + salt.toString("hex") + "$" + key.toString("hex");
}
export function checkSecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;
  const key = scryptSync(secret, Buffer.from(saltHex, "hex"), 32);
  const want = Buffer.from(keyHex, "hex");
  return want.length === key.length && timingSafeEqual(key, want);
}
/** Lets a browser resume its own draft registration without an account. */
export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "../db";
import type { Role } from "./rules";

// Order Angel · who is signed in.
// A stand-in until Tillotson ID: a signed cookie holding the account id. The pick-an-account sign-in page
// only exists for local testing (ORDER_ANGEL_DEV_SIGNIN=1, or not in production). In production, without
// Tillotson ID connected, nobody can sign in, so nothing is exposed by accident.

export interface Viewer { id: string; name: string; email: string; role: Role; dealerId: string | null; dealerName: string | null }

const COOKIE = "oa_account";
export const devSignInAllowed = () => process.env.ORDER_ANGEL_DEV_SIGNIN === "1" || process.env.NODE_ENV !== "production";

function secret() {
  const s = process.env.ORDER_ANGEL_SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("ORDER_ANGEL_SESSION_SECRET is not set");
  return "order-angel-local-development-only";
}
const sign = (id: string) => createHmac("sha256", secret()).update(id).digest("base64url");

export async function currentViewer(): Promise<Viewer | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig) return null;
  const a = Buffer.from(sign(id)), b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [v] = await sql`
    select a.id, a.name, a.email, a.role, a.dealer_id, d.name as dealer_name
    from oa_accounts a left join oa_dealers d on d.id = a.dealer_id
    where a.id = ${id} and a.active`;
  return v ? { id: v.id, name: v.name, email: v.email, role: v.role, dealerId: v.dealer_id, dealerName: v.dealer_name } : null;
}

export async function signInAs(accountId: string) {
  (await cookies()).set(COOKIE, `${accountId}.${sign(accountId)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}
export async function signOut() { (await cookies()).delete(COOKIE); }

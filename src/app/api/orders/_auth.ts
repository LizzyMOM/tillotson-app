import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Scheduled jobs and one-off jobs call with "Authorization: Bearer <CRON_SECRET>" (Vercel Cron sends this itself). */
export function authorised(req: Request): boolean {
  const s = process.env.CRON_SECRET;
  if (!s) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? ""), b = Buffer.from(`Bearer ${s}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

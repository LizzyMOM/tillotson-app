import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadEvent, registrationWindow, type EventInfo } from "@/lib/event";
import { cookieName } from "@/lib/registration";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Loads the event and checks registration is open. */
export async function openEvent(slug: string): Promise<{ ev: EventInfo } | { res: NextResponse }> {
  const ev = await loadEvent(slug);
  if (!ev) return { res: json({ error: "Event not found" }, 404) };
  const w = registrationWindow(ev);
  if (!w.open) return { res: json({ error: w.reason }, 403) };
  return { ev };
}
export async function regCookie(slug: string) {
  return (await cookies()).get(cookieName(slug))?.value;
}
export async function setRegCookie(slug: string, value: string) {
  (await cookies()).set(cookieName(slug), value, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90,
  });
}

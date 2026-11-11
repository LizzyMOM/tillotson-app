import { loadEvent } from "@/lib/event";
import { sql } from "@/lib/db";
import { completePayment, ownedRegistrationId } from "@/lib/registration";
import { testPaymentsAllowed } from "@/lib/payments";
import { json, regCookie } from "../_common";

/** Development only: pretends the card payment succeeded. Refused whenever Stripe is set up or in production. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!testPaymentsAllowed()) return json({ error: "Test payments are switched off" }, 403);
  const { slug } = await params;
  const ev = await loadEvent(slug);
  if (!ev) return json({ error: "Event not found" }, 404);
  const id = await ownedRegistrationId(ev, await regCookie(slug));
  if (!id) return json({ error: "Registration not found" }, 404);
  const [r] = await sql`select status, total_cents from registrations where id = ${id}`;
  if (r.status !== "awaiting_payment" && r.status !== "paid") return json({ error: "Finish the registration first" }, 400);
  await completePayment(id, "test", "test-" + id, r.total_cents, ev.currency);
  return Response.redirect(new URL(`/e/${slug}/done`, req.url), 303);
}

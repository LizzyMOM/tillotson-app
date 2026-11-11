import { stripe } from "@/lib/payments";
import { completePayment } from "@/lib/registration";

/** Stripe tells us here when a payment has really gone through. This, not the browser, completes a registration. */
export async function POST(req: Request) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return new Response("Stripe not configured", { status: 503 });
  const sig = req.headers.get("stripe-signature");
  let event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), sig ?? "", process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response("Bad signature", { status: 400 });
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object;
    if (s.payment_status === "paid" && s.metadata?.registration_id) {
      await completePayment(s.metadata.registration_id, "stripe", s.id, s.amount_total ?? 0, s.currency ?? "");
    }
  }
  return new Response("ok");
}

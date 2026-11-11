import "server-only";
import Stripe from "stripe";
import type { EventInfo } from "./event";

export const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
// Test payments only when Stripe isn't set up, and only in development or when ALLOW_TEST_PAYMENTS=1 (local testing, never live).
export const testPaymentsAllowed = () => !stripe && (process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_PAYMENTS === "1");
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Where to send the driver to pay. The amount is always the total the server worked out. */
export async function checkoutUrl(ev: EventInfo, registrationId: string, totalCents: number, email: string, driverName: string): Promise<string> {
  if (!stripe) {
    if (!testPaymentsAllowed()) throw new Error("Payments are not set up: add STRIPE_SECRET_KEY");
    return `/e/${ev.slug}/pay-test`;
  }
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    client_reference_id: registrationId,
    metadata: { registration_id: registrationId, event: ev.slug },
    payment_intent_data: { metadata: { registration_id: registrationId, event: ev.slug } },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: ev.currency.toLowerCase(),
        unit_amount: totalCents,
        product_data: { name: `${ev.name} registration`, description: `${driverName}. Includes the refundable breakage deposit.` },
      },
    }],
    success_url: `${appUrl()}/e/${ev.slug}/done?paid=1`,
    cancel_url: `${appUrl()}/e/${ev.slug}/register?step=review`,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
  });
  return session.url!;
}

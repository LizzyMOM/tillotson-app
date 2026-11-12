import { authorised } from "../_auth";
import { importOpenOrders } from "@/lib/orders/service";
import { wooConfigured } from "@/lib/orders/woo";

/** One-off: bring every open website order into Order Angel at Submitted, for triage. Safe to run again. */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response("Unauthorised", { status: 401 });
  if (!wooConfigured()) return new Response("WooCommerce not configured", { status: 503 });
  return Response.json(await importOpenOrders());
}

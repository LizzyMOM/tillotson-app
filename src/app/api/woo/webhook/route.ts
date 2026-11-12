import { sql } from "@/lib/db";
import { validSignature, type WooOrder } from "@/lib/orders/woo-map";
import { upsertFromWoo } from "@/lib/orders/service";

/**
 * WooCommerce calls this when an order is created or updated (set up two webhooks, topics
 * "Order created" and "Order updated", both pointing here, with the secret in WOO_WEBHOOK_SECRET).
 */
export async function POST(req: Request) {
  const secret = process.env.WOO_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const raw = await req.text();
  const topic = req.headers.get("x-wc-webhook-topic");
  // When a webhook is first saved, WooCommerce sends a ping ("webhook_id=12") to check the address works.
  if (!topic && /^webhook_id=\d+$/.test(raw.trim())) return new Response("ok");
  if (!validSignature(raw, req.headers.get("x-wc-webhook-signature"), secret)) return new Response("Bad signature", { status: 401 });
  if (topic !== "order.created" && topic !== "order.updated") return new Response("ignored");

  const delivery = req.headers.get("x-wc-webhook-delivery-id");
  if (delivery) {
    const r = await sql`insert into oa_webhook_deliveries (delivery_id, topic) values (${delivery}, ${topic}) on conflict do nothing returning delivery_id`;
    if (!r.length) return new Response("already handled");
  }
  let order: WooOrder;
  try { order = JSON.parse(raw); } catch { return new Response("Bad body", { status: 400 }); }
  if (!order?.id || !Array.isArray(order.line_items)) return new Response("Not an order", { status: 400 });
  try {
    await upsertFromWoo(order, "webhook");
  } catch (e) {
    // Let WooCommerce retry: forget the delivery so the retry is handled.
    if (delivery) await sql`delete from oa_webhook_deliveries where delivery_id = ${delivery}`;
    console.error("Order Angel webhook failed", e);
    return new Response("Failed", { status: 500 });
  }
  return new Response("ok");
}

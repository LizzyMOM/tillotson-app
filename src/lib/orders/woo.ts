import "server-only";
import type { WooOrder } from "./woo-map";

// Order Angel · talking to the Tillotson website's WooCommerce REST API (v3).
// Needs WOO_URL, WOO_KEY and WOO_SECRET (a read/write key made in WooCommerce → Settings → Advanced → REST API).
// Without them the app still runs: changes are kept in the app only, which is how local testing works.

export const wooConfigured = () => Boolean(process.env.WOO_URL && process.env.WOO_KEY && process.env.WOO_SECRET);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = process.env.WOO_URL!.replace(/\/$/, "");
  const auth = Buffer.from(`${process.env.WOO_KEY}:${process.env.WOO_SECRET}`).toString("base64");
  const res = await fetch(`${base}/wp-json/wc/v3${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text).message ?? msg; } catch {}
    throw new Error(`WooCommerce ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export const getOrder = (id: number) => call<WooOrder>("GET", `/orders/${id}`);

/** Every order still open on the website, for the first import (100 per page). */
export async function openOrders(): Promise<WooOrder[]> {
  const all: WooOrder[] = [];
  for (let page = 1; page < 50; page++) {
    const batch = await call<WooOrder[]>("GET", `/orders?status=pending,on-hold,processing&per_page=100&page=${page}&orderby=date&order=asc`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/**
 * Update an order. Line items: quantity 0 removes one, a line without an id adds one.
 * order_angel_recalculate asks the small helper plugin on the website (wordpress/order-angel-helper.php)
 * to recalculate tax and totals afterwards, which the REST API doesn't do on its own for an update.
 */
export function updateOrder(id: number, patch: { status?: string; line_items?: Record<string, unknown>[]; meta_data?: { key: string; value: string }[] }) {
  return call<WooOrder>("PUT", `/orders/${id}`, { ...patch, ...(patch.line_items ? { order_angel_recalculate: true } : {}) });
}

/** A private note on the order in WooCommerce (not emailed to the customer). */
export const addNote = (id: number, note: string) => call("POST", `/orders/${id}/notes`, { note, customer_note: false });

export interface WooProduct { id: number; name: string; sku: string; price: string }
/** Look a part up by its SKU, for adding a line to an order. */
export async function productBySku(sku: string): Promise<WooProduct | null> {
  const r = await call<WooProduct[]>("GET", `/products?sku=${encodeURIComponent(sku)}`);
  if (r[0]) return r[0];
  // variations aren't returned by /products?sku in every WooCommerce version; search them too
  const v = await call<WooProduct[]>("GET", `/products?sku=${encodeURIComponent(sku)}&type=variation`).catch(() => []);
  return v[0] ?? null;
}

/** A reorder: a new on-hold order for the same dealer, no payment taken (same as ordering on the website). */
export function createOrder(customerId: number, lines: { product_id?: number | null; sku?: string | null; quantity: number }[], note: string, addr: { billing?: unknown; shipping?: unknown }) {
  return call<WooOrder>("POST", `/orders`, {
    customer_id: customerId, status: "on-hold", set_paid: false, customer_note: note,
    ...(addr.billing ? { billing: addr.billing } : {}), ...(addr.shipping ? { shipping: addr.shipping } : {}),
    line_items: lines.map((l) => (l.product_id ? { product_id: l.product_id, quantity: l.quantity } : { sku: l.sku, quantity: l.quantity })),
    meta_data: [{ key: "order_angel_source", value: "reorder" }],
  });
}

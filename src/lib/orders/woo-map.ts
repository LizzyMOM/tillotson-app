// Order Angel · reading what WooCommerce sends. No database or network here, so it can be tested on its own.
import { createHmac, timingSafeEqual } from "node:crypto";

/** WooCommerce signs each webhook: base64 HMAC-SHA256 of the raw body with the webhook's secret. */
export function validSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface WooItem { id: number; product_id?: number; variation_id?: number; name: string; sku?: string; quantity: number; total: string; subtotal?: string; price?: number }
export interface WooAddress { first_name?: string; last_name?: string; company?: string; address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string; country?: string; email?: string; phone?: string }
export interface WooOrder {
  id: number; number?: string; status: string; currency?: string; customer_id?: number; customer_note?: string;
  date_created_gmt?: string; date_modified_gmt?: string; total?: string; total_tax?: string;
  billing?: WooAddress; shipping?: WooAddress; line_items?: WooItem[];
}

export interface MappedItem { wooItemId: number; wooProductId: number | null; sku: string | null; name: string; qty: number; unitPriceCents: number; totalCents: number }
export interface MappedOrder {
  wooOrderId: number; number: string; status: string; currency: string; customerId: number | null;
  dealerName: string; dealerEmail: string | null; dealerCountry: string | null;
  orderedAt: Date; modifiedAt: Date | null; totalCents: number; taxCents: number;
  shipping: WooAddress | null; billing: WooAddress | null; dealerNote: string | null; items: MappedItem[];
}

const cents = (v: string | number | undefined) => Math.round(Number(v ?? 0) * 100) || 0;
/** Woo's *_gmt dates have no zone marker; they are UTC. */
const gmt = (v?: string) => (v ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + "Z") : null);

export function mapWooOrder(o: WooOrder): MappedOrder {
  const b = o.billing ?? {};
  const person = [b.first_name, b.last_name].filter(Boolean).join(" ");
  const items = (o.line_items ?? []).filter((i) => i.quantity > 0).map((i): MappedItem => {
    const totalCents = cents(i.total);
    return {
      wooItemId: i.id, wooProductId: (i.variation_id || i.product_id) || null, sku: i.sku?.trim() || null, name: i.name,
      qty: i.quantity, unitPriceCents: Math.round(totalCents / i.quantity), totalCents,
    };
  });
  return {
    wooOrderId: o.id, number: String(o.number ?? o.id), status: o.status, currency: (o.currency ?? "EUR").toUpperCase(),
    customerId: o.customer_id || null,
    dealerName: b.company?.trim() || person || b.email || `Customer ${o.customer_id ?? "unknown"}`,
    dealerEmail: b.email ?? null, dealerCountry: b.country ?? null,
    orderedAt: gmt(o.date_created_gmt) ?? new Date(), modifiedAt: gmt(o.date_modified_gmt),
    totalCents: cents(o.total), taxCents: cents(o.total_tax),
    shipping: o.shipping && Object.values(o.shipping).some(Boolean) ? o.shipping : null,
    billing: o.billing && Object.values(o.billing).some(Boolean) ? o.billing : null,
    dealerNote: o.customer_note?.trim() || null, items,
  };
}

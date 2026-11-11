import "server-only";
import { cache } from "react";
import { sql } from "./db";
import type { EventSetup } from "./rules";

export interface EventInfo {
  id: string;
  slug: string;
  name: string;
  venue: string | null;
  country: string;
  startsOn: string;
  endsOn: string;
  currency: string;
  status: "draft" | "open" | "closed" | "archived";
  opensAt: string | null;
  closesAt: string | null;
  brand: { primary?: string; accent?: string; logo_text?: string; logo_url?: string };
  texts: Record<string, string>;
  hostFederation: string | null;
  setup: EventSetup;
  tickets: { id: string; name: string; priceCents: number; includes: string[]; excludes: string[]; note: string | null; includesKart: boolean }[];
  products: { id: string; kind: string; name: string; description: string | null; priceCents: number; sizes: string[]; maxQty: number; bundleGroup: string | null; refundable: boolean }[];
}

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));

/** Everything the registration needs about one event, from its slug. */
export const loadEvent = cache(async (slug: string): Promise<EventInfo | null> => {
  const [e] = await sql`
    select e.*, f.name as host_name from events e left join federations f on f.id = e.host_federation_id
    where e.slug = ${slug} and e.status <> 'archived'`;
  if (!e) return null;
  const [cats, tix, prods, bundles, feds] = await Promise.all([
    sql`select id, name, min_age, max_age from categories where event_id = ${e.id} order by sort_order, name`,
    sql`select * from tickets where event_id = ${e.id} and active order by sort_order, name`,
    sql`select * from products where event_id = ${e.id} and active order by sort_order, name`,
    sql`select bundle_group, name, discount_pct from bundles where event_id = ${e.id}`,
    sql`select id, name, country, start_permission from federations where organiser_id = ${e.organiser_id} and active order by name`,
  ]);
  const tickets = tix.map((t) => ({
    id: t.id, name: t.name, priceCents: t.price_cents, includes: t.includes, excludes: t.excludes, note: t.note,
    includesKart: t.includes_kart, categoryIds: t.category_ids as string[] | null,
  }));
  const products = prods.map((p) => ({
    id: p.id, kind: p.kind, name: p.name, description: p.description, priceCents: p.price_cents, sizes: p.sizes,
    maxQty: p.max_qty, bundleGroup: p.bundle_group, refundable: p.refundable,
  }));
  return {
    id: e.id, slug: e.slug, name: e.name, venue: e.venue, country: e.country,
    startsOn: iso(e.starts_on), endsOn: iso(e.ends_on), currency: e.currency, status: e.status,
    opensAt: e.registration_opens_at?.toISOString() ?? null, closesAt: e.registration_closes_at?.toISOString() ?? null,
    brand: e.brand, texts: e.texts, hostFederation: e.host_name,
    tickets, products,
    setup: {
      startsOn: iso(e.starts_on),
      hostFederationId: e.host_federation_id,
      depositCents: e.deposit_cents,
      teeSizes: e.tee_sizes,
      seatSizes: e.seat_sizes,
      categories: cats.map((c) => ({ id: c.id, name: c.name, minAge: c.min_age, maxAge: c.max_age })),
      tickets: tickets.map(({ id, name, priceCents, includesKart, categoryIds }) => ({ id, name, priceCents, includesKart, categoryIds })),
      products: products.map(({ id, kind, name, priceCents, sizes, maxQty, bundleGroup }) => ({ id, kind: kind as "rental" | "clothing" | "other", name, priceCents, sizes, maxQty, bundleGroup })),
      bundles: bundles.map((b) => ({ bundleGroup: b.bundle_group, name: b.name, discountPct: Number(b.discount_pct) })),
      federations: feds.map((f) => ({ id: f.id, name: f.name, country: f.country, startPermission: f.start_permission })),
    },
  };
});

export type RegistrationWindow = { open: true } | { open: false; reason: string };
export function registrationWindow(ev: EventInfo, now = new Date()): RegistrationWindow {
  const fmt = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  if (ev.status !== "open") return { open: false, reason: "Registration isn't open for this event." };
  if (ev.opensAt && now < new Date(ev.opensAt)) return { open: false, reason: `Registration opens on ${fmt(ev.opensAt)}.` };
  if (ev.closesAt && now > new Date(ev.closesAt)) return { open: false, reason: `Registration closed on ${fmt(ev.closesAt)}.` };
  return { open: true };
}

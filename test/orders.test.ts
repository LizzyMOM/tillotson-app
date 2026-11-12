import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { can, flagFor, receivedDue, diffLines, wooLineItems, cleanEdit, toCents, stageFromWoo, wooStatusFor, DEFAULT_SETTINGS as S, type Ctx, type Line } from "../src/lib/orders/rules.ts";
import { validSignature, mapWooOrder } from "../src/lib/orders/woo-map.ts";

const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 9));   // 1 Nov 2026 + n days, 09:00 UTC
const ctx = (role: Ctx["role"], stage: Ctx["stage"], extra: Partial<Ctx> = {}): Ctx => ({ role, stage, pendingProposal: false, ownOrder: true, ...extra });

test("who can do what", () => {
  assert.ok(can("verify", ctx("admin", "submitted")));
  assert.ok(!can("verify", ctx("factory", "submitted")), "Shane doesn't verify");
  assert.ok(!can("verify", ctx("admin", "submitted", { pendingProposal: true })), "can't verify while the dealer is approving an edit");
  assert.ok(can("dealer_decide", ctx("dealer", "submitted", { pendingProposal: true })));
  assert.ok(!can("dealer_decide", ctx("dealer", "submitted", { pendingProposal: true, ownOrder: false })), "not another dealer's order");
  assert.ok(can("start", ctx("factory", "verified")));
  assert.ok(!can("start", ctx("factory", "submitted")), "Shane can't start an unverified order");
  assert.ok(can("add_shipment", ctx("factory", "in_progress")));
  assert.ok(can("invoice", ctx("factory", "shipped")));
  assert.ok(can("receive", ctx("dealer", "shipped")));
  assert.ok(!can("receive", ctx("dealer", "in_progress")));
  assert.ok(!can("cancel", ctx("dealer", "submitted")), "dealers can't cancel: phone or email");
  assert.ok(can("cancel", ctx("admin", "in_progress")));
  assert.ok(!can("cancel", ctx("admin", "shipped")));
  assert.ok(!can("internal_message", ctx("dealer", "submitted")));
  assert.ok(can("internal_message", ctx("factory", "submitted")));
  assert.ok(!can("message", ctx("dealer", "submitted", { ownOrder: false })));
});

test("flag after 14 days in one stage, per stage", () => {
  const o = { stage: "verified" as const, stageSince: day(0), eta: null };
  assert.equal(flagFor(o, S, day(13)).flagged, false);
  assert.equal(flagFor(o, S, day(14)).flagged, false, "exactly 14 days is the limit, not over it");
  const f = flagFor(o, S, day(15));
  assert.equal(f.flagged, true);
  assert.equal(f.reason, "15 days at Verified");
  // moving stage restarts the clock
  assert.equal(flagFor({ ...o, stage: "in_progress", stageSince: day(15) }, S, day(20)).flagged, false);
});

test("a delay notice with a new date holds the flag until that date passes", () => {
  const o = { stage: "in_progress" as const, stageSince: day(0), eta: "2026-11-30" };
  assert.equal(flagFor(o, S, day(20)).flagged, false, "day 21 but the new date is 30 Nov");
  assert.equal(flagFor(o, S, new Date("2026-11-30T22:00:00Z")).flagged, false, "still on the due day");
  const f = flagFor(o, S, new Date("2026-12-01T08:00:00Z"));
  assert.equal(f.flagged, true);
  assert.match(f.reason!, /Past the new estimated date \(30 Nov 2026\)/);
  // an estimated date sooner than the 14 days doesn't shorten the allowance
  assert.equal(flagFor({ ...o, eta: "2026-11-05" }, S, day(10)).flagged, false);
});

test("received and cancelled are never flagged; the number of days is a setting", () => {
  assert.equal(flagFor({ stage: "received", stageSince: day(0), eta: null }, S, day(90)).flagged, false);
  assert.equal(flagFor({ stage: "cancelled", stageSince: day(0), eta: null }, S, day(90)).flagged, false);
  assert.equal(flagFor({ stage: "submitted", stageSince: day(0), eta: null }, { ...S, flagDays: 7 }, day(8)).flagged, true);
});

test("received reminders every 3 days, auto-close at 30", () => {
  const o = { stage: "shipped" as const, stageSince: day(0), eta: null, lastReminderAt: null };
  assert.equal(receivedDue(o, S, day(2)), null);
  assert.equal(receivedDue(o, S, day(3)), "remind");
  assert.equal(receivedDue({ ...o, lastReminderAt: day(3) }, S, day(5)), null);
  assert.equal(receivedDue({ ...o, lastReminderAt: day(3) }, S, day(6)), "remind");
  assert.equal(receivedDue({ ...o, lastReminderAt: day(29) }, S, day(30)), "auto_close");
  assert.equal(receivedDue({ ...o, stage: "received" }, S, day(40)), null);
});

const before: Line[] = [
  { wooItemId: 11, wooProductId: 501, sku: "T4-ENG", name: "T4 engine", qty: 2, unitPriceCents: 150000 },
  { wooItemId: 12, wooProductId: 502, sku: "CHAIN-219", name: "Chain 219", qty: 10, unitPriceCents: 2500 },
  { wooItemId: 13, wooProductId: 503, sku: "PLUG-B9", name: "Spark plug", qty: 5, unitPriceCents: 900 },
];

test("an edit: what changed, and the WooCommerce update it becomes", () => {
  const after: Line[] = [
    before[0],                                                  // unchanged
    { ...before[1], qty: 6 },                                   // fewer chains
    { ...before[2], qty: 0 },                                   // plug removed
    { wooItemId: null, wooProductId: 777, sku: "PLUG-B10", name: "Spark plug B10", qty: 5, unitPriceCents: 950 },  // replacement
  ];
  const d = diffLines(before, after);
  assert.equal(d.unchanged.length, 1);
  assert.deepEqual(d.changed.map((c) => c.after.qty), [6]);
  assert.deepEqual(d.removed.map((r) => r.sku), ["PLUG-B9"]);
  assert.deepEqual(d.added.map((a) => a.sku), ["PLUG-B10"]);
  assert.deepEqual(wooLineItems(before, after), [
    { id: 13, quantity: 0 },
    { id: 12, quantity: 6, subtotal: "150.00", total: "150.00" },
    { product_id: 777, quantity: 5, subtotal: "47.50", total: "47.50" },
  ]);
  // a line missing from the proposal altogether is removed too
  assert.deepEqual(wooLineItems(before, before.slice(0, 2)), [{ id: 13, quantity: 0 }]);
  // a new part with no product id found is added by SKU
  assert.deepEqual(wooLineItems([], [{ sku: "X-1", name: "X", qty: 1, unitPriceCents: 100 }]), [{ sku: "X-1", quantity: 1, subtotal: "1.00", total: "1.00" }]);
});

test("cleaning an edit form", () => {
  const ok = cleanEdit([
    { wooItemId: 11, sku: "T4-ENG", name: "T4 engine", qty: 2, unitPriceCents: 150000 },
    { wooItemId: null, sku: "", name: "", qty: 0, unitPriceCents: 0 },            // empty add-row ignored
    { wooItemId: null, sku: " NEW-1 ", name: "", qty: 3, unitPriceCents: 500 },
  ]);
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.lines.map((l) => [l.sku, l.name]), [["T4-ENG", "T4 engine"], ["NEW-1", "NEW-1"]]);
  assert.match(cleanEdit([{ wooItemId: null, sku: null, name: "Mystery part", qty: 1, unitPriceCents: 100 }]).error!, /part number/);
  assert.match(cleanEdit([{ wooItemId: 11, sku: "A", name: "A", qty: 0, unitPriceCents: 100 }]).error!, /Cancel order/);
  assert.match(cleanEdit([{ wooItemId: 11, sku: "A", name: "A", qty: 1.5, unitPriceCents: 100 }]).error!, /quantity/);
});

test("prices and WooCommerce statuses", () => {
  assert.equal(toCents("12.50"), 1250);
  assert.equal(toCents("€1 500,5"), 150050);
  assert.equal(toCents("7"), 700);
  assert.ok(Number.isNaN(toCents("abc")));
  assert.equal(stageFromWoo("on-hold"), "submitted");
  assert.equal(stageFromWoo("processing"), "submitted", "old orders are triaged from the start");
  assert.equal(stageFromWoo("completed"), "shipped");
  assert.equal(stageFromWoo("cancelled"), "cancelled");
  assert.equal(wooStatusFor("in_progress"), "processing");
  assert.equal(wooStatusFor("shipped"), "completed");
  assert.equal(wooStatusFor("submitted"), null);
});

test("WooCommerce webhook signature", () => {
  const body = JSON.stringify({ id: 5 });
  const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
  assert.ok(validSignature(body, sig, "s3cret"));
  assert.ok(!validSignature(body + " ", sig, "s3cret"), "a changed body fails");
  assert.ok(!validSignature(body, sig, "other"), "the wrong secret fails");
  assert.ok(!validSignature(body, null, "s3cret"));
});

test("reading a WooCommerce order", () => {
  const m = mapWooOrder({
    id: 4321, number: "4321", status: "on-hold", currency: "eur", customer_id: 101, customer_note: " Please ship with the frames ",
    date_created_gmt: "2026-11-10T09:15:00", date_modified_gmt: "2026-11-10T09:16:00", total: "3245.00", total_tax: "0.00",
    billing: { first_name: "Sam", last_name: "Dealer", company: "Demo Karting UK", email: "orders@demo-uk.example.com", country: "GB" },
    shipping: { address_1: "", city: "" },
    line_items: [
      { id: 11, product_id: 501, name: "T4 engine", sku: "T4-ENG", quantity: 2, total: "3000.00" },
      { id: 12, product_id: 502, variation_id: 9502, name: "Chain 219 · 106 links", sku: "CHAIN-219", quantity: 10, total: "245.00" },
    ],
  });
  assert.equal(m.dealerName, "Demo Karting UK");
  assert.equal(m.currency, "EUR");
  assert.equal(m.orderedAt.toISOString(), "2026-11-10T09:15:00.000Z");
  assert.equal(m.totalCents, 324500);
  assert.equal(m.shipping, null, "an empty address is no address");
  assert.equal(m.dealerNote, "Please ship with the frames");
  assert.deepEqual(m.items.map((i) => [i.wooProductId, i.unitPriceCents, i.totalCents]), [[501, 150000, 300000], [9502, 2450, 24500]]);
});

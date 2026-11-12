import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "../db";
import { sendMail } from "../mail";
import { putFile } from "../storage";
import { money } from "../brand";
import {
  can, flagFor, receivedDue, diffLines, wooLineItems, cleanEdit, toCents, stageFromWoo, wooStatusFor, linesTotal, fmtDate,
  ARCHIVED, STAGE_LABEL, DEFAULT_SETTINGS, type Action, type Stage, type Line, type Flag, type Settings,
} from "./rules";
import { mapWooOrder, type WooOrder, type MappedItem } from "./woo-map";
import * as woo from "./woo";
import type { Viewer } from "./session";

// Order Angel · everything that reads or changes an order. Every action checks rules.can() first,
// writes in one transaction, then (after it commits) sends notifications and updates WooCommerce.

type Q = typeof sql;
type After = (() => Promise<void>)[];
export class OrderError extends Error {}

// ---------------------------------------------------------------- settings and people
export async function settings(): Promise<Settings & { shopUrl: string | null }> {
  const [s] = await sql`select * from oa_settings`;
  if (!s) return { ...DEFAULT_SETTINGS, shopUrl: null };
  return { flagDays: s.flag_days, receivedReminderDays: s.received_reminder_days, autoCloseDays: s.auto_close_days, shopUrl: s.shop_url };
}
export const accountsForSignIn = () =>
  sql`select a.id, a.name, a.role, d.name as dealer_name from oa_accounts a left join oa_dealers d on d.id = a.dealer_id where a.active order by a.role, a.name`;

type To = "admins" | "factory" | "dealer";
async function people(q: Q, to: To[], dealerId: string): Promise<{ id: string; email: string }[]> {
  const roles = to.filter((t) => t !== "dealer");
  return q`
    select id, email from oa_accounts
    where active and (role::text = any(${roles.map((r) => (r === "admins" ? "admin" : "factory"))})
      ${to.includes("dealer") ? q`or (role = 'dealer' and dealer_id = ${dealerId})` : q``})` as unknown as Promise<{ id: string; email: string }[]>;
}

const orderLink = (id: string) => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/orders/${id}`;

/** Notify people in the app, and by email once the transaction has committed. Never the person who did it. */
async function notify(q: Q, after: After, o: { id: string; dealerId: string; number: string }, to: To[], title: string, body: string, actorId?: string | null) {
  const list = (await people(q, to, o.dealerId)).filter((p) => p.id !== actorId);
  for (const p of list) {
    const [n] = await q`insert into oa_notifications (account_id, order_id, title, body) values (${p.id}, ${o.id}, ${title}, ${body}) returning id`;
    after.push(async () => {
      try {
        await sendMail({ to: p.email, subject: `${title} · Order Angel`, text: `${body}\n\nOpen the order: ${orderLink(o.id)}\n\nOrder Angel · Tillotson` });
        await sql`update oa_notifications set emailed_at = now() where id = ${n.id}`;
      } catch (e) { console.error("Order Angel email failed", e); }
    });
  }
}
const log = (q: Q, orderId: string, actorId: string | null, action: string, detail?: Record<string, unknown>) =>
  q`insert into oa_activity (order_id, actor_id, action, detail) values (${orderId}, ${actorId}, ${action}, ${detail ? q.json(detail as never) : null})`;

async function runAfter(after: After) { for (const f of after) await f(); }

// ---------------------------------------------------------------- reading
export interface OrderRow {
  id: string; wooOrderId: number | null; number: string; dealerId: string; dealerName: string; dealerCountry: string | null;
  dealerRegion: string | null; dealerNeedsSetup: boolean; stage: Stage; stageSince: Date; eta: string | null; etaReason: string | null;
  currency: string; totalCents: number; taxCents: number; orderedAt: Date; dealerNote: string | null;
  shipping: Record<string, string> | null; receivedAt: Date | null; receivedAuto: boolean; receivedCondition: string | null; receivedNote: string | null;
  cancelledReason: string | null; invoiceNumber: string | null; invoicedAt: Date | null;
  pendingProposal: boolean; openIssues: number; shipments: number; lastReminderAt: Date | null; itemCount: number; flag: Flag;
}

const ORDER_SELECT = (q: Q) => q`
  select o.*, to_char(o.eta, 'YYYY-MM-DD') as eta_s, d.name as dealer_name, d.country as dealer_country, d.region as dealer_region, d.needs_setup,
    exists (select 1 from oa_proposals p where p.order_id = o.id and p.status = 'pending') as pending_proposal,
    (select count(*)::int from oa_issues i where i.order_id = o.id and i.resolved_at is null) as open_issues,
    (select count(*)::int from oa_shipments s where s.order_id = o.id) as shipment_count,
    (select coalesce(sum(qty), 0)::int from oa_order_items it where it.order_id = o.id) as item_count
  from oa_orders o join oa_dealers d on d.id = o.dealer_id`;

function toRow(r: Record<string, any>, s: Settings, now = new Date()): OrderRow {
  const row: Omit<OrderRow, "flag"> = {
    id: r.id, wooOrderId: r.woo_order_id == null ? null : Number(r.woo_order_id), number: r.number, dealerId: r.dealer_id,
    dealerName: r.dealer_name, dealerCountry: r.dealer_country, dealerRegion: r.dealer_region, dealerNeedsSetup: r.needs_setup,
    stage: r.stage, stageSince: r.stage_since, eta: r.eta_s, etaReason: r.eta_reason, currency: r.currency,
    totalCents: r.total_cents, taxCents: r.tax_cents, orderedAt: r.ordered_at, dealerNote: r.dealer_note, shipping: r.shipping_address,
    receivedAt: r.received_at, receivedAuto: r.received_auto, receivedCondition: r.received_condition, receivedNote: r.received_note,
    cancelledReason: r.cancelled_reason, invoiceNumber: r.invoice_number, invoicedAt: r.invoiced_at,
    pendingProposal: r.pending_proposal, openIssues: r.open_issues, shipments: r.shipment_count, lastReminderAt: r.last_reminder_at,
    itemCount: r.item_count,
  };
  return { ...row, flag: flagFor({ stage: row.stage, stageSince: row.stageSince, eta: row.eta }, s, now) };
}

export type Tab = "open" | "archive";
/**
 * Staff: open = everything Mark and Andrew still have to see through, plus anything flagged; archive = shipped,
 * received, cancelled. Dealers: only their own orders; open = until received.
 */
export async function listOrders(v: Viewer, tab: Tab, f: { q?: string; stage?: Stage | "flagged" } = {}): Promise<OrderRow[]> {
  const s = await settings();
  const search = f.q?.trim() ? `%${f.q.trim().replace(/[%_]/g, "")}%` : null;
  const rows = await sql`
    ${ORDER_SELECT(sql)}
    where true
      ${v.role === "dealer" ? sql`and o.dealer_id = ${v.dealerId}` : sql``}
      ${search ? sql`and (o.number ilike ${search} or d.name ilike ${search} or exists (select 1 from oa_order_items it where it.order_id = o.id and (it.sku ilike ${search} or it.name ilike ${search})))` : sql``}
    order by o.ordered_at asc`;
  const done: Stage[] = v.role === "dealer" ? ["received", "cancelled"] : ARCHIVED;
  let list = rows.map((r) => toRow(r, s));
  list = list.filter((o) => (tab === "archive" ? done.includes(o.stage) && !(v.role !== "dealer" && o.flag.flagged) : !done.includes(o.stage) || (v.role !== "dealer" && o.flag.flagged)));
  if (f.stage === "flagged") list = list.filter((o) => o.flag.flagged);
  else if (f.stage) list = list.filter((o) => o.stage === f.stage);
  if (tab === "archive") list.reverse();   // newest first in the archive
  else list.sort((a, b) => Number(b.flag.flagged) - Number(a.flag.flagged));   // flagged first, then oldest first
  return list;
}

export async function counts(v: Viewer) {
  const open = await listOrders(v, "open");
  const by: Partial<Record<Stage | "flagged" | "all", number>> = { all: open.length, flagged: open.filter((o) => o.flag.flagged).length };
  for (const o of open) by[o.stage] = (by[o.stage] ?? 0) + 1;
  const [u] = await sql`select count(*)::int as n from oa_notifications where account_id = ${v.id} and read_at is null`;
  return { ...by, unread: u.n as number };
}

export async function getOrder(v: Viewer, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const s = await settings();
  const [r] = await sql`${ORDER_SELECT(sql)} where o.id = ${id}`;
  if (!r) return null;
  const order = toRow(r, s);
  if (v.role === "dealer" && order.dealerId !== v.dealerId) return null;
  const staff = v.role !== "dealer";
  const [items, proposals, shipments, issues, messages, activity, files] = await Promise.all([
    sql`select id, woo_item_id, woo_product_id, sku, name, qty, unit_price_cents, total_cents from oa_order_items where order_id = ${id} order by position, name`,
    sql`select p.*, a.name as by_name, b.name as decided_name from oa_proposals p join oa_accounts a on a.id = p.created_by left join oa_accounts b on b.id = p.decided_by where order_id = ${id} order by created_at desc`,
    sql`select s.*, to_char(s.eta, 'YYYY-MM-DD') as eta_s, a.name as by_name from oa_shipments s join oa_accounts a on a.id = s.created_by where order_id = ${id} order by seq`,
    staff ? sql`select i.*, a.name as by_name, b.name as resolved_name from oa_issues i join oa_accounts a on a.id = i.raised_by left join oa_accounts b on b.id = i.resolved_by where order_id = ${id} order by raised_at desc` : Promise.resolve([]),
    sql`select m.*, a.name as author_name, a.role as author_role from oa_messages m left join oa_accounts a on a.id = m.author_id where order_id = ${id} ${staff ? sql`` : sql`and not m.internal`} order by created_at`,
    staff ? sql`select x.*, a.name as actor_name from oa_activity x left join oa_accounts a on a.id = x.actor_id where order_id = ${id} order by at desc, id desc limit 200` : Promise.resolve([]),
    sql`select id, filename, mime, size_bytes, created_at from oa_files where order_id = ${id} order by created_at`,
  ]);
  const lines: (Line & { id: string; totalCents: number })[] = items.map((i) => ({
    id: i.id, wooItemId: i.woo_item_id == null ? null : Number(i.woo_item_id), wooProductId: i.woo_product_id == null ? null : Number(i.woo_product_id),
    sku: i.sku, name: i.name, qty: i.qty, unitPriceCents: i.unit_price_cents, totalCents: i.total_cents,
  }));
  const pending = proposals.find((p) => p.status === "pending") ?? null;
  return {
    order, lines,
    pending: pending ? { id: pending.id as string, byName: pending.by_name as string, createdAt: pending.created_at as Date, note: pending.note as string | null, lines: pending.lines as Line[], diff: diffLines(lines, pending.lines as Line[]) } : null,
    proposals, shipments, issues, messages, activity, files,
    ctx: { role: v.role, stage: order.stage, pendingProposal: order.pendingProposal, ownOrder: v.role !== "dealer" || order.dealerId === v.dealerId },
    shopUrl: s.shopUrl,
  };
}

export async function notifications(v: Viewer) {
  return sql`select n.*, o.number from oa_notifications n left join oa_orders o on o.id = n.order_id where account_id = ${v.id} order by created_at desc limit 50`;
}
export const markRead = (v: Viewer, orderId?: string) =>
  orderId
    ? sql`update oa_notifications set read_at = now() where account_id = ${v.id} and order_id = ${orderId} and read_at is null`
    : sql`update oa_notifications set read_at = now() where account_id = ${v.id} and read_at is null`;

// ---------------------------------------------------------------- the action wrapper
interface Locked { id: string; dealerId: string; number: string; stage: Stage; wooOrderId: number | null; pendingProposal: boolean }

/** Locks the order, checks the person may do this now, runs the change, then the after-commit work. */
async function act<T>(v: Viewer, orderId: string, action: Action, fn: (q: Q, o: Locked, after: After) => Promise<T>): Promise<T> {
  const after: After = [];
  const result = await sql.begin(async (tx) => {
    const q = tx as unknown as Q;
    const [r] = await q`
      select id, dealer_id, number, stage, woo_order_id,
        exists (select 1 from oa_proposals p where p.order_id = oa_orders.id and p.status = 'pending') as pending
      from oa_orders where id = ${orderId} for update`;
    if (!r) throw new OrderError("Order not found");
    const o: Locked = { id: r.id, dealerId: r.dealer_id, number: r.number, stage: r.stage, wooOrderId: r.woo_order_id == null ? null : Number(r.woo_order_id), pendingProposal: r.pending };
    if (!can(action, { role: v.role, stage: o.stage, pendingProposal: o.pendingProposal, ownOrder: v.role !== "dealer" || o.dealerId === v.dealerId }))
      throw new OrderError("That can't be done on this order now. Refresh to see where it's at.");
    return fn(q, o, after);
  });
  await runAfter(after);
  return result as T;
}

async function setStage(q: Q, o: Locked, stage: Stage, actorId: string | null, after: After, detail?: Record<string, unknown>) {
  await q`update oa_orders set stage = ${stage}, stage_since = now() where id = ${o.id}`;
  await log(q, o.id, actorId, `stage:${stage}`, { from: o.stage, ...detail });
  const from = o.stage;
  o.stage = stage;
  const status = wooStatusFor(stage);
  if (status && status !== wooStatusFor(from)) after.push(() => pushToWoo(o, { status, meta_data: [{ key: "order_angel_stage", value: stage }] }));
}

/** Changes made in the app reach the website; a failure is logged on the order, never lost silently. */
async function pushToWoo(o: { id: string; wooOrderId: number | null }, patch: Parameters<typeof woo.updateOrder>[1], note?: string) {
  if (!woo.wooConfigured() || o.wooOrderId == null) return;
  try {
    await woo.updateOrder(o.wooOrderId, patch);
    if (note) await woo.addNote(o.wooOrderId, note);
  } catch (e) {
    await log(sql, o.id, null, "website_update_failed", { error: String((e as Error).message ?? e), patch: patch as never });
  }
}
async function noteToWoo(o: { id: string; wooOrderId: number | null }, note: string) {
  if (!woo.wooConfigured() || o.wooOrderId == null) return;
  try { await woo.addNote(o.wooOrderId, note); } catch (e) { await log(sql, o.id, null, "website_update_failed", { error: String((e as Error).message ?? e), note }); }
}

const n = (o: { number: string }) => `#${o.number}`;

// ---------------------------------------------------------------- 1 · submitted → verified
export function verify(v: Viewer, id: string) {
  return act(v, id, "verify", async (q, o, after) => {
    await setStage(q, o, "verified", v.id, after);
    await notify(q, after, o, ["factory"], `Order ${n(o)} verified`, `Order ${n(o)} has been checked by ${v.name} and is ready to process.`, v.id);
    await notify(q, after, o, ["dealer"], `Order ${n(o)} verified`, `Your order ${n(o)} has been checked and is going into processing.`, v.id);
  });
}

// ---------------------------------------------------------------- edits, approved by the dealer
export interface EditRow { wooItemId: number | null; wooProductId: number | null; sku: string; name: string; qty: number; price: string }

export async function proposeEdit(v: Viewer, id: string, rows: EditRow[], note: string) {
  // Look new parts up on the website first (outside the transaction): name, product and catalogue price.
  const prepared = [];
  for (const r of rows) {
    let unit = r.price.trim() ? toCents(r.price) : NaN;
    if (r.price.trim() && Number.isNaN(unit)) throw new OrderError(`Check the price for ${r.name.trim() || r.sku.trim() || "a line"}`);
    let { wooProductId, name } = r;
    if (r.wooItemId == null && r.sku.trim() && r.qty > 0 && woo.wooConfigured()) {
      const p = await woo.productBySku(r.sku.trim()).catch(() => null);
      if (!p) throw new OrderError(`Part number ${r.sku.trim()} isn't on the website. Check it and try again.`);
      wooProductId = p.id;
      name = name.trim() || p.name;
      if (Number.isNaN(unit) && p.price) unit = Math.round(Number(p.price) * 100);
    }
    if (r.wooItemId == null && !r.sku.trim() && !name.trim()) continue;
    if (Number.isNaN(unit)) throw new OrderError(`Add a price for ${name.trim() || r.sku.trim() || "the new line"}`);
    prepared.push({ wooItemId: r.wooItemId, wooProductId, sku: r.sku, name, qty: r.qty, unitPriceCents: unit });
  }
  const { lines, error } = cleanEdit(prepared);
  if (error) throw new OrderError(error);
  return act(v, id, "propose_edit", async (q, o, after) => {
    const current = (await q`select woo_item_id, woo_product_id, sku, name, qty, unit_price_cents from oa_order_items where order_id = ${o.id}`)
      .map((i) => ({ wooItemId: i.woo_item_id == null ? null : Number(i.woo_item_id), wooProductId: i.woo_product_id == null ? null : Number(i.woo_product_id), sku: i.sku, name: i.name, qty: i.qty, unitPriceCents: i.unit_price_cents }));
    const d = diffLines(current, lines);
    if (!d.added.length && !d.removed.length && !d.changed.length) throw new OrderError("Nothing has changed on the order yet.");
    await q`insert into oa_proposals (order_id, lines, note, created_by) values (${o.id}, ${q.json(lines as never)}, ${note.trim() || null}, ${v.id})`;
    await log(q, o.id, v.id, "edit_sent", { added: d.added.length, removed: d.removed.length, changed: d.changed.length, note: note.trim() || null });
    await notify(q, after, o, ["dealer"], `Please approve changes to order ${n(o)}`,
      `${v.name} has made changes to your order ${n(o)}${note.trim() ? `: ${note.trim()}` : "."} Please check them and press Approve, or send a question back.`, v.id);
  });
}

export function withdrawProposal(v: Viewer, id: string) {
  return act(v, id, "withdraw_proposal", async (q, o) => {
    await q`update oa_proposals set status = 'withdrawn', decided_by = ${v.id}, decided_at = now() where order_id = ${o.id} and status = 'pending'`;
    await log(q, o.id, v.id, "edit_withdrawn");
  });
}

/** The dealer approves (the change is applied, pushed to the website, and the order is verified) or sends a question back. */
export async function dealerDecide(v: Viewer, id: string, decision: "approve" | "query", reply: string) {
  if (decision === "query" && !reply.trim()) throw new OrderError("Write your question or what needs changing.");
  let pushId: string | null = null;
  await act(v, id, "dealer_decide", async (q, o, after) => {
    const [p] = await q`select * from oa_proposals where order_id = ${o.id} and status = 'pending' for update`;
    await q`update oa_proposals set status = ${decision === "approve" ? "approved" : "queried"}, decided_by = ${v.id}, decided_at = now(), dealer_reply = ${reply.trim() || null} where id = ${p.id}`;
    if (reply.trim()) await q`insert into oa_messages (order_id, author_id, body) values (${o.id}, ${v.id}, ${reply.trim()})`;
    if (decision === "query") {
      await log(q, o.id, v.id, "edit_queried", { reply: reply.trim() });
      await notify(q, after, o, ["admins"], `Dealer has a question on order ${n(o)}`, `${v.dealerName ?? v.name} didn't approve the changes yet: "${reply.trim()}"`, v.id);
      return;
    }
    await applyLines(q, o.id, p.lines as Line[]);
    await log(q, o.id, v.id, "edit_approved");
    await notify(q, after, o, ["admins"], `Changes approved on order ${n(o)}`, `${v.dealerName ?? v.name} approved the changes to order ${n(o)}.`, v.id);
    if (o.stage === "submitted") {
      await setStage(q, o, "verified", v.id, after, { via: "dealer approval" });
      await notify(q, after, o, ["factory"], `Order ${n(o)} verified`, `Order ${n(o)} has been changed, approved by the dealer, and is ready to process.`, v.id);
      await notify(q, after, o, ["dealer"], `Order ${n(o)} verified`, `Thanks. Your order ${n(o)} is verified and going into processing.`, v.id);
    } else {
      await notify(q, after, o, ["factory"], `Order ${n(o)} changed`, `The lines on order ${n(o)} have changed (approved by the dealer). Check before packing.`, v.id);
    }
    pushId = p.id;
  });
  if (pushId) await pushProposal(pushId);
}

/** Replaces the order's lines in the app (WooCommerce's own version replaces them again once it answers). */
async function applyLines(q: Q, orderId: string, lines: (Line | MappedItem)[]) {
  await q`delete from oa_order_items where order_id = ${orderId}`;
  let pos = 0, total = 0;
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const t = "totalCents" in l ? l.totalCents : l.qty * l.unitPriceCents;
    total += t;
    await q`insert into oa_order_items (order_id, woo_item_id, woo_product_id, sku, name, qty, unit_price_cents, total_cents, position)
            values (${orderId}, ${l.wooItemId ?? null}, ${l.wooProductId ?? null}, ${l.sku}, ${l.name}, ${l.qty}, ${l.unitPriceCents}, ${t}, ${pos++})`;
  }
  return total;
}

/** Writes an approved edit to WooCommerce, against the website's current lines. Safe to run again after a failure. */
export async function pushProposal(proposalId: string) {
  const [p] = await sql`select p.*, o.woo_order_id, o.id as oid from oa_proposals p join oa_orders o on o.id = p.order_id where p.id = ${proposalId}`;
  if (!p || p.status !== "approved" || p.pushed_at) return;
  if (!woo.wooConfigured() || p.woo_order_id == null) {
    // No website connected (local testing): the app's copy is the order.
    await sql`update oa_orders set total_cents = (select coalesce(sum(total_cents), 0) from oa_order_items where order_id = ${p.oid}) where id = ${p.oid}`;
    return;
  }
  try {
    const current = mapWooOrder(await woo.getOrder(Number(p.woo_order_id)));
    const updated = await woo.updateOrder(Number(p.woo_order_id), { line_items: wooLineItems(current.items, p.lines as Line[]) });
    await woo.addNote(Number(p.woo_order_id), "Order changed in Order Angel and approved by the dealer.");
    await upsertFromWoo(updated, "edit");
    await sql`update oa_proposals set pushed_at = now(), push_error = null where id = ${p.id}`;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await sql`update oa_proposals set push_error = ${msg} where id = ${p.id}`;
    await log(sql, p.oid, null, "website_update_failed", { error: msg, proposal: p.id });
    const [o] = await sql`select id, dealer_id, number from oa_orders where id = ${p.oid}`;
    const after: After = [];
    await notify(sql, after, { id: o.id, dealerId: o.dealer_id, number: o.number }, ["admins"], `Website not updated for order #${o.number}`,
      `The dealer approved the changes, but the website didn't accept them: ${msg}. Open the order and press Try again.`);
    await runAfter(after);
  }
}
export async function retryPush(v: Viewer, proposalId: string) {
  if (v.role !== "admin") throw new OrderError("Only Mark or Andrew can do that.");
  await pushProposal(proposalId);
}

// ---------------------------------------------------------------- 2 · verified → in progress (Shane)
export function start(v: Viewer, id: string) {
  return act(v, id, "start", async (q, o, after) => {
    await setStage(q, o, "in_progress", v.id, after);
    await notify(q, after, o, ["dealer"], `Order ${n(o)} in progress`, `The factory has started on your order ${n(o)}.`, v.id);
  });
}

// ---------------------------------------------------------------- issues and delays
export function raiseIssue(v: Viewer, id: string, body: string) {
  if (!body.trim()) throw new OrderError("Say what the problem is.");
  return act(v, id, "raise_issue", async (q, o, after) => {
    await q`insert into oa_issues (order_id, body, raised_by) values (${o.id}, ${body.trim()}, ${v.id})`;
    await log(q, o.id, v.id, "issue_raised", { body: body.trim() });
    await notify(q, after, o, ["admins"], `Problem on order ${n(o)}`, `${v.name}: ${body.trim()}\n\nTell the dealer with a delay notice if it affects the shipping date.`, v.id);
  });
}

export async function resolveIssue(v: Viewer, issueId: string, resolution: string) {
  const [i] = await sql`select order_id from oa_issues where id = ${issueId} and resolved_at is null`;
  if (!i) throw new OrderError("That problem has already been resolved.");
  return act(v, i.order_id, "resolve_issue", async (q, o, after) => {
    await q`update oa_issues set resolved_at = now(), resolved_by = ${v.id}, resolution = ${resolution.trim() || null} where id = ${issueId}`;
    await log(q, o.id, v.id, "issue_resolved", { resolution: resolution.trim() || null });
    await notify(q, after, o, ["factory"], `Problem resolved on order ${n(o)}`, `${v.name} marked the problem on order ${n(o)} resolved${resolution.trim() ? `: ${resolution.trim()}` : "."}`, v.id);
  });
}

/** Tells the dealer there's a delay, why, and the new estimated shipping date. Holds the overdue flag until that date. */
export function delayNotice(v: Viewer, id: string, eta: string, reason: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eta)) throw new OrderError("Pick the new estimated shipping date.");
  if (eta < new Date().toISOString().slice(0, 10)) throw new OrderError("The new date can't be in the past.");
  if (!reason.trim()) throw new OrderError("Give the dealer a reason for the delay.");
  return act(v, id, "delay_notice", async (q, o, after) => {
    await q`update oa_orders set eta = ${eta}, eta_reason = ${reason.trim()} where id = ${o.id}`;
    const text = `Delay on this order: ${reason.trim()} New estimated shipping date: ${fmtDate(eta)}.`;
    await q`insert into oa_messages (order_id, author_id, body) values (${o.id}, ${v.id}, ${text})`;
    await q`update oa_issues set resolved_at = now(), resolved_by = ${v.id}, resolution = ${"Dealer told: new date " + fmtDate(eta)} where order_id = ${o.id} and resolved_at is null and kind = 'factory'`;
    await log(q, o.id, v.id, "delay_notice", { eta, reason: reason.trim() });
    await notify(q, after, o, ["dealer"], `Delay on order ${n(o)}`, `${reason.trim()}\n\nNew estimated shipping date: ${fmtDate(eta)}.`, v.id);
    await notify(q, after, o, ["factory"], `New date for order ${n(o)}`, `${v.name} told the dealer: ${reason.trim()} New estimated shipping date ${fmtDate(eta)}.`, v.id);
  });
}

// ---------------------------------------------------------------- 3 · shipments → shipped
export interface ShipmentInput { carrier: string; tracking: string; trackingUrl: string; contents: string; eta: string; final: boolean }

export function addShipment(v: Viewer, id: string, s: ShipmentInput) {
  if (!s.carrier.trim() || !s.tracking.trim()) throw new OrderError("Add the carrier and the tracking number.");
  if (s.trackingUrl.trim() && !/^https:\/\/\S+$/i.test(s.trackingUrl.trim())) throw new OrderError("The tracking link should start with https://");
  if (s.eta && !/^\d{4}-\d{2}-\d{2}$/.test(s.eta)) throw new OrderError("Check the estimated delivery date.");
  return act(v, id, "add_shipment", async (q, o, after) => {
    if (o.stage === "verified") await setStage(q, o, "in_progress", v.id, after, { via: "first shipment" });
    const [{ seq }] = await q`select coalesce(max(seq), 0) + 1 as seq from oa_shipments where order_id = ${o.id}`;
    await q`insert into oa_shipments (order_id, seq, carrier, tracking, tracking_url, contents, eta, final, created_by)
            values (${o.id}, ${seq}, ${s.carrier.trim()}, ${s.tracking.trim()}, ${s.trackingUrl.trim() || null}, ${s.contents.trim() || null}, ${s.eta || null}, ${s.final}, ${v.id})`;
    await log(q, o.id, v.id, "shipment_added", { seq, carrier: s.carrier.trim(), tracking: s.tracking.trim(), final: s.final });
    const parcel = s.final && seq === 1 ? "" : ` (parcel ${seq}${s.final ? ", the last one" : ""})`;
    const lines = [`Carrier: ${s.carrier.trim()}`, `Tracking: ${s.tracking.trim()}`, s.trackingUrl.trim() && `Track it: ${s.trackingUrl.trim()}`, s.contents.trim() && `In this parcel: ${s.contents.trim()}`, s.eta && `Estimated delivery: ${fmtDate(s.eta)}`].filter(Boolean).join("\n");
    after.push(() => noteToWoo(o, `Shipped${parcel}. ${s.carrier.trim()} ${s.tracking.trim()}${s.trackingUrl.trim() ? ` ${s.trackingUrl.trim()}` : ""}`));
    if (s.final) {
      await setStage(q, o, "shipped", v.id, after);
      await q`update oa_orders set eta = ${s.eta || null}, eta_reason = null, reminders_sent = 0, last_reminder_at = null where id = ${o.id}`;
      await notify(q, after, o, ["admins", "dealer"], `Order ${n(o)} shipped`, `Order ${n(o)} is on its way${parcel}.\n\n${lines}\n\nDealer: please press Received when it arrives.`, v.id);
    } else {
      await notify(q, after, o, ["admins", "dealer"], `Part of order ${n(o)} shipped`, `Parcel ${seq} of order ${n(o)} is on its way. The rest follows.\n\n${lines}`, v.id);
    }
  });
}

// ---------------------------------------------------------------- 4 · shipped → received (dealer)
export interface ReceivedInput { condition: "ok" | "damaged" | "missing"; note: string; photos: File[] }
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "application/pdf"];

export async function receive(v: Viewer, id: string, r: ReceivedInput) {
  if (!["ok", "damaged", "missing"].includes(r.condition)) throw new OrderError("Say how the order arrived.");
  if (r.condition !== "ok" && !r.note.trim()) throw new OrderError("Tell us what's damaged or missing.");
  const photos = r.photos.filter((f) => f && f.size > 0).slice(0, 8);
  for (const f of photos) {
    if (f.size > 10 * 1024 * 1024) throw new OrderError(`${f.name} is over 10 MB.`);
    if (!PHOTO_TYPES.includes(f.type)) throw new OrderError(`${f.name}: photos (JPG, PNG, HEIC) or PDF only.`);
  }
  // Files are stored before the transaction; if it then fails they are simply unreferenced.
  const stored: { key: string; name: string; mime: string; size: number }[] = [];
  for (const f of photos) {
    const key = `orders/${id}/${randomUUID()}`;
    await putFile(key, new Uint8Array(await f.arrayBuffer()), f.type);
    stored.push({ key, name: f.name.slice(0, 120), mime: f.type, size: f.size });
  }
  return act(v, id, "receive", async (q, o, after) => {
    await setStage(q, o, "received", v.id, after, { condition: r.condition });
    await q`update oa_orders set received_at = now(), received_by = ${v.id}, received_auto = false, received_condition = ${r.condition}, received_note = ${r.note.trim() || null} where id = ${o.id}`;
    for (const f of stored) await q`insert into oa_files (order_id, storage_key, filename, mime, size_bytes, added_by) values (${o.id}, ${f.key}, ${f.name}, ${f.mime}, ${f.size}, ${v.id})`;
    if (r.condition === "ok") {
      await notify(q, after, o, ["admins"], `Order ${n(o)} received`, `${v.dealerName ?? v.name} received order ${n(o)} in good condition.`, v.id);
    } else {
      const what = r.condition === "damaged" ? "Damaged on arrival" : "Items missing";
      await q`insert into oa_issues (order_id, kind, body, raised_by) values (${o.id}, 'received', ${`${what}: ${r.note.trim()}`}, ${v.id})`;
      await notify(q, after, o, ["admins", "factory"], `${what}: order ${n(o)}`, `${v.dealerName ?? v.name}: ${r.note.trim()}${stored.length ? `\n\n${stored.length} photo(s) attached on the order.` : ""}`, v.id);
    }
  });
}

// ---------------------------------------------------------------- cancel and invoice
export function cancel(v: Viewer, id: string, reason: string) {
  if (!reason.trim()) throw new OrderError("Give the reason (e.g. 'Dealer phoned to cancel').");
  return act(v, id, "cancel", async (q, o, after) => {
    await q`update oa_proposals set status = 'withdrawn', decided_by = ${v.id}, decided_at = now() where order_id = ${o.id} and status = 'pending'`;
    await setStage(q, o, "cancelled", v.id, after, { reason: reason.trim() });
    await q`update oa_orders set cancelled_reason = ${reason.trim()} where id = ${o.id}`;
    await notify(q, after, o, ["dealer", "factory"], `Order ${n(o)} cancelled`, `Order ${n(o)} has been cancelled: ${reason.trim()}`, v.id);
  });
}

export function setInvoice(v: Viewer, id: string, number: string) {
  return act(v, id, "invoice", async (q, o, after) => {
    const num = number.trim().slice(0, 60);
    await q`update oa_orders set invoice_number = ${num || null}, invoiced_at = ${num ? q`now()` : null}, invoiced_by = ${num ? v.id : null} where id = ${o.id}`;
    await log(q, o.id, v.id, num ? "invoiced" : "invoice_cleared", num ? { invoice: num } : undefined);
    if (num) after.push(() => pushToWoo(o, { meta_data: [{ key: "order_angel_invoice", value: num }] }));
  });
}

// ---------------------------------------------------------------- messages
export function postMessage(v: Viewer, id: string, body: string, internal: boolean) {
  if (!body.trim()) throw new OrderError("Write a message first.");
  if (body.length > 4000) throw new OrderError("That message is too long.");
  return act(v, id, internal ? "internal_message" : "message", async (q, o, after) => {
    await q`insert into oa_messages (order_id, author_id, body, internal) values (${o.id}, ${v.id}, ${body.trim()}, ${internal})`;
    const short = body.trim().length > 300 ? body.trim().slice(0, 300) + "…" : body.trim();
    if (v.role === "dealer") await notify(q, after, o, ["admins"], `Message on order ${n(o)}`, `${v.dealerName ?? v.name}: ${short}`, v.id);
    else if (internal) await notify(q, after, o, ["admins", "factory"], `Staff note on order ${n(o)}`, `${v.name}: ${short}`, v.id);
    else await notify(q, after, o, ["dealer"], `Message on order ${n(o)}`, `${v.name} (Tillotson): ${short}`, v.id);
  });
}

// ---------------------------------------------------------------- reorder
export async function reorder(v: Viewer, fromId: string, qtys: Map<string, number>): Promise<string> {
  const d = await getOrder(v, fromId);
  if (!d || !(v.role === "dealer" || v.role === "admin")) throw new OrderError("Order not found");
  const lines = d.lines.map((l) => ({ ...l, qty: qtys.get(l.id) ?? 0 })).filter((l) => l.qty > 0);
  if (!lines.length) throw new OrderError("Choose at least one part to reorder.");
  if (lines.some((l) => !Number.isInteger(l.qty) || l.qty > 9999)) throw new OrderError("Check the quantities.");
  const [src] = await sql`select o.shipping_address, o.billing_address, d.woo_customer_id from oa_orders o join oa_dealers d on d.id = o.dealer_id where o.id = ${fromId}`;
  if (woo.wooConfigured() && src.woo_customer_id != null) {
    const created = await woo.createOrder(Number(src.woo_customer_id), lines.map((l) => ({ product_id: l.wooProductId, sku: l.sku, quantity: l.qty })),
      `Reorder of #${d.order.number} from Order Angel`, { billing: src.billing_address, shipping: src.shipping_address });
    return (await upsertFromWoo(created, "reorder", v.id)).id;
  }
  // No website connected (local testing): make the order in the app only.
  const after: After = [];
  const newId = await sql.begin(async (tx) => {
    const q = tx as unknown as Q;
    const [o] = await q`insert into oa_orders (number, dealer_id, currency, shipping_address, billing_address, dealer_note)
      values (${"R" + Date.now().toString().slice(-6)}, ${d.order.dealerId}, ${d.order.currency}, ${d.order.shipping ? q.json(d.order.shipping as never) : null}, ${src.billing_address ? q.json(src.billing_address) : null}, ${`Reorder of #${d.order.number}`})
      returning id, number, dealer_id`;
    // the old line totals don't apply: price × new quantity
    const total = await applyLines(q, o.id, lines.map((l): Line => ({ wooItemId: null, wooProductId: l.wooProductId, sku: l.sku, name: l.name, qty: l.qty, unitPriceCents: l.unitPriceCents })));
    await q`update oa_orders set total_cents = ${total} where id = ${o.id}`;
    await log(q, o.id, v.id, "arrived", { via: "reorder", from: d.order.number });
    await notify(q, after, { id: o.id, dealerId: o.dealer_id, number: o.number }, ["admins"], `New order #${o.number} from ${d.order.dealerName}`, `Reorder of #${d.order.number}: ${lines.length} line(s), ${money(total, d.order.currency)}. Please verify it.`, v.id);
    return o.id as string;
  });
  await runAfter(after);
  return newId;
}

// ---------------------------------------------------------------- WooCommerce → app
/**
 * Creates or updates the app's copy of a WooCommerce order. Called by the webhook, the first import,
 * and after the app itself changes the order on the website. WooCommerce owns the lines and totals;
 * the app owns the stage. Only a cancel or a completed status set on the website moves the stage here.
 */
export async function upsertFromWoo(w: WooOrder, via: "webhook" | "import" | "edit" | "reorder", actorId: string | null = null): Promise<{ id: string; created: boolean }> {
  const m = mapWooOrder(w);
  const after: After = [];
  const res = await sql.begin(async (tx) => {
    const q = tx as unknown as Q;
    const [ex] = await q`select id, dealer_id, number, stage, woo_order_id, woo_modified_at from oa_orders where woo_order_id = ${m.wooOrderId} for update`;
    if (ex && ex.woo_modified_at && m.modifiedAt && m.modifiedAt < ex.woo_modified_at) return { id: ex.id as string, created: false };   // an older delivery, arriving late

    if (!ex) {
      const dealerId = await dealerFor(q, m);
      const stage = stageFromWoo(m.status);
      const [o] = await q`
        insert into oa_orders (woo_order_id, number, dealer_id, stage, stage_since, currency, total_cents, tax_cents, shipping_address, billing_address, dealer_note, ordered_at, woo_status, woo_modified_at)
        values (${m.wooOrderId}, ${m.number}, ${dealerId}, ${stage}, ${via === "import" ? m.orderedAt : new Date()}, ${m.currency}, ${m.totalCents}, ${m.taxCents},
                ${m.shipping ? q.json(m.shipping as never) : null}, ${m.billing ? q.json(m.billing as never) : null}, ${m.dealerNote}, ${m.orderedAt}, ${m.status}, ${m.modifiedAt})
        returning id, dealer_id, number`;
      await applyLines(q, o.id, m.items);
      await log(q, o.id, actorId, "arrived", { via, wooStatus: m.status });
      if (stage === "submitted" && via !== "import") {
        const [dl] = await q`select name from oa_dealers where id = ${dealerId}`;
        await notify(q, after, { id: o.id, dealerId, number: o.number }, ["admins"], `New order #${o.number} from ${dl.name}`,
          `${dl.name} has submitted order #${o.number}: ${m.items.length} line(s), ${money(m.totalCents, m.currency)}. Please verify it.`, actorId);
      }
      return { id: o.id as string, created: true };
    }

    await q`update oa_orders set total_cents = ${m.totalCents}, tax_cents = ${m.taxCents}, currency = ${m.currency}, woo_status = ${m.status}, woo_modified_at = ${m.modifiedAt},
              shipping_address = ${m.shipping ? q.json(m.shipping as never) : null}, billing_address = ${m.billing ? q.json(m.billing as never) : null}, dealer_note = ${m.dealerNote}
            where id = ${ex.id}`;
    const now = await q`select sku, qty, unit_price_cents from oa_order_items where order_id = ${ex.id} order by sku, qty`;
    const sig = (ls: { sku: string | null; qty: number; unitPriceCents: number }[]) => ls.map((l) => `${l.sku}|${l.qty}|${l.unitPriceCents}`).sort().join(",");
    const changed = sig(now.map((r) => ({ sku: r.sku, qty: r.qty, unitPriceCents: r.unit_price_cents }))) !== sig(m.items);
    await applyLines(q, ex.id, m.items);   // always take the website's item ids and totals
    if (changed && via === "webhook") await log(q, ex.id, null, "changed_on_website", { lines: m.items.length, total: m.totalCents });

    const o: Locked = { id: ex.id, dealerId: ex.dealer_id, number: ex.number, stage: ex.stage, wooOrderId: m.wooOrderId, pendingProposal: false };
    if (["cancelled", "refunded", "trash"].includes(m.status) && !["cancelled", "received"].includes(o.stage)) {
      await q`update oa_proposals set status = 'withdrawn', decided_at = now() where order_id = ${o.id} and status = 'pending'`;
      await setStage(q, o, "cancelled", null, [], { via: "website", wooStatus: m.status });
      await q`update oa_orders set cancelled_reason = coalesce(cancelled_reason, 'Cancelled on the website') where id = ${o.id}`;
      await notify(q, after, o, ["admins", "factory"], `Order ${n(o)} cancelled on the website`, `Order ${n(o)} was set to ${m.status} in WooCommerce, so it's now cancelled here too.`);
    } else if (m.status === "completed" && ["submitted", "verified", "in_progress"].includes(o.stage)) {
      await setStage(q, o, "shipped", null, [], { via: "website" });
      await notify(q, after, o, ["admins"], `Order ${n(o)} completed on the website`, `Order ${n(o)} was marked completed in WooCommerce without shipping details. Add the tracking in Order Angel so the dealer gets it.`);
    }
    return { id: ex.id as string, created: false };
  });
  await runAfter(after);
  return res;
}

/** Matches a website customer to a dealer; an unknown one is added and marked for Mark and Andrew to set up. */
async function dealerFor(q: Q, m: ReturnType<typeof mapWooOrder>): Promise<string> {
  if (m.customerId) {
    const [d] = await q`select id from oa_dealers where woo_customer_id = ${m.customerId}`;
    if (d) return d.id;
  } else if (m.dealerEmail) {
    const [d] = await q`select id from oa_dealers where lower(email) = lower(${m.dealerEmail}) limit 1`;
    if (d) return d.id;
  }
  const [d] = await q`insert into oa_dealers (woo_customer_id, name, country, email, needs_setup) values (${m.customerId}, ${m.dealerName}, ${m.dealerCountry}, ${m.dealerEmail}, true) returning id`;
  return d.id;
}

/** First import: every open order on the website comes in at Submitted, for triage. Safe to run more than once. */
export async function importOpenOrders() {
  const list = await woo.openOrders();
  let created = 0;
  for (const w of list) if ((await upsertFromWoo(w, "import")).created) created++;
  return { seen: list.length, created };
}

// ---------------------------------------------------------------- the daily check
/** Reminders to press Received, closing unconfirmed orders, and a digest of flagged orders for Mark and Andrew. */
export async function dailyCheck(now = new Date()) {
  const s = await settings();
  const shipped = await sql`select id, dealer_id, number, stage, stage_since, woo_order_id, last_reminder_at, reminders_sent from oa_orders where stage = 'shipped'`;
  let reminded = 0, closed = 0;
  for (const r of shipped) {
    const due = receivedDue({ stage: r.stage, stageSince: r.stage_since, eta: null, lastReminderAt: r.last_reminder_at }, s, now);
    if (!due) continue;
    const after: After = [];
    await sql.begin(async (tx) => {
      const q = tx as unknown as Q;
      const o: Locked = { id: r.id, dealerId: r.dealer_id, number: r.number, stage: r.stage, wooOrderId: r.woo_order_id == null ? null : Number(r.woo_order_id), pendingProposal: false };
      if (due === "remind") {
        await q`update oa_orders set reminders_sent = reminders_sent + 1, last_reminder_at = ${now} where id = ${o.id}`;
        await notify(q, after, o, ["dealer"], `Has order ${n(o)} arrived?`, `Please press Received on order ${n(o)} once it's with you, and tell us if anything is damaged or missing.`);
        reminded++;
      } else {
        await setStage(q, o, "received", null, after, { auto: true, afterDays: s.autoCloseDays });
        await q`update oa_orders set received_at = ${now}, received_auto = true where id = ${o.id}`;
        await notify(q, after, o, ["admins"], `Order ${n(o)} closed, not confirmed`, `The dealer never pressed Received on order ${n(o)}, so it closed automatically ${s.autoCloseDays} days after shipping.`);
        closed++;
      }
    });
    await runAfter(after);
  }
  const all = await sql`${ORDER_SELECT(sql)} where o.stage not in ('received', 'cancelled')`;
  const flagged = all.map((r) => toRow(r, s, now)).filter((o) => o.flag.flagged);
  if (flagged.length) {
    const body = flagged.slice(0, 30).map((o) => `#${o.number} ${o.dealerName}: ${o.flag.reason}`).join("\n") + (flagged.length > 30 ? `\n…and ${flagged.length - 30} more` : "");
    const admins = await sql`select id, email from oa_accounts where role = 'admin' and active`;
    for (const a of admins) {
      await sql`insert into oa_notifications (account_id, title, body) values (${a.id}, ${`${flagged.length === 1 ? "1 order needs" : `${flagged.length} orders need`} attention`}, ${body})`;
      try { await sendMail({ to: a.email, subject: `${flagged.length === 1 ? "1 order needs" : `${flagged.length} orders need`} attention · Order Angel`, text: `${body}\n\n${orderLink("").replace(/\/$/, "")}?stage=flagged` }); } catch (e) { console.error(e); }
    }
  }
  return { reminded, closed, flagged: flagged.length };
}

export { STAGE_LABEL };

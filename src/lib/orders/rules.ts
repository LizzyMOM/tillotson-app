// Order Angel · the rules, in one place, with no database or network so they can be tested on their own.
// Who may do what at which stage, when an order is flagged, when the dealer is reminded, and how an
// edit turns into a WooCommerce update.

export type Role = "admin" | "factory" | "dealer";
export type Stage = "submitted" | "verified" | "in_progress" | "shipped" | "received" | "cancelled";

/** The five stages in order (cancelled sits outside the line). */
export const STAGES: Stage[] = ["submitted", "verified", "in_progress", "shipped", "received"];
export const STAGE_LABEL: Record<Stage, string> = {
  submitted: "Submitted", verified: "Verified", in_progress: "In progress", shipped: "Shipped", received: "Received", cancelled: "Cancelled",
};
/** Done with as far as Mark and Andrew are concerned: shown in the archive, not the working list. */
export const ARCHIVED: Stage[] = ["shipped", "received", "cancelled"];

export type Action =
  | "verify" | "propose_edit" | "withdraw_proposal" | "dealer_decide" | "start"
  | "raise_issue" | "resolve_issue" | "delay_notice" | "add_shipment" | "receive"
  | "cancel" | "invoice" | "message" | "internal_message";

export interface Ctx {
  role: Role;
  stage: Stage;
  pendingProposal: boolean;
  /** For dealers: is this their own dealer's order? Staff see every order. */
  ownOrder: boolean;
}

/** Whether this person may take this action on this order now. The server checks this on every action. */
export function can(action: Action, c: Ctx): boolean {
  if (c.role === "dealer" && !c.ownOrder) return false;
  const staff = c.role === "admin" || c.role === "factory";
  const admin = c.role === "admin";
  const s = c.stage;
  switch (action) {
    case "verify": return admin && s === "submitted" && !c.pendingProposal;
    case "propose_edit": return admin && (s === "submitted" || s === "verified" || s === "in_progress") && !c.pendingProposal;
    case "withdraw_proposal": return admin && c.pendingProposal;
    case "dealer_decide": return c.role === "dealer" && c.pendingProposal;
    case "start": return staff && s === "verified";
    case "raise_issue": return staff && (s === "verified" || s === "in_progress");
    case "resolve_issue": return admin;
    case "delay_notice": return admin && (s === "submitted" || s === "verified" || s === "in_progress");
    case "add_shipment": return staff && (s === "verified" || s === "in_progress");
    case "receive": return (c.role === "dealer" || admin) && s === "shipped";
    case "cancel": return admin && (s === "submitted" || s === "verified" || s === "in_progress");
    case "invoice": return staff && (s === "in_progress" || s === "shipped" || s === "received");
    case "message": return true;
    case "internal_message": return staff;
  }
}

// ---------------------------------------------------------------- overdue flags and reminders
export interface Settings { flagDays: number; receivedReminderDays: number; autoCloseDays: number }
export const DEFAULT_SETTINGS: Settings = { flagDays: 14, receivedReminderDays: 3, autoCloseDays: 30 };

export interface Timing {
  stage: Stage;
  stageSince: Date;
  /** A new estimated date, given with a delay notice or a shipment (YYYY-MM-DD). */
  eta: string | null;
  lastReminderAt?: Date | null;
}

const DAY = 86_400_000;
export const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY);
/** The end of a YYYY-MM-DD day (UTC): an order due on the 3rd isn't late until the 3rd is over. */
const endOf = (d: string) => new Date(`${d}T23:59:59.999Z`);

export interface Flag { flagged: boolean; daysInStage: number; dueAt: Date | null; reason: string | null }

/**
 * Any order that hasn't moved on within flagDays of reaching its current stage is flagged.
 * A delay notice with a new estimated date pushes that out: the order is flagged again only once the new date passes.
 * Received and cancelled orders are never flagged.
 */
export function flagFor(o: Timing, s: Settings, now: Date): Flag {
  const daysInStage = Math.max(0, daysBetween(o.stageSince, now));
  if (o.stage === "received" || o.stage === "cancelled") return { flagged: false, daysInStage, dueAt: null, reason: null };
  let dueAt = new Date(o.stageSince.getTime() + s.flagDays * DAY);
  let extended = false;
  if (o.eta && endOf(o.eta) > dueAt) { dueAt = endOf(o.eta); extended = true; }
  if (now <= dueAt) return { flagged: false, daysInStage, dueAt, reason: null };
  const reason = extended
    ? `Past the new estimated date (${fmtDate(o.eta!)})`
    : `${daysInStage} days at ${STAGE_LABEL[o.stage]}`;
  return { flagged: true, daysInStage, dueAt, reason };
}

/** For a shipped order: should the dealer be reminded to press Received, or is it time to close it unconfirmed? */
export function receivedDue(o: Timing, s: Settings, now: Date): "auto_close" | "remind" | null {
  if (o.stage !== "shipped") return null;
  if (now.getTime() >= o.stageSince.getTime() + s.autoCloseDays * DAY) return "auto_close";
  const from = o.lastReminderAt ?? o.stageSince;
  if (now.getTime() >= from.getTime() + s.receivedReminderDays * DAY) return "remind";
  return null;
}

/** The WooCommerce status that matches each stage, so the website tells the same story. */
export function wooStatusFor(stage: Stage): string | null {
  switch (stage) {
    case "verified": case "in_progress": return "processing";
    case "shipped": case "received": return "completed";
    case "cancelled": return "cancelled";
    default: return null;   // submitted: leave whatever the website set (on-hold / pending)
  }
}

/** The stage to give an order seen for the first time, from its WooCommerce status (used for the first import). */
export function stageFromWoo(status: string): Stage {
  if (status === "completed") return "shipped";
  if (status === "cancelled" || status === "refunded" || status === "failed" || status === "trash") return "cancelled";
  return "submitted";   // pending, on-hold, processing: Mark and Andrew triage them from the start
}

// ---------------------------------------------------------------- edits
export interface Line {
  wooItemId?: number | null;
  wooProductId?: number | null;
  sku: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
}

export interface Diff {
  removed: Line[];
  added: Line[];
  changed: { before: Line; after: Line }[];
  unchanged: Line[];
}

/** What an edit changes, for showing the dealer old versus new. Lines match on their WooCommerce item id. */
export function diffLines(before: Line[], after: Line[]): Diff {
  const d: Diff = { removed: [], added: [], changed: [], unchanged: [] };
  const byId = new Map(after.filter((l) => l.wooItemId != null).map((l) => [l.wooItemId!, l]));
  for (const b of before) {
    const a = b.wooItemId != null ? byId.get(b.wooItemId) : undefined;
    if (!a || a.qty <= 0) d.removed.push(b);
    else if (a.qty !== b.qty || a.unitPriceCents !== b.unitPriceCents || (a.sku ?? "") !== (b.sku ?? "")) d.changed.push({ before: b, after: a });
    else d.unchanged.push(b);
  }
  for (const a of after) if (a.wooItemId == null && a.qty > 0) d.added.push(a);
  return d;
}

export const linesTotal = (ls: Line[]) => ls.reduce((t, l) => t + (l.qty > 0 ? l.qty * l.unitPriceCents : 0), 0);
const amount = (cents: number) => (cents / 100).toFixed(2);

/**
 * The line_items to send to WooCommerce's order update for an approved edit.
 * Quantity 0 removes a line; a line without an item id is new and is added by product id (or SKU).
 * Subtotal and total are sent so a price Mark or Andrew changed is kept, rather than the catalogue price.
 */
export function wooLineItems(before: Line[], after: Line[]): Record<string, unknown>[] {
  const d = diffLines(before, after);
  const out: Record<string, unknown>[] = [];
  for (const r of d.removed) out.push({ id: r.wooItemId, quantity: 0 });
  for (const { after: a } of d.changed) {
    const t = amount(a.qty * a.unitPriceCents);
    out.push({ id: a.wooItemId, quantity: a.qty, subtotal: t, total: t });
  }
  for (const a of d.added) {
    const t = amount(a.qty * a.unitPriceCents);
    out.push({ ...(a.wooProductId ? { product_id: a.wooProductId } : { sku: a.sku }), quantity: a.qty, subtotal: t, total: t });
  }
  return out;
}

/** Cleans the lines from an edit form: trims, drops empty rows, refuses nonsense. */
export function cleanEdit(rows: { wooItemId?: number | null; wooProductId?: number | null; sku?: string | null; name?: string | null; qty: number; unitPriceCents: number }[]): { lines: Line[]; error?: string } {
  const lines: Line[] = [];
  for (const r of rows) {
    const sku = r.sku?.trim() || null;
    const name = r.name?.trim() || sku || "";
    const isNew = r.wooItemId == null;
    if (isNew && !sku && !r.name?.trim()) continue;                      // empty add-row
    if (!Number.isInteger(r.qty) || r.qty < 0 || r.qty > 9999) return { lines, error: `Check the quantity for ${name || "a line"}` };
    if (!Number.isInteger(r.unitPriceCents) || r.unitPriceCents < 0) return { lines, error: `Check the price for ${name || "a line"}` };
    if (isNew && r.qty === 0) continue;
    if (isNew && !sku) return { lines, error: `Add a part number for ${name}` };
    lines.push({ wooItemId: r.wooItemId ?? null, wooProductId: r.wooProductId ?? null, sku, name, qty: r.qty, unitPriceCents: r.unitPriceCents });
  }
  if (!lines.some((l) => l.qty > 0)) return { lines, error: "An order needs at least one line. To cancel it, use Cancel order." };
  return { lines };
}

/** "12.50" or "12,50" → 1250. NaN when it isn't a price. */
export function toCents(v: string): number {
  const s = v.trim().replace(/\s/g, "").replace(/^[€£$]/, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export const fmtDate = (d: string | Date) =>
  (typeof d === "string" ? new Date(`${d}T12:00:00Z`) : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

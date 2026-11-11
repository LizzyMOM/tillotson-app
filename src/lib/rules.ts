// Registration rules: ages, required documents, pricing and validation.
// Pure functions with no framework or database code, so the browser (for live feedback)
// and the server (the source of truth) run exactly the same logic.

export type StartRule = "on_licence" | "check" | "letter";
export type DocKind = "licence_front" | "licence_back" | "start_permission" | "entrant_licence";

export interface EventSetup {
  startsOn: string;                 // 'YYYY-MM-DD'
  hostFederationId: string | null;
  depositCents: number;
  teeSizes: string[];
  seatSizes: string[];
  categories: { id: string; name: string; minAge: number | null; maxAge: number | null }[];
  tickets: { id: string; name: string; priceCents: number; includesKart: boolean; categoryIds: string[] | null }[];
  products: { id: string; kind: "rental" | "clothing" | "other"; name: string; priceCents: number; sizes: string[]; maxQty: number; bundleGroup: string | null }[];
  bundles: { bundleGroup: string; name: string; discountPct: number }[];
  federations: { id: string; name: string; country: string; startPermission: StartRule }[];
}

export interface Line { productId: string; size: string | null; qty: number }

export interface Draft {
  firstName?: string; lastName?: string; gender?: string; dateOfBirth?: string;
  email?: string; phone?: string;
  addressLine1?: string; addressLine2?: string; city?: string; region?: string; postcode?: string; country?: string;
  guardianFirstName?: string; guardianLastName?: string; guardianEmail?: string; guardianPhone?: string;
  guardianSameAddress?: boolean; guardianAddress?: { line1?: string; city?: string; postcode?: string; country?: string };
  entrantAck?: boolean;
  categoryId?: string; licenceNumber?: string; licenceExpiresOn?: string;
  federationId?: string | null; federationOther?: string; federationEmail?: string; representing?: string;
  licenceAck?: boolean; startPermissionAck?: boolean;
  ticketId?: string; weightKg?: number | null; heightCm?: number | null; waistCm?: number | null; seatSize?: string; seatAck?: boolean;
  freeTeeSize?: string;
  lines?: Line[];
  billingSame?: boolean; billing?: { firstName?: string; lastName?: string; email?: string; address?: string };
  termsAccepted?: boolean; privacyAccepted?: boolean; safetyAccepted?: boolean;
}

export type Errors = Record<string, string>;
export const STEPS = ["driver", "guardian", "licence", "entry", "clothing", "review"] as const;
export type Step = (typeof STEPS)[number];

// ---------------------------------------------------------------- ages
/** Age in whole years on a given date (YYYY-MM-DD strings, no time zones involved). */
export function ageOn(dob: string, on: string): number {
  const [y, m, d] = dob.split("-").map(Number);
  const [Y, M, D] = on.split("-").map(Number);
  let a = Y - y;
  if (M < m || (M === m && D < d)) a--;
  return a;
}
/** A driver is a minor if under 18 on the first day of the event. */
export function isMinor(draft: Draft, ev: EventSetup): boolean {
  return !!draft.dateOfBirth && ageOn(draft.dateOfBirth, ev.startsOn) < 18;
}
export function stepsFor(draft: Draft, ev: EventSetup): Step[] {
  return STEPS.filter((s) => s !== "guardian" || isMinor(draft, ev));
}

// ---------------------------------------------------------------- documents
export interface DocRequirement { kind: DocKind; required: boolean; reason: string }

/** What the driver must upload, decided from their federation and age — never from a tick box. */
export function requiredDocuments(draft: Draft, ev: EventSetup): DocRequirement[] {
  const docs: DocRequirement[] = [
    { kind: "licence_front", required: true, reason: "Every driver" },
    { kind: "licence_back", required: true, reason: "Every driver" },
  ];
  const rule = startRuleFor(draft, ev);
  if (rule === "letter") docs.push({ kind: "start_permission", required: true, reason: "Your federation's licences don't carry start permission" });
  if (rule === "check") docs.push({ kind: "start_permission", required: false, reason: "Only if your licence doesn't state start permission" });
  if (isMinor(draft, ev)) docs.push({ kind: "entrant_licence", required: true, reason: "Driver is under 18" });
  return docs;
}
/** 'host' = licensed by the host federation, so no start permission is needed. Unlisted federations need a letter. */
export function startRuleFor(draft: Draft, ev: EventSetup): StartRule | "host" | null {
  if (draft.federationId === undefined) return null;
  if (draft.federationId === null) return draft.federationOther ? "letter" : null;
  if (ev.hostFederationId && draft.federationId === ev.hostFederationId) return "host";
  return ev.federations.find((f) => f.id === draft.federationId)?.startPermission ?? "letter";
}

// ---------------------------------------------------------------- pricing
export interface Quote {
  lines: { label: string; cents: number; kind: "ticket" | "product" | "discount" | "deposit" }[];
  subtotalCents: number; discountCents: number; depositCents: number; totalCents: number;
}

/** Server-side price. The browser shows the same numbers, but only this result is ever charged. */
export function quote(draft: Draft, ev: EventSetup): Quote {
  const out: Quote["lines"] = [];
  let subtotal = 0;
  const ticket = ev.tickets.find((t) => t.id === draft.ticketId);
  if (ticket) { out.push({ label: ticket.name, cents: ticket.priceCents, kind: "ticket" }); subtotal += ticket.priceCents; }
  const qtyByProduct = new Map<string, number>();
  for (const l of cleanLines(draft.lines ?? [], ev)) {
    const p = ev.products.find((x) => x.id === l.productId)!;
    const cents = p.priceCents * l.qty;
    out.push({ label: p.name + (l.size ? " · " + l.size : "") + (l.qty > 1 ? " × " + l.qty : ""), cents, kind: "product" });
    subtotal += cents;
    qtyByProduct.set(p.id, (qtyByProduct.get(p.id) ?? 0) + l.qty);
  }
  let discount = 0;
  for (const b of ev.bundles) {
    const members = ev.products.filter((p) => p.bundleGroup === b.bundleGroup);
    if (!members.length) continue;
    const sets = Math.min(...members.map((p) => qtyByProduct.get(p.id) ?? 0));
    if (sets > 0) {
      const setCents = members.reduce((a, p) => a + p.priceCents, 0);
      const d = Math.round((setCents * sets * b.discountPct) / 100);
      out.push({ label: b.name + " −" + b.discountPct + "%" + (sets > 1 ? " × " + sets : ""), cents: -d, kind: "discount" });
      discount += d;
    }
  }
  out.push({ label: "Breakage deposit (refundable)", cents: ev.depositCents, kind: "deposit" });
  return { lines: out, subtotalCents: subtotal, discountCents: discount, depositCents: ev.depositCents, totalCents: subtotal - discount + ev.depositCents };
}
/** Drops lines for unknown products, invalid sizes or quantities, and merges duplicates. */
export function cleanLines(lines: Line[], ev: EventSetup): Line[] {
  const merged = new Map<string, Line>();
  for (const l of lines) {
    const p = ev.products.find((x) => x.id === l.productId);
    if (!p || !Number.isInteger(l.qty) || l.qty <= 0) continue;
    const size = p.sizes.length ? l.size : null;
    if (p.sizes.length && (!size || !p.sizes.includes(size))) continue;
    const key = p.id + "|" + (size ?? "");
    const prev = merged.get(key);
    merged.set(key, { productId: p.id, size, qty: Math.min(p.maxQty, (prev?.qty ?? 0) + l.qty) });
  }
  return [...merged.values()];
}

// ---------------------------------------------------------------- validation
const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
export const emailOk = (v?: string) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export function validateStep(step: Step, d: Draft, ev: EventSetup, today: string): Errors {
  const e: Errors = {};
  const need = (k: keyof Draft, msg: string) => { if (blank(d[k])) e[k] = msg; };
  if (step === "driver") {
    need("firstName", "Enter a first name"); need("lastName", "Enter a surname");
    need("gender", "Choose one");
    if (!emailOk(d.email)) e.email = "Enter a valid email";
    need("phone", "Enter a mobile number");
    need("addressLine1", "Enter a street address"); need("city", "Enter a city"); need("postcode", "Enter a postcode"); need("country", "Choose a country");
    if (!d.dateOfBirth) e.dateOfBirth = "Enter the date of birth";
    else if (d.dateOfBirth >= today) e.dateOfBirth = "Enter a date in the past";
  }
  if (step === "guardian" && isMinor(d, ev)) {
    need("guardianFirstName", "Enter a first name"); need("guardianLastName", "Enter a surname");
    if (!emailOk(d.guardianEmail)) e.guardianEmail = "Enter a valid email";
    need("guardianPhone", "Enter a phone number");
    if (d.guardianSameAddress === false) {
      const a = d.guardianAddress ?? {};
      if (blank(a.line1)) e["guardianAddress.line1"] = "Enter a street address";
      if (blank(a.city)) e["guardianAddress.city"] = "Enter a city";
      if (blank(a.postcode)) e["guardianAddress.postcode"] = "Enter a postcode";
      if (blank(a.country)) e["guardianAddress.country"] = "Choose a country";
    }
    if (!d.entrantAck) e.entrantAck = "Tick to confirm";
  }
  if (step === "licence") {
    const cat = ev.categories.find((c) => c.id === d.categoryId);
    if (!cat) e.categoryId = "Choose a race category";
    else if (d.dateOfBirth) {
      const a = ageOn(d.dateOfBirth, ev.startsOn);
      if ((cat.minAge != null && a < cat.minAge) || (cat.maxAge != null && a > cat.maxAge))
        e.categoryId = `${cat.name} is for ages ${cat.minAge ?? ""}${cat.maxAge != null ? "–" + cat.maxAge : "+"}. The driver will be ${a} at the event.`;
    }
    if (!d.licenceAck) e.licenceAck = "Tick to confirm";
    need("licenceNumber", "Enter your licence number");
    if (!d.licenceExpiresOn) e.licenceExpiresOn = "Enter the expiry date";
    else if (d.licenceExpiresOn < ev.startsOn) e.licenceExpiresOn = "This licence expires before the event. Renew it with your federation first.";
    if (d.federationId === undefined || (d.federationId === null && blank(d.federationOther))) e.federationId = "Choose your federation";
    if (!emailOk(d.federationEmail)) e.federationEmail = "Enter your federation's contact email";
    if (!d.startPermissionAck) e.startPermissionAck = "Tick to confirm";
    need("representing", "Choose the country you represent");
  }
  if (step === "entry") {
    const t = ev.tickets.find((x) => x.id === d.ticketId);
    if (!t || (t.categoryIds && d.categoryId && !t.categoryIds.includes(d.categoryId))) e.ticketId = "Choose a ticket";
    if (t?.includesKart) {
      if (!d.weightKg || d.weightKg < 15 || d.weightKg > 150) e.weightKg = "Enter weight in kg";
      if (!d.heightCm || d.heightCm < 80 || d.heightCm > 220) e.heightCm = "Enter height in cm";
      if (!d.waistCm || d.waistCm < 20 || d.waistCm > 160) e.waistCm = "Enter waist in cm";
      if (!d.seatSize || !ev.seatSizes.includes(d.seatSize)) e.seatSize = "Choose a seat size";
      if (!d.seatAck) e.seatAck = "Tick to confirm";
    }
  }
  if (step === "clothing" && (!d.freeTeeSize || !ev.teeSizes.includes(d.freeTeeSize))) e.freeTeeSize = "Choose the driver's T-shirt size";
  if (step === "review") {
    if (d.billingSame === false) {
      const b = d.billing ?? {};
      if (blank(b.firstName)) e["billing.firstName"] = "Enter a first name";
      if (blank(b.lastName)) e["billing.lastName"] = "Enter a surname";
      if (!emailOk(b.email)) e["billing.email"] = "Enter a valid email";
      if (blank(b.address)) e["billing.address"] = "Enter the billing address";
    }
    if (!d.termsAccepted) e.termsAccepted = "Tick to accept the terms";
    if (!d.privacyAccepted) e.privacyAccepted = "Tick to agree to the privacy policy";
    if (!d.safetyAccepted) e.safetyAccepted = "Tick to confirm";
  }
  return e;
}

/** Everything that must be true before payment can start. */
export function readyToPay(d: Draft, ev: EventSetup, today: string, uploaded: DocKind[]): Errors {
  const e: Errors = {};
  for (const s of stepsFor(d, ev)) Object.assign(e, validateStep(s, d, ev, today));
  for (const r of requiredDocuments(d, ev)) if (r.required && !uploaded.includes(r.kind)) e["doc." + r.kind] = "Upload this document";
  return e;
}

export const displayName = (d: Draft) => (d.firstName?.trim() && d.lastName?.trim() ? d.firstName.trim()[0] + ". " + d.lastName.trim() : "");

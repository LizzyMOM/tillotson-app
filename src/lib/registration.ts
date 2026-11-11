import "server-only";
import { z } from "zod";
import { sql } from "./db";
import type { EventInfo } from "./event";
import { quote, readyToPay, requiredDocuments, cleanLines, isMinor, type Draft, type DocKind } from "./rules";
import { hashSecret, checkSecret, newToken, newPin } from "./secrets";
import { putFile } from "./storage";
import { sendMail } from "./mail";

export const today = () => new Date().toISOString().slice(0, 10);
export const cookieName = (slug: string) => `reg_${slug}`;

// ---------------------------------------------------------------- the form, as the server accepts it
const str = z.string().trim().max(200).optional();
const yes = z.boolean().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined));
const num = z.number().finite().nullable().optional();
export const DraftSchema = z.object({
  firstName: str, lastName: str, gender: z.enum(["Male", "Female"]).optional(), dateOfBirth: date,
  email: str, phone: str, addressLine1: str, addressLine2: str, city: str, region: str, postcode: str, country: str,
  guardianFirstName: str, guardianLastName: str, guardianEmail: str, guardianPhone: str, guardianSameAddress: yes,
  guardianAddress: z.object({ line1: str, city: str, postcode: str, country: str }).optional(), entrantAck: yes,
  categoryId: z.string().uuid().optional(), licenceNumber: str, licenceExpiresOn: date,
  federationId: z.string().uuid().nullable().optional(), federationOther: str, federationEmail: str, representing: str,
  licenceAck: yes, startPermissionAck: yes,
  ticketId: z.string().uuid().optional(), weightKg: num, heightCm: num, waistCm: num, seatSize: str, seatAck: yes,
  freeTeeSize: str,
  lines: z.array(z.object({ productId: z.string().uuid(), size: z.string().max(40).nullable(), qty: z.number().int() })).max(30).optional(),
  billingSame: yes, billing: z.object({ firstName: str, lastName: str, email: str, address: z.string().trim().max(400).optional() }).optional(),
  termsAccepted: yes, privacyAccepted: yes, safetyAccepted: yes,
}).strip();

// ---------------------------------------------------------------- drafts
export interface DraftState { id: string; status: string; form: Draft; docs: { kind: DocKind; filename: string; sizeBytes: number }[] }

export async function createDraft(ev: EventInfo): Promise<{ id: string; cookie: string }> {
  const token = newToken();
  const [r] = await sql`insert into registrations (event_id, status, draft_token_hash) values (${ev.id}, 'draft', ${hashSecret(token)}) returning id`;
  return { id: r.id, cookie: `${r.id}.${token}` };
}

/** The draft this browser owns for this event, if its cookie is valid. */
export async function draftFromCookie(ev: EventInfo, cookie: string | undefined): Promise<DraftState | null> {
  if (!cookie) return null;
  const [id, token] = cookie.split(".");
  if (!id || !token || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await sql`select id, status, form, draft_token_hash from registrations where id = ${id} and event_id = ${ev.id}`;
  if (!r || !["draft", "awaiting_payment"].includes(r.status) || !checkSecret(token, r.draft_token_hash)) return null;
  const docs = await sql`select kind, filename, size_bytes from documents where registration_id = ${id} and replaced_by is null order by uploaded_at`;
  return { id: r.id, status: r.status, form: r.form, docs: docs.map((d) => ({ kind: d.kind, filename: d.filename, sizeBytes: d.size_bytes })) };
}

/** The registration this browser's cookie belongs to, whatever its status (used after payment). */
export async function ownedRegistrationId(ev: EventInfo, cookie: string | undefined): Promise<string | null> {
  if (!cookie) return null;
  const [id, token] = cookie.split(".");
  if (!id || !token || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await sql`select draft_token_hash from registrations where id = ${id} and event_id = ${ev.id}`;
  return r && checkSecret(token, r.draft_token_hash) ? id : null;
}

export async function saveForm(id: string, form: unknown): Promise<Draft> {
  const clean = DraftSchema.parse(form) as Draft;
  // Going back to edit after starting payment puts the registration back into draft.
  await sql`update registrations set form = ${sql.json(clean as never)}, status = 'draft', updated_at = now() where id = ${id} and status in ('draft','awaiting_payment')`;
  return clean;
}

// ---------------------------------------------------------------- documents
const MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
export const MAX_UPLOAD = 10 * 1024 * 1024;

export async function addDocument(ev: EventInfo, draft: DraftState, kind: string, file: File): Promise<{ error?: string }> {
  if (!["licence_front", "licence_back", "start_permission", "entrant_licence"].includes(kind)) return { error: "Unknown document" };
  if (!requiredDocuments(draft.form, ev.setup).some((r) => r.kind === kind)) return { error: "This document isn't needed for this registration" };
  const ext = MIME[file.type];
  if (!ext) return { error: "Upload a photo (JPG, PNG, WEBP or HEIC) or a PDF" };
  if (file.size > MAX_UPLOAD) return { error: "That file is over 10 MB. Choose a smaller photo or PDF." };
  if (file.size === 0) return { error: "That file is empty" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `events/${ev.slug}/${draft.id}/${kind}-${crypto.randomUUID()}.${ext}`;
  await putFile(key, bytes, file.type);
  await sql.begin(async (tx) => {
    const [d] = await tx`insert into documents (registration_id, kind, storage_key, filename, mime_type, size_bytes)
      values (${draft.id}, ${kind}, ${key}, ${file.name.slice(0, 200) || kind + "." + ext}, ${file.type}, ${file.size}) returning id`;
    await tx`update documents set replaced_by = ${d.id} where registration_id = ${draft.id} and kind = ${kind} and id <> ${d.id} and replaced_by is null`;
  });
  return {};
}

// ---------------------------------------------------------------- submit & pay
export type SubmitResult = { ok: true; totalCents: number } | { ok: false; errors: Record<string, string> };

/** Final server check, then writes the registration and its order and fixes the price. */
export async function submit(ev: EventInfo, draft: DraftState): Promise<SubmitResult> {
  const d = draft.form;
  const errors = readyToPay(d, ev.setup, today(), draft.docs.map((x) => x.kind));
  if (Object.keys(errors).length) return { ok: false, errors };
  const q = quote(d, ev.setup);
  const lines = cleanLines(d.lines ?? [], ev.setup);
  const minor = isMinor(d, ev.setup);
  const now = new Date();
  await sql.begin(async (tx) => {
    await tx`delete from registration_lines where registration_id = ${draft.id}`;
    for (const l of lines) {
      const p = ev.setup.products.find((x) => x.id === l.productId)!;
      await tx`insert into registration_lines (registration_id, product_id, size, qty, unit_price_cents) values (${draft.id}, ${l.productId}, ${l.size}, ${l.qty}, ${p.priceCents})`;
    }
    const ticket = ev.tickets.find((t) => t.id === d.ticketId)!;
    await tx`update registrations set
      status = 'awaiting_payment',
      first_name = ${d.firstName ?? null}, last_name = ${d.lastName ?? null}, gender = ${d.gender ?? null}, date_of_birth = ${d.dateOfBirth ?? null},
      email = ${d.email ?? null}, phone = ${d.phone ?? null}, address_line1 = ${d.addressLine1 ?? null}, address_line2 = ${d.addressLine2 ?? null},
      city = ${d.city ?? null}, region = ${d.region ?? null}, postcode = ${d.postcode ?? null}, country = ${d.country ?? null},
      guardian_first_name = ${minor ? d.guardianFirstName ?? null : null}, guardian_last_name = ${minor ? d.guardianLastName ?? null : null},
      guardian_email = ${minor ? d.guardianEmail ?? null : null}, guardian_phone = ${minor ? d.guardianPhone ?? null : null},
      guardian_same_address = ${d.guardianSameAddress !== false},
      guardian_address = ${minor && d.guardianSameAddress === false ? sql.json(d.guardianAddress as never) : null},
      entrant_ack_at = ${minor ? now : null},
      category_id = ${d.categoryId ?? null}, licence_number = ${d.licenceNumber ?? null}, licence_expires_on = ${d.licenceExpiresOn ?? null},
      federation_id = ${d.federationId ?? null}, federation_other = ${d.federationId ? null : (d.federationOther ?? null)},
      federation_email = ${d.federationEmail ?? null}, representing = ${d.representing ?? null},
      licence_ack_at = ${now}, start_permission_ack_at = ${now},
      ticket_id = ${d.ticketId ?? null},
      weight_kg = ${ticket.includesKart ? d.weightKg ?? null : null}, height_cm = ${ticket.includesKart ? d.heightCm ?? null : null},
      waist_cm = ${ticket.includesKart ? d.waistCm ?? null : null}, seat_size = ${ticket.includesKart ? d.seatSize ?? null : null},
      seat_ack_at = ${ticket.includesKart ? now : null},
      free_tee_size = ${d.freeTeeSize ?? null},
      billing_same = ${d.billingSame !== false}, billing = ${d.billingSame === false ? sql.json(d.billing as never) : null},
      terms_accepted_at = ${now}, privacy_accepted_at = ${now}, safety_accepted_at = ${now},
      subtotal_cents = ${q.subtotalCents}, discount_cents = ${q.discountCents}, deposit_cents = ${q.depositCents}, total_cents = ${q.totalCents},
      updated_at = now()
      where id = ${draft.id}`;
  });
  return { ok: true, totalCents: q.totalCents };
}

/**
 * Called once money has really been taken (Stripe webhook, or test payment in development).
 * Safe to call more than once for the same payment: the driver is only numbered and emailed once.
 */
export async function completePayment(registrationId: string, provider: string, providerRef: string, amountCents: number, currency: string) {
  const pin = newPin();
  const result = await sql.begin(async (tx) => {
    const [r] = await tx`select r.*, e.name as event_name, e.slug, e.currency as ev_currency from registrations r join events e on e.id = r.event_id where r.id = ${registrationId} for update of r`;
    if (!r) throw new Error("Registration not found");
    await tx`insert into payments (registration_id, event_id, purpose, provider, provider_ref, amount_cents, currency, status)
      values (${r.id}, ${r.event_id}, 'registration', ${provider}, ${providerRef}, ${amountCents}, ${currency.toUpperCase()}, 'succeeded')
      on conflict (provider, provider_ref) where provider_ref is not null do nothing`;
    if (r.status === "paid") return { already: true as const, raceNumber: r.race_number as number | null, r };
    if (amountCents !== r.total_cents || currency.toUpperCase() !== r.ev_currency) {
      await tx`insert into audit_log (event_id, action, subject, detail) values (${r.event_id}, 'payment_mismatch', ${r.id}, ${sql.json({ amountCents, currency, expected: r.total_cents } as never)})`;
      throw new Error(`Payment ${amountCents} ${currency} doesn't match total ${r.total_cents} ${r.ev_currency}`);
    }
    const [{ n }] = await tx`select complete_registration(${r.id}, ${hashSecret(pin)}) as n`;
    return { already: false as const, raceNumber: n as number | null, r };
  });
  if (!result.already) await sendConfirmation(result.r, result.raceNumber, pin);
  return { raceNumber: result.raceNumber };
}

async function sendConfirmation(r: Record<string, any>, raceNumber: number | null, pin: string) {
  const to = r.guardian_email || r.email;
  const money = (c: number) => (c / 100).toLocaleString("en-IE", { style: "currency", currency: r.ev_currency });
  await sendMail({
    to,
    subject: `${r.event_name}: you're registered${raceNumber ? ` · race number ${raceNumber}` : ""}`,
    text: [
      `${r.first_name} ${r.last_name} is registered for ${r.event_name}.`,
      "",
      raceNumber ? `Race number: ${raceNumber}` : "Race number: we'll email it to you shortly.",
      `PIN: ${pin}`,
      "",
      "Sign in to the driver app with the race number and this PIN. Keep the PIN private.",
      `Paid: ${money(r.total_cents)}, including the ${money(r.deposit_cents)} refundable deposit.`,
      "",
      "Your licence and documents are now with the officials. You'll be notified in the app when they're approved.",
    ].join("\n"),
  });
}

export async function paidSummary(ev: EventInfo, id: string) {
  const [r] = await sql`select r.first_name, r.last_name, r.status, r.race_number, r.total_cents, r.deposit_cents, r.email, r.guardian_email, c.name as category
    from registrations r left join categories c on c.id = r.category_id where r.id = ${id} and r.event_id = ${ev.id}`;
  return r ?? null;
}

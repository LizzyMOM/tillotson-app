"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  stepsFor, validateStep, requiredDocuments, startRuleFor, quote, isMinor, ageOn, displayName,
  type Draft, type Step, type EventSetup, type DocKind, type Errors, type Line,
} from "@/lib/rules";

type Ticket = { id: string; name: string; priceCents: number; includes: string[]; excludes: string[]; note: string | null; includesKart: boolean };
type Product = { id: string; kind: string; name: string; description: string | null; priceCents: number; sizes: string[]; maxQty: number; bundleGroup: string | null; refundable: boolean };
interface Props {
  ev: { slug: string; name: string; currency: string; texts: Record<string, string>; hostFederation: string | null; setup: EventSetup; tickets: Ticket[]; products: Product[] };
  countries: string[];
  initialForm: Draft;
  initialDocs: { kind: DocKind; filename: string; sizeBytes: number }[];
  initialStep?: string;
  today: string;
}

const TITLES: Record<Step, string> = { driver: "Driver details", guardian: "Parent / guardian", licence: "Licence & documents", entry: "Entry ticket", clothing: "Event clothing", review: "Review & pay" };
const DOC_NAMES: Record<DocKind, string> = { licence_front: "Licence · front", licence_back: "Licence · back", start_permission: "Start permission letter", entrant_licence: "Entrant's licence" };

export default function RegisterForm({ ev, countries, initialForm, initialDocs, initialStep, today }: Props) {
  const S = ev.setup;
  const [f, setF] = useState<Draft>({ guardianSameAddress: true, billingSame: true, ...initialForm });
  const [docs, setDocs] = useState(initialDocs);
  const steps = stepsFor(f, S);
  const [stepIdx, setStepIdx] = useState(() => {
    const i = steps.indexOf(initialStep as Step);
    return i >= 0 ? i : 0;
  });
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [uploading, setUploading] = useState<DocKind | null>(null);
  const [uploadErr, setUploadErr] = useState<Partial<Record<DocKind, string>>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setF((p) => ({ ...p, [k]: v })); setServerErrors({}); };
  const docKinds = docs.map((d) => d.kind);
  const stepErrors = useMemo(() => {
    const e = validateStep(step, f, S, today);
    if (step === "licence") for (const r of requiredDocuments(f, S)) if (r.required && !docKinds.includes(r.kind)) e["doc." + r.kind] = "Upload this document";
    return e;
  }, [step, f, S, today, docKinds]);
  const E: Errors = show ? { ...stepErrors, ...serverErrors } : serverErrors;
  const q = quote(f, S);
  const money = (c: number) => (c / 100).toLocaleString("en-IE", { style: "currency", currency: ev.currency, minimumFractionDigits: 2 });
  const ticket = ev.tickets.find((t) => t.id === f.ticketId);

  useEffect(() => { bodyRef.current?.scrollTo?.(0, 0); window.scrollTo(0, 0); }, [step]);

  async function save(form: Draft) {
    const res = await fetch(`/api/e/${ev.slug}/draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save. Check your connection and try again.");
  }
  async function next() {
    setBanner(null);
    if (Object.keys(stepErrors).length) { setShow(true); requestAnimationFrame(() => document.querySelector(".bad, .err")?.scrollIntoView({ block: "center", behavior: "smooth" })); return; }
    setBusy(true);
    try {
      if (step !== "review") { await save(f); setShow(false); setStepIdx(steps.indexOf(step) + 1); return; }
      const res = await fetch(`/api/e/${ev.slug}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form: f }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) { window.location.href = body.url; return; }
      if (body.errors) {
        setServerErrors(body.errors);
        const keys = Object.keys(body.errors);
        const at = steps.findIndex((s) => keys.some((k) => k.startsWith("doc.") ? s === "licence" : k in validateStep(s, {}, S, today) || k.split(".")[0] in validateStep(s, {}, S, today)));
        setShow(true); if (at >= 0) setStepIdx(at);
        setBanner("Some answers need another look before you can pay.");
      } else setBanner(body.error ?? "Something went wrong. Please try again.");
    } catch (e) { setBanner((e as Error).message); }
    finally { setBusy(false); }
  }
  function back() { setShow(false); setBanner(null); if (stepIdx > 0) setStepIdx(steps.indexOf(step) - 1); else window.location.href = `/e/${ev.slug}`; }

  async function upload(kind: DocKind, file: File) {
    setUploadErr((p) => ({ ...p, [kind]: undefined }));
    if (file.size > 10 * 1024 * 1024) { setUploadErr((p) => ({ ...p, [kind]: "That file is over 10 MB. Choose a smaller photo or PDF." })); return; }
    setUploading(kind);
    try {
      await save(f);   // the server decides which documents are needed from the saved answers
      const fd = new FormData(); fd.set("kind", kind); fd.set("file", file);
      const res = await fetch(`/api/e/${ev.slug}/upload`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setUploadErr((p) => ({ ...p, [kind]: body.error ?? "Upload failed. Try again." }));
      else setDocs(body.docs);
    } catch { setUploadErr((p) => ({ ...p, [kind]: "Upload failed. Check your connection and try again." })); }
    finally { setUploading(null); }
  }

  // ---------------------------------------------------------------- field helpers
  const input = (k: keyof Draft, label: string, o: { type?: string; hint?: string; auto?: string; mode?: "text" | "email" | "tel" | "numeric" | "decimal" } = {}) => (
    <div className={"fld" + (E[k] ? " bad" : "")}>
      <label htmlFor={"r-" + k}>{label}</label>
      {o.hint && <div className="hint">{o.hint}</div>}
      <input id={"r-" + k} type={o.type ?? "text"} autoComplete={o.auto} inputMode={o.mode}
        value={(f[k] as string | number | undefined) ?? ""}
        onChange={(e) => set(k, (o.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value) as never)} />
      {E[k] && <div className="err">{E[k]}</div>}
    </div>
  );
  const select = (k: keyof Draft, label: string, opts: string[], hint?: string) => (
    <div className={"fld" + (E[k] ? " bad" : "")}>
      <label htmlFor={"r-" + k}>{label}</label>
      {hint && <div className="hint">{hint}</div>}
      <select id={"r-" + k} value={(f[k] as string) ?? ""} onChange={(e) => set(k, e.target.value as never)}>
        <option value="">Select…</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {E[k] && <div className="err">{E[k]}</div>}
    </div>
  );
  const radios = (k: keyof Draft, label: string, opts: [string, string][], hint?: string) => (
    <div className={"fld" + (E[k] ? " bad" : "")}>
      <span className="lbl" id={"l-" + k}>{label}</span>
      {hint && <div className="hint">{hint}</div>}
      <div className="seg" role="radiogroup" aria-labelledby={"l-" + k}>
        {opts.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={f[k] === v} onClick={() => set(k, v as never)}>{l}</button>)}
      </div>
      {E[k] && <div className="err">{E[k]}</div>}
    </div>
  );
  const ack = (k: keyof Draft, label: string, title?: string, text?: string) => (
    <div className={"ack" + (E[k] ? " bad" : "")}>
      {title && <strong>{title}</strong>}
      {text && <p>{text}</p>}
      <label className="chk"><input id={"r-" + k} type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked as never)} />{label}</label>
      {E[k] && <div className="err">{E[k]}</div>}
    </div>
  );

  // ---------------------------------------------------------------- steps
  function Driver() {
    const minor = isMinor(f, S);
    return <>
      <div className="fld"><span className="lbl">Driver name</span><div className="hint">Enter the name as you want it on the ID stickers: first-name initial and surname, exactly as typed (capitals matter).</div></div>
      <div className="two">{input("firstName", "First name", { auto: "given-name" })}{input("lastName", "Surname", { auto: "family-name" })}</div>
      <div className="sticker"><span className="lbl">ID sticker</span><b>{displayName(f) || "—"}</b></div>
      {radios("gender", "Gender", [["Male", "Male"], ["Female", "Female"]])}
      {input("dateOfBirth", "Date of birth", { type: "date", auto: "bday" })}
      {minor && <div className="info"><b>Driver is under 18</b>You&apos;ll add a parent or guardian on the next step. An entrant with a valid entrant&apos;s licence must be present at registration.</div>}
      {input("email", "Driver email", { type: "email", mode: "email", auto: "email", hint: "Race number, PIN and receipt are sent here." + (minor ? " For under-18s they go to the parent / guardian instead." : "") })}
      {input("phone", minor ? "Parent / guardian mobile" : "Driver mobile", { type: "tel", mode: "tel", auto: "tel" })}
      <div className="sec"><h2>Driver address</h2></div>
      {input("addressLine1", "Street address", { auto: "address-line1" })}
      {input("addressLine2", "Address line 2 (optional)", { auto: "address-line2" })}
      <div className="two">{input("city", "City", { auto: "address-level2" })}{input("region", "Region (optional)", { auto: "address-level1" })}</div>
      <div className="two">{input("postcode", "Postcode", { auto: "postal-code" })}{select("country", "Country", countries)}</div>
    </>;
  }
  function Guardian() {
    const a = f.guardianAddress ?? {};
    const ga = (k: "line1" | "city" | "postcode" | "country", label: string) => (
      <div className={"fld" + (E["guardianAddress." + k] ? " bad" : "")}>
        <label htmlFor={"g-" + k}>{label}</label>
        {k === "country"
          ? <select id={"g-" + k} value={a[k] ?? ""} onChange={(e) => set("guardianAddress", { ...a, [k]: e.target.value })}><option value="">Select…</option>{countries.map((c) => <option key={c}>{c}</option>)}</select>
          : <input id={"g-" + k} value={a[k] ?? ""} onChange={(e) => set("guardianAddress", { ...a, [k]: e.target.value })} />}
        {E["guardianAddress." + k] && <div className="err">{E["guardianAddress." + k]}</div>}
      </div>
    );
    return <>
      <div className="hint">The driver is under 18, so we need a parent or guardian&apos;s details. Race number, PIN and receipt are sent to them.</div>
      <div className="two">{input("guardianFirstName", "First name")}{input("guardianLastName", "Surname")}</div>
      {input("guardianEmail", "Parent / guardian email", { type: "email", mode: "email" })}
      {input("guardianPhone", "Parent / guardian phone", { type: "tel", mode: "tel" })}
      <label className="chk"><input type="checkbox" checked={f.guardianSameAddress !== false} onChange={(e) => set("guardianSameAddress", e.target.checked)} />Same address as the driver</label>
      {f.guardianSameAddress === false && <>{ga("line1", "Street address")}<div className="two">{ga("city", "City")}{ga("postcode", "Postcode")}</div>{ga("country", "Country")}</>}
      {ack("entrantAck", "I understand", "Entrant requirement", ev.texts.entrant)}
    </>;
  }
  function Licence() {
    const rule = startRuleFor(f, S);
    const fed = S.federations.find((x) => x.id === f.federationId);
    const fedName = fed?.name ?? f.federationOther ?? "your federation";
    const reqs = requiredDocuments(f, S);
    const note = rule === "host" ? ["ok", "No start permission needed", `${ev.name} is run under ${ev.hostFederation}, the federation that issued your licence.`]
      : rule === "on_licence" ? ["ok", "Your licence covers it", `Licences from ${fedName} carry start permission, so no letter is needed. Upload both sides of your licence.`]
      : rule === "check" ? ["", "We'll check your licence", `Some ${fedName} licences state start permission and some don't. Upload both sides. If yours doesn't state it, add the letter from your federation below.`]
      : rule === "letter" ? ["warn", "Letter required", `Licences from ${fedName} don't carry start permission. Ask your federation for a start permission letter for this event and upload it below. Allow several days.`]
      : null;
    const fedValue = f.federationId === null ? "__other" : f.federationId ?? "";
    return <>
      <div className={"fld" + (E.categoryId ? " bad" : "")}>
        <span className="lbl" id="l-cat">Race category</span>
        <div className="seg" role="radiogroup" aria-labelledby="l-cat">
          {S.categories.map((c) => <button key={c.id} type="button" role="radio" aria-checked={f.categoryId === c.id} onClick={() => set("categoryId", c.id)}>
            {c.name}{c.minAge != null && <span style={{ fontWeight: 500, opacity: .8 }}> · {c.minAge}{c.maxAge != null ? "–" + c.maxAge : "+"}</span>}</button>)}
        </div>
        {f.dateOfBirth && <div className="hint">The driver will be {ageOn(f.dateOfBirth, S.startsOn)} on the first day of the event.</div>}
        {E.categoryId && <div className="err">{E.categoryId}</div>}
      </div>
      {ack("licenceAck", "I understand", "National Karting Licence", ev.texts.licence)}
      {input("licenceNumber", "Licence number", { hint: "You'll also show the physical licence at sign-on." })}
      {input("licenceExpiresOn", "Licence valid until", { type: "date" })}
      <div className={"fld" + (E.federationId ? " bad" : "")}>
        <label htmlFor="r-fed">Issuing federation (ASN)</label>
        <select id="r-fed" value={fedValue} onChange={(e) => set("federationId", e.target.value === "__other" ? null : e.target.value || undefined)}>
          <option value="">Select…</option>
          {S.federations.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.country})</option>)}
          <option value="__other">Another federation</option>
        </select>
        {E.federationId && <div className="err">{E.federationId}</div>}
      </div>
      {f.federationId === null && input("federationOther", "Federation name")}
      {input("federationEmail", "Federation contact email", { type: "email", mode: "email", hint: "The officials may contact them to confirm your licence." })}
      {note && <div className={"info " + note[0]}><b>{note[1]}</b>{note[2]}</div>}
      {ack("startPermissionAck", "I understand", "Start permission", ev.texts.start_permission)}
      {select("representing", "Country representing", countries, "Which country are you representing? You must hold a passport or karting licence from this country.")}
      <div className="sec"><h2>Upload documents</h2><span className="hint">{reqs.filter((r) => docKinds.includes(r.kind)).length} of {reqs.length}</span></div>
      <div className="hint">Clear photos from your phone are fine. Officials check them before the event, so sign-on is faster.</div>
      {reqs.map((r) => {
        const d = docs.find((x) => x.kind === r.kind);
        const err = uploadErr[r.kind] ?? E["doc." + r.kind];
        return (
          <div key={r.kind} className={"doc" + (d ? " ok" : err ? " bad" : "")}>
            <div className="th" aria-hidden="true">{d ? "✓" : "+"}</div>
            <div style={{ minWidth: 0 }}>
              <strong>{DOC_NAMES[r.kind]}<span className={"tag" + (d ? " done" : r.required ? "" : " opt")}>{d ? "Uploaded" : r.required ? "Required" : "If needed"}</span></strong>
              <div className="fn">{d ? `${d.filename} · ${Math.max(1, Math.round(d.sizeBytes / 1024))} KB` : r.reason}</div>
            </div>
            <div className="act">
              <label className={"up" + (d ? " ghost" : "")} aria-busy={uploading === r.kind}>
                <input type="file" accept="image/*,application/pdf" aria-label={`Upload ${DOC_NAMES[r.kind]}`}
                  onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload(r.kind, file); }} />
                {uploading === r.kind ? "Uploading…" : d ? "Replace" : "Upload photo or PDF"}
              </label>
              {err && <span className="err">{err}</span>}
            </div>
          </div>
        );
      })}
    </>;
  }
  function Entry() {
    const lines = f.lines ?? [];
    const rentals = ev.products.filter((p) => p.kind === "rental");
    const has = (id: string) => lines.some((l) => l.productId === id);
    const toggle = (id: string) => set("lines", has(id) ? lines.filter((l) => l.productId !== id) : [...lines, { productId: id, size: null, qty: 1 }]);
    return <>
      <div className={E.ticketId ? "bad" : ""} role="radiogroup" aria-label="Entry ticket" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {ev.tickets.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={f.ticketId === t.id} className="opt" onClick={() => set("ticketId", t.id)}>
            <span className="oh"><strong>{t.name}</strong><span className="pr">{money(t.priceCents)}</span></span>
            <ul>{t.includes.map((x) => <li key={x}>{x}</li>)}{t.excludes.map((x) => <li key={x} className="no">{x}</li>)}</ul>
            {t.note && <span className="hint">{t.note}</span>}
          </button>
        ))}
      </div>
      {E.ticketId && <div className="err">{E.ticketId}</div>}
      {rentals.length > 0 && <div className="sec"><h2>Rentals</h2></div>}
      {rentals.map((p) => (
        <div key={p.id} className="panel"><div className="row">
          <div><strong>{p.name} · {money(p.priceCents)}</strong>{p.description && <span className="hint">{p.description}</span>}</div>
          <button type="button" className="sw" role="switch" aria-checked={has(p.id)} aria-label={`Rent ${p.name}`} onClick={() => toggle(p.id)} />
        </div></div>
      ))}
      {ticket?.includesKart && <>
        <div className="sec"><h2>Kart fitting</h2></div>
        <div className="hint">Your kart is set up before you arrive, so these need to be accurate.</div>
        <div className="two">{input("weightKg", "Weight (kg)", { type: "number", mode: "decimal" })}{input("heightCm", "Height (cm)", { type: "number", mode: "numeric" })}</div>
        <div className="two">{input("waistCm", "Waist (cm)", { type: "number", mode: "numeric" })}{select("seatSize", "Seat size", S.seatSizes)}</div>
        {ack("seatAck", "I confirm the seat size is correct", undefined, ev.texts.seat)}
      </>}
      <div className="sec"><h2>Breakage deposit · {money(S.depositCents)}</h2></div>
      <div className="hint">{ev.texts.deposit}</div>
    </>;
  }
  function Clothing() {
    const lines = f.lines ?? [];
    const clothing = ev.products.filter((p) => p.kind === "clothing");
    const lineOf = (id: string) => lines.find((l) => l.productId === id);
    const upd = (p: Product, ch: Partial<Line>) => {
      const cur = lineOf(p.id) ?? { productId: p.id, size: p.sizes.includes("M") ? "M" : p.sizes[0] ?? null, qty: 0 };
      const nl = { ...cur, ...ch };
      set("lines", [...lines.filter((l) => l.productId !== p.id), ...(nl.qty > 0 ? [nl] : [])]);
    };
    const bundle = S.bundles[0];
    const members = bundle ? clothing.filter((p) => p.bundleGroup === bundle.bundleGroup) : [];
    const have = members.filter((p) => (lineOf(p.id)?.qty ?? 0) > 0).length;
    const disc = q.lines.filter((l) => l.kind === "discount").reduce((a, l) => a - l.cents, 0);
    const clothingTotal = clothing.reduce((a, p) => a + (lineOf(p.id)?.qty ?? 0) * p.priceCents, 0);
    return <>
      <div className="panel">
        <div className="row"><h3>Free event T-shirt</h3><span className="tag done">Included</span></div>
        {select("freeTeeSize", "Driver's size", S.teeSizes)}
      </div>
      {clothing.length > 0 && <div className="sec"><h2>Add for team & family</h2></div>}
      {clothing.map((p) => {
        const l = lineOf(p.id);
        return (
          <div key={p.id} className={"item" + (l ? " on" : "")}>
            <div className="row">
              <div><strong>{p.name}</strong><span className="p">{money(p.priceCents)}</span></div>
              <div className="qty">
                <button type="button" aria-label={`Remove one ${p.name}`} onClick={() => upd(p, { qty: Math.max(0, (l?.qty ?? 0) - 1) })}>−</button>
                <b aria-live="polite">{l?.qty ?? 0}</b>
                <button type="button" aria-label={`Add one ${p.name}`} onClick={() => upd(p, { qty: Math.min(p.maxQty, (l?.qty ?? 0) + 1) })}>+</button>
              </div>
            </div>
            {p.sizes.length > 0 && <div className="fld"><select aria-label={`${p.name} size`} value={l?.size ?? (p.sizes.includes("M") ? "M" : p.sizes[0])} onChange={(e) => upd(p, { size: e.target.value, qty: Math.max(1, l?.qty ?? 1) })}>
              {p.sizes.map((z) => <option key={z}>{z}</option>)}</select></div>}
          </div>
        );
      })}
      {bundle && members.length > 1 && <div className={"bundle" + (disc ? " on" : "")}><div className="pc"><span>−{bundle.discountPct}%</span></div>
        <div>{disc ? `Bundle applied: ${bundle.name}, ${bundle.discountPct}% off.` : have ? `Add ${members.length - have} more to get ${bundle.discountPct}% off the ${bundle.name.toLowerCase()}.` : `Buy the ${bundle.name.toLowerCase()} together and get ${bundle.discountPct}% off.`}</div></div>}
      {clothingTotal > 0 && <div className="tl"><div><span>Clothing</span><span>{money(clothingTotal)}</span></div>{disc > 0 && <div className="d"><span>Bundle discount</span><span>−{money(disc)}</span></div>}</div>}
    </>;
  }
  function Review() {
    const cat = S.categories.find((c) => c.id === f.categoryId);
    const fed = S.federations.find((x) => x.id === f.federationId)?.name ?? f.federationOther;
    const b = f.billing ?? {};
    const bf = (k: "firstName" | "lastName" | "email" | "address", label: string) => (
      <div className={"fld" + (E["billing." + k] ? " bad" : "")}><label htmlFor={"b-" + k}>{label}</label>
        <input id={"b-" + k} value={b[k] ?? ""} onChange={(e) => set("billing", { ...b, [k]: e.target.value })} />
        {E["billing." + k] && <div className="err">{E["billing." + k]}</div>}</div>
    );
    return <>
      <div className="panel"><h3>Driver</h3><div className="tl">
        <div><span>Name</span><span>{f.firstName} {f.lastName}</span></div>
        <div><span>ID sticker</span><span>{displayName(f)}</span></div>
        <div><span>Category</span><span>{cat?.name}</span></div>
        <div><span>Representing</span><span>{f.representing}</span></div>
        {isMinor(f, S) && <div><span>Parent / guardian</span><span>{f.guardianFirstName} {f.guardianLastName}</span></div>}
      </div><button type="button" className="linkbtn" onClick={() => setStepIdx(0)}>Change</button></div>
      <div className="panel"><h3>Licence</h3><div className="tl">
        <div><span>Licence number</span><span>{f.licenceNumber}</span></div>
        <div><span>Issued by</span><span>{fed}</span></div>
        <div><span>Documents</span><span>{docs.length} uploaded</span></div>
      </div><button type="button" className="linkbtn" onClick={() => setStepIdx(steps.indexOf("licence"))}>Change</button></div>
      <div className="panel"><h3>Your order</h3><div className="tl">
        {q.lines.map((l, i) => <div key={i} className={l.kind === "discount" ? "d" : undefined}><span>{l.label}</span><span>{l.cents < 0 ? "−" + money(-l.cents) : money(l.cents)}</span></div>)}
        <div><span>Event T-shirt · {f.freeTeeSize}</span><span>Included</span></div>
        <div className="t"><span>Total</span><span>{money(q.totalCents)}</span></div>
      </div></div>
      <div className="sec"><h2>Billing</h2></div>
      <label className="chk"><input type="checkbox" checked={f.billingSame !== false} onChange={(e) => set("billingSame", e.target.checked)} />Bill {isMinor(f, S) ? "the parent / guardian" : "the driver"} at the address given</label>
      {f.billingSame === false && <><div className="two">{bf("firstName", "First name")}{bf("lastName", "Surname")}</div>{bf("email", "Billing email")}{bf("address", "Billing address")}</>}
      <div className="sec"><h2>Terms</h2></div>
      {ack("termsAccepted", "I have read and understand the terms & conditions", "Terms & conditions", ev.texts.terms)}
      {ack("privacyAccepted", "I agree to the privacy policy")}
      {ack("safetyAccepted", "I confirm all driver equipment meets these FIA standards", "Driver safety equipment", ev.texts.safety)}
      <div className="hint">Next you&apos;ll pay securely by card. Your race number and PIN are emailed as soon as payment goes through.</div>
    </>;
  }

  const body = { driver: Driver, guardian: Guardian, licence: Licence, entry: Entry, clothing: Clothing, review: Review }[step]();
  return (
    <>
      <header className="top">
        <button className="bk" type="button" onClick={back}>‹ {stepIdx === 0 ? "Back" : "Back"}</button>
        <div className="ev">{ev.name} · Registration</div>
        <h1>{TITLES[step]}</h1>
        <div className="bars" aria-hidden="true">{steps.map((s, i) => <i key={s} className={i <= steps.indexOf(step) ? "on" : ""} />)}</div>
        <div className="sub">Step {steps.indexOf(step) + 1} of {steps.length}</div>
      </header>
      <div className="stripe" />
      <div className="body" ref={bodyRef}>
        {banner && <div className="banner" role="alert">{banner}</div>}
        {body}
      </div>
      <div className="foot">
        {["entry", "clothing", "review"].includes(step) && f.ticketId && <div className="sum"><span>Total incl. {money(S.depositCents)} deposit</span><span>{money(q.totalCents)}</span></div>}
        <button className="big" type="button" disabled={busy || !!uploading} onClick={next}>
          {busy ? "Saving…" : step === "review" ? `Pay ${money(q.totalCents)}` : "Continue"}
        </button>
      </div>
    </>
  );
}

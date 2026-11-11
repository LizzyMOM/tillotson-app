import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { loadEvent } from "@/lib/event";
import { cookieName, ownedRegistrationId, paidSummary } from "@/lib/registration";
import { brandStyle, money } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function Done({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await loadEvent(slug);
  if (!ev) notFound();
  const id = await ownedRegistrationId(ev, (await cookies()).get(cookieName(slug))?.value);
  const r = id ? await paidSummary(ev, id) : null;
  if (!r) notFound();
  if (r.status !== "paid") {
    // Stripe can take a few seconds to confirm; the page checks again on its own.
    return (
      <main className="shell" style={brandStyle(ev)}>
        <meta httpEquiv="refresh" content="3" />
        <section className="hero done"><h1>Confirming your payment</h1><p>This usually takes a few seconds.</p></section>
      </main>
    );
  }
  return (
    <main className="shell" style={brandStyle(ev)}>
      <section className="hero done">
        <div className="tick" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
        <h1>{r.first_name} is registered</h1>
        <div className="rn"><small>Race number · {r.category}</small><b>{r.race_number ?? "—"}</b></div>
        {!r.race_number && <p>We&apos;ll email your race number shortly.</p>}
        <p>Payment of {money(r.total_cents, ev.currency)} received, including the {money(r.deposit_cents, ev.currency)} refundable deposit. Your PIN and receipt have been sent to {r.guardian_email || r.email}.</p>
        <p style={{ fontSize: 16 }}>Your licence and documents are now with the officials. You&apos;ll be notified when they&apos;re approved.</p>
      </section>
    </main>
  );
}

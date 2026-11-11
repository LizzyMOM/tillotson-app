import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { loadEvent } from "@/lib/event";
import { sql } from "@/lib/db";
import { cookieName, ownedRegistrationId } from "@/lib/registration";
import { testPaymentsAllowed } from "@/lib/payments";
import { brandStyle, money } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** Development only: stands in for the Stripe payment page. */
export default async function PayTest({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await loadEvent(slug);
  if (!ev || !testPaymentsAllowed()) notFound();
  const id = await ownedRegistrationId(ev, (await cookies()).get(cookieName(slug))?.value);
  const [r] = id ? await sql`select total_cents, status, first_name, last_name from registrations where id = ${id}` : [];
  if (!r) notFound();
  return (
    <main className="shell" style={brandStyle(ev)}>
      <section className="hero">
        <div className="meta">Test payment · no card is charged</div>
        <h1>Pay {money(r.total_cents, ev.currency)}</h1>
        <p>{r.first_name} {r.last_name} · {ev.name}. In the live app this is Stripe&apos;s secure card page.</p>
        <form method="post" action={`/api/e/${slug}/pay-test`}><button className="big" type="submit">Simulate successful payment</button></form>
        <a className="big alt" href={`/e/${slug}/register?step=review`}>Back</a>
      </section>
    </main>
  );
}

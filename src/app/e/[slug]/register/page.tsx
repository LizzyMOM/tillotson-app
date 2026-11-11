import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadEvent, registrationWindow } from "@/lib/event";
import { cookieName, draftFromCookie } from "@/lib/registration";
import { brandStyle } from "@/lib/brand";
import { COUNTRIES } from "@/lib/countries";
import RegisterForm from "@/components/RegisterForm";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }>; searchParams: Promise<{ step?: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const ev = await loadEvent((await params).slug);
  return { title: ev ? `Register · ${ev.name}` : "Register" };
}

export default async function Register({ params, searchParams }: P) {
  const { slug } = await params;
  const ev = await loadEvent(slug);
  if (!ev) notFound();
  const w = registrationWindow(ev);
  if (!w.open) return <main className="shell" style={brandStyle(ev)}><section className="hero"><h1>{ev.name}</h1><p>{w.reason}</p></section></main>;
  const draft = await draftFromCookie(ev, (await cookies()).get(cookieName(slug))?.value);
  return (
    <main className="shell" style={brandStyle(ev)}>
      <RegisterForm
        ev={{ slug: ev.slug, name: ev.name, currency: ev.currency, texts: ev.texts, hostFederation: ev.hostFederation,
              setup: ev.setup, tickets: ev.tickets, products: ev.products }}
        countries={COUNTRIES}
        initialForm={draft?.form ?? {}}
        initialDocs={draft?.docs ?? []}
        initialStep={(await searchParams).step}
        today={new Date().toISOString().slice(0, 10)}
      />
    </main>
  );
}

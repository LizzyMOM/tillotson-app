import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadEvent, registrationWindow } from "@/lib/event";
import { brandStyle } from "@/lib/brand";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const ev = await loadEvent((await params).slug);
  return { title: ev?.name ?? "Event" };
}

export default async function EventHome({ params }: P) {
  const ev = await loadEvent((await params).slug);
  if (!ev) notFound();
  const w = registrationWindow(ev);
  const dates = new Date(ev.startsOn).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) + " – " +
    new Date(ev.endsOn).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <main className="shell" style={brandStyle(ev)}>
      <section className="hero">
        <div className="logo">{ev.brand.logo_text ?? ev.name.slice(0, 2)}</div>
        <div>
          <div className="meta">{dates}{ev.venue ? " · " + ev.venue : ""}</div>
          <h1 style={{ marginTop: 8 }}>{ev.name}</h1>
        </div>
        <p>Register once. Your race number, checklist, bulletins and schedule unlock straight after.</p>
        {w.open
          ? <Link className="big" href={`/e/${ev.slug}/register`}>Register as a driver</Link>
          : <p style={{ fontWeight: 700 }}>{w.reason}</p>}
      </section>
    </main>
  );
}

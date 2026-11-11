import Link from "next/link";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const events = await sql`select slug, name, starts_on, ends_on from events where status = 'open' order by starts_on`;
  return (
    <main className="shell">
      <section className="hero">
        <h1>Events</h1>
        {events.length ? events.map((e) => (
          <Link key={e.slug} className="big" href={`/e/${e.slug}`}>{e.name}</Link>
        )) : <p>No events are open right now.</p>}
      </section>
    </main>
  );
}

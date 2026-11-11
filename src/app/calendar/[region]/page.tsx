import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ScrollToNext from "@/components/ScrollToNext";
import { calendar, regionName, regionTitles, titleOf, isGlobal, dateRange, dayRange, KIND_LABEL, type Entry } from "@/lib/calendar";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ region: string }>; searchParams: Promise<{ year?: string; today?: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const name = await regionName((await params).region);
  return { title: name ? titleOf(await regionTitles(), name) : "Calendar" };
}

/** The dealer calendar for one region: Tillotson's official dates plus dealers' own events. */
export default async function Calendar({ params, searchParams }: P) {
  const { region } = await params;
  const sp = await searchParams;
  const year = Number(sp.year) || 2027;
  // ?today=2027-06-01 previews the calendar as it will look on that day.
  const today = /^\d{4}-\d{2}-\d{2}$/.test(sp.today ?? "") ? sp.today! : new Date().toISOString().slice(0, 10);
  const name = await regionName(region);
  if (!name) notFound();
  const titles = await regionTitles();
  const entries = await calendar(region, year);
  // Leave the country off tracks in the calendar's own country.
  const homeCountry = ["UK", "Northern Ireland", "England", "Scotland", "Wales"].includes(name) ? "United Kingdom" : name;
  const stateOf = (e: Entry) => (e.endsOn < today ? "done" : e.startsOn <= today ? "live" : "soon");
  const next = entries.find((e) => stateOf(e) !== "done");
  const finished = entries.filter((e) => stateOf(e) === "done").length;
  const months = new Map<string, Entry[]>();
  for (const e of entries) {
    const m = new Date(e.startsOn + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    months.set(m, [...(months.get(m) ?? []), e]);
  }
  return (
    <main className="shell cal">
      {finished > 0 && next && <ScrollToNext />}
      <header className="top">
        <div className="ev">Tillotson · dealer calendar</div>
        <h1>{titleOf(titles, name)} {year}</h1>
        <div className="sub">
          {finished ? `${finished} of ${entries.length} events finished` : `${entries.length} events`} · tap a track for its map and directions
        </div>
        {next && finished > 0 && <a className="jump" href="#next">{stateOf(next) === "live" ? "On now" : "Next up"}: {next.round && next.series ? `${next.series} · ${next.round}` : next.title} ↓</a>}
      </header>
      <div className="stripe" />
      <div className="body">
        {[...months].map(([month, list]) => (
          <section key={month} className={"month" + (list.every((e) => stateOf(e) === "done") ? " past" : "")} aria-labelledby={"m-" + month}>
            <h2 id={"m-" + month}>{month}</h2>
            {list.map((e) => stateOf(e) === "done" ? (
              // Finished: one compact grey line, still tappable through to the track.
              <article key={e.id} className="entry finished">
                <div className="when"><b>{dateRange(e.startsOn, e.endsOn)}</b></div>
                <div className="what">
                  <h3>{e.round && e.series ? `${e.series} · ${e.round}` : e.title}</h3>
                  {e.venue && <Link className="venue" href={`/tracks/${e.venue.slug}`}>{e.venue.name}</Link>}
                </div>
                {e.resultsUrl || e.photosUrl ? (
                  <div className="after">
                    {e.resultsUrl && <a className="res" href={e.resultsUrl} target="_blank" rel="noopener">Results</a>}
                    {e.photosUrl && <a className="res ghost" href={e.photosUrl} target="_blank" rel="noopener">Photos</a>}
                  </div>
                ) : <span className="chip">Finished</span>}
              </article>
            ) : (
              <article key={e.id} id={e === next ? "next" : undefined} className={"entry k-" + e.kind + (e === next ? " next" : "")}>
                {e === next && <div className="flag">{stateOf(e) === "live" ? "On now" : "Next up"}</div>}
                <div className="when"><b>{dateRange(e.startsOn, e.endsOn)}</b><span>{dayRange(e.startsOn, e.endsOn)}</span></div>
                <div className="what">
                  <div className="kicker">{isGlobal(e) ? "Tillotson T4 Global Events" : e.kind === "series" ? "Series" : KIND_LABEL[e.kind]}</div>
                  <h3>{e.round && e.series ? `${e.series} · ${e.round}` : e.title}</h3>
                  {e.venue && <Link className="venue" href={`/tracks/${e.venue.slug}`}>
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
                    {e.venue.name}{e.venue.country !== homeCountry && e.venue.country !== name ? `, ${e.venue.country}` : ""}
                  </Link>}
                  {stateOf(e) === "live" && e.liveTimingUrl && <a className="res live" href={e.liveTimingUrl} target="_blank" rel="noopener"><span className="dot" aria-hidden="true" />Live timing</a>}
                  {e.description && <p>{e.description}</p>}
                  {(e.tags.length > 0 || e.kind === "pre_season" || e.kind === "international" || isGlobal(e) || e.regions.length > 1) && <div className="tags">
                    {e.kind === "pre_season" && <span className="chip">Pre-season</span>}
                    {e.kind === "international" && <span className="chip">International</span>}
                    {isGlobal(e) && <span className="chip global">On every country's calendar</span>}
                    {!isGlobal(e) && e.regions.length > 1 && <span className="chip global">Also on {e.regions.filter((r) => r !== name).map((r) => titles[r] ?? r).join(" & ")} calendar{e.regions.length > 2 ? "s" : ""}</span>}
                    {e.tags.map((t) => <span key={t} className="chip hot">{t}</span>)}
                  </div>}
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}

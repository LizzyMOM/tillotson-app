import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { venue, mapEmbed, directionsUrl, satelliteUrl, dateRange, KIND_LABEL } from "@/lib/calendar";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const r = await venue((await params).slug);
  return { title: r?.venue.fullName ?? r?.venue.name ?? "Track" };
}

export default async function Track({ params }: P) {
  const r = await venue((await params).slug);
  if (!r) notFound();
  const v = r.venue, map = mapEmbed(v), sat = satelliteUrl(v);
  return (
    <main className="shell cal">
      <header className="top">
        <Link className="bk" href="/calendar/uk">‹ Calendar</Link>
        <div className="ev">Track</div>
        <h1>{v.name}</h1>
        {v.fullName && v.fullName !== v.name && <div className="sub">{v.fullName}</div>}
      </header>
      <div className="stripe" />
      <div className="body">
        {v.layoutImageUrl && <img className="layout" src={v.layoutImageUrl} alt={`${v.name} track layout`} />}
        {map && <figure className="map">
          <iframe title={`Map of ${v.name}`} src={map} loading="lazy" />
          <figcaption>{v.approx ? "Pin shows the area; check the exact entrance with the track." : "Map © OpenStreetMap contributors"}</figcaption>
        </figure>}
        <div className="panel">
          {v.address && <div><span className="lbl">Address</span><div className="addr">{v.address}<br />{v.country}</div></div>}
          {v.lengthM && <div className="hint">Track length {v.lengthM} m</div>}
          <div className="acts">
            <a className="big" href={directionsUrl(v)} target="_blank" rel="noopener">Directions</a>
            {sat && <a className="big ghost" href={sat} target="_blank" rel="noopener">Satellite view</a>}
            {v.website && <a className="big ghost" href={v.website} target="_blank" rel="noopener">Track website</a>}
          </div>
        </div>
        {r.entries.length > 0 && <>
          <div className="sec"><h2>Coming up here</h2></div>
          {r.entries.map((e) => (
            <div key={e.id} className="mini">
              <b>{dateRange(e.startsOn, e.endsOn)}</b>
              <span>{e.round && e.series ? `${e.series} · ${e.round}` : e.title}{e.round ? "" : ` · ${KIND_LABEL[e.kind]}`}</span>
            </div>
          ))}
        </>}
      </div>
    </main>
  );
}

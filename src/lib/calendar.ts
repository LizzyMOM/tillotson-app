import "server-only";
import { sql } from "./db";

// For now everything belongs to the one organiser; with logins this comes from the user.
export const ORGANISER = "00000000-0000-4000-8000-000000000001";

export interface Venue {
  slug: string; name: string; fullName: string | null; address: string | null; country: string;
  lat: number | null; lng: number | null; approx: boolean; website: string | null; layoutImageUrl: string | null; lengthM: number | null;
}
export interface Entry {
  id: string; regions: string[]; kind: string; series: string | null; round: string | null; title: string;
  startsOn: string; endsOn: string; tags: string[]; description: string | null; source: string; liveTimingUrl: string | null; resultsUrl: string | null; photosUrl: string | null; venue: Venue | null;
}

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));
const venueOf = (r: Record<string, any>): Venue | null => r.v_slug ? {
  slug: r.v_slug, name: r.v_name, fullName: r.v_full_name, address: r.v_address, country: r.v_country,
  lat: r.v_lat == null ? null : Number(r.v_lat), lng: r.v_lng == null ? null : Number(r.v_lng), approx: r.v_approx,
  website: r.v_website, layoutImageUrl: r.v_layout, lengthM: r.v_length,
} : null;
const entryOf = (r: Record<string, any>): Entry => ({
  id: r.id, regions: r.regions, kind: r.kind, series: r.series, round: r.round, title: r.title, startsOn: iso(r.starts_on), endsOn: iso(r.ends_on),
  tags: r.tags, description: r.description, source: r.source, liveTimingUrl: r.live_timing_url, resultsUrl: r.results_url, photosUrl: r.photos_url, venue: venueOf(r),
});
const entryCols = sql`c.id, c.regions, c.kind, c.series, c.round, c.title, c.starts_on, c.ends_on, c.tags, c.description, c.source, c.live_timing_url, c.results_url, c.photos_url,
  v.slug v_slug, v.name v_name, v.full_name v_full_name, v.address v_address, v.country v_country, v.lat v_lat, v.lng v_lng,
  v.location_approx v_approx, v.website v_website, v.layout_image_url v_layout, v.length_m v_length`;

/** Tillotson's global events appear on every country's calendar. */
export const GLOBAL = "Global";

export async function calendar(region: string, year: number): Promise<Entry[]> {
  const rows = await sql`select ${entryCols} from calendar_entries c left join venues v on v.id = c.venue_id
    where c.organiser_id = ${ORGANISER}
      and (${GLOBAL} = any(c.regions) or exists (select 1 from unnest(c.regions) r where ${SLUG_SQL(sql`r`)} = lower(${region})))
      and c.ends_on >= ${`${year}-01-01`} and c.starts_on <= ${`${year}-12-31`}
    order by c.starts_on, c.title`;
  return rows.map(entryOf);
}
export async function regions(): Promise<string[]> {
  const rows = await sql`select distinct r from calendar_entries, unnest(regions) r where organiser_id = ${ORGANISER} and r <> ${GLOBAL} order by r`;
  return rows.map((x) => x.r);
}
/** 'Northern Ireland' ↔ /calendar/northern-ireland */
export const regionSlug = (r: string) => r.toLowerCase().replace(/\s+/g, "-");
const SLUG_SQL = (col: ReturnType<typeof sql>) => sql`regexp_replace(lower(${col}), '[[:space:]]+', '-', 'g')`;
/** The region's name as written in the calendar, e.g. 'northern-ireland' → 'Northern Ireland'. */
export async function regionName(slug: string): Promise<string | null> {
  const [row] = await sql`select r from calendar_entries, unnest(regions) r
    where organiser_id = ${ORGANISER} and ${SLUG_SQL(sql`r`)} = lower(${slug}) limit 1`;
  return row?.r ?? null;
}
export const isGlobal = (e: Entry) => e.regions.includes(GLOBAL);
export async function venue(slug: string): Promise<{ venue: Venue; entries: Entry[] } | null> {
  const [v] = await sql`select slug v_slug, name v_name, full_name v_full_name, address v_address, country v_country, lat v_lat, lng v_lng,
    location_approx v_approx, website v_website, layout_image_url v_layout, length_m v_length, id
    from venues where organiser_id = ${ORGANISER} and slug = ${slug}`;
  if (!v) return null;
  const rows = await sql`select ${entryCols} from calendar_entries c join venues v on v.id = c.venue_id
    where c.venue_id = ${v.id} and c.ends_on >= current_date - 1 order by c.starts_on`;
  return { venue: venueOf(v)!, entries: rows.map(entryOf) };
}

// ---------------------------------------------------------------- display helpers
export function dateRange(a: string, b: string): string {
  const d1 = new Date(a + "T12:00:00Z"), d2 = new Date(b + "T12:00:00Z");
  const day = (d: Date) => d.getUTCDate();
  const mon = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  if (a === b) return `${day(d1)} ${mon(d1)}`;
  return d1.getUTCMonth() === d2.getUTCMonth() ? `${day(d1)}–${day(d2)} ${mon(d1)}` : `${day(d1)} ${mon(d1)} – ${day(d2)} ${mon(d2)}`;
}
export function dayRange(a: string, b: string): string {
  const wd = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return a === b ? wd(a) : `${wd(a)}–${wd(b)}`;
}
export const KIND_LABEL: Record<string, string> = {
  championship: "Championship", pre_season: "Pre-season", international: "International", series: "UK Kart Series",
  test_day: "Open test day", club_race: "Club race", other: "Event",
};
/** Map around the track, zoomed in far enough that OpenStreetMap draws the circuit itself. */
export function mapEmbed(v: Venue): string | null {
  if (v.lat == null || v.lng == null) return null;
  const dLat = v.approx ? 0.012 : 0.0045, dLng = dLat * 1.7;
  const bbox = [v.lng - dLng, v.lat - dLat, v.lng + dLng, v.lat + dLat].map((n) => n.toFixed(5)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${v.lat},${v.lng}`;
}
export const directionsUrl = (v: Venue) =>
  v.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((v.fullName ?? v.name) + " " + (v.address ?? ""))}`;
export const satelliteUrl = (v: Venue) => v.lat != null ? `https://www.google.com/maps/@${v.lat},${v.lng},500m/data=!3m1!1e3` : null;

/** Each calendar's heading in full, e.g. 'UK' → 'T4 Series UK'. Falls back to '<name> calendar'. */
export async function regionTitles(): Promise<Record<string, string>> {
  const rows = await sql`select name, title from calendar_regions where organiser_id = ${ORGANISER}`;
  return Object.fromEntries(rows.map((r) => [r.name, r.title]));
}
export const titleOf = (titles: Record<string, string>, name: string) => titles[name] ?? `${name} calendar`;

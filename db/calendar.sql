-- Calendar and tracks.
-- Tillotson posts the official calendar for each region; dealers add their own races,
-- open test days and other events. Their assigned drivers are notified and see them on
-- their bulletin board. Every entry points at a track, and each track has its own page
-- with a map and directions.

create table venues (
  id                uuid primary key default gen_random_uuid(),
  organiser_id      uuid not null references organisers(id) on delete cascade,
  slug              text not null,                 -- in the link: /tracks/buckmore-park
  name              text not null,                 -- as it's known in the paddock: 'PFI'
  full_name         text,                          -- 'PF International'
  address           text,
  country           text not null,
  lat               numeric(9,6),
  lng               numeric(9,6),
  location_approx   boolean not null default false,-- pin is near the track, not on it
  website           text,
  layout_image_url  text,                          -- official track diagram, uploaded with the track's permission
  length_m          integer,
  notes             text,
  unique (organiser_id, slug)
);

create type calendar_kind as enum ('championship', 'pre_season', 'international', 'series', 'test_day', 'club_race', 'other');
create type calendar_source as enum ('tillotson', 'dealer');

create table calendar_entries (
  id            uuid primary key default gen_random_uuid(),
  organiser_id  uuid not null references organisers(id) on delete cascade,
  regions       text[] not null,               -- which calendars it's on: '{UK}', '{UK,Ireland,Northern Ireland}', '{Global}' = every country
  check (cardinality(regions) > 0),
  kind          calendar_kind not null,
  series        text,                          -- 'T4 Series UK', 'UK Kart Series'
  round         text,                          -- 'Round 3' (always written in full)
  title         text not null,
  starts_on     date not null,
  ends_on       date not null,
  venue_id      uuid references venues(id),
  tags          text[] not null default '{}',  -- e.g. 'T4 Nations Cup qualifier'
  description   text,
  live_timing_url text,                        -- during the event: link to live timing
  results_url   text,                          -- added after the event: timing results
  photos_url    text,                          -- added after the event: photo album
  source        calendar_source not null default 'tillotson',
  added_by      uuid references users(id),     -- the dealer or admin who added it
  created_at    timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index calendar_dates on calendar_entries (organiser_id, starts_on);
create index calendar_entries_regions on calendar_entries using gin (regions);

-- What each country's calendar is called, in full: 'UK' → 'T4 Series UK'.
create table calendar_regions (
  organiser_id  uuid not null references organisers(id) on delete cascade,
  name          text not null,                 -- as used in calendar_entries.regions
  title         text not null,                 -- heading shown on the calendar
  primary key (organiser_id, name)
);

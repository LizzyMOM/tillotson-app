-- Event app · database schema
-- White-labelled: nothing about a specific event lives in code. Each organiser runs any
-- number of events; every event carries its own branding, host country, categories,
-- tickets, rentals, clothing, bundles and sign-on slots.
-- Money is stored in cents (integers). Times are timestamptz.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- organisers & people
create table organisers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Staff, officials and organiser admins. Drivers are not users: they sign in with
-- race number + PIN against their registration.
create type user_role as enum ('admin', 'official', 'staff');
create table users (
  id            uuid primary key default gen_random_uuid(),
  organiser_id  uuid not null references organisers(id) on delete cascade,
  email         text not null unique,
  name          text not null,
  role          user_role not null,
  federation_id uuid,                       -- officials: the federation they act for (optional)
  password_hash text,                       -- null until they accept the invite
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- federations (ASNs)
-- Kept once per organiser and reused for every event. The rule says whether a licence
-- from this federation carries start permission for events abroad.
create type start_permission_rule as enum ('on_licence', 'check', 'letter');
create table federations (
  id            uuid primary key default gen_random_uuid(),
  organiser_id  uuid not null references organisers(id) on delete cascade,
  name          text not null,              -- e.g. 'RFEDA'
  country       text not null,              -- e.g. 'Spain'
  start_permission start_permission_rule not null default 'check',
  note          text,                       -- shown to officials, e.g. wording to look for
  active        boolean not null default true,
  unique (organiser_id, name)
);
alter table users add constraint users_federation_fk foreign key (federation_id) references federations(id);

-- ---------------------------------------------------------------- events
create type event_status as enum ('draft', 'open', 'closed', 'archived');
create table events (
  id                    uuid primary key default gen_random_uuid(),
  organiser_id          uuid not null references organisers(id) on delete cascade,
  slug                  text not null unique,           -- used in the URL: /e/t4nc27
  name                  text not null,
  venue                 text,
  country               text not null,                  -- host country
  host_federation_id    uuid references federations(id),-- licences from here need no start permission
  starts_on             date not null,
  ends_on               date not null,
  timezone              text not null default 'Europe/Madrid',
  currency              char(3) not null default 'EUR',
  deposit_cents         integer not null default 0 check (deposit_cents >= 0),
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  tee_sizes             text[] not null default '{}',   -- free T-shirt size list
  seat_sizes            text[] not null default '{}',   -- kart seat sizes (when a ticket includes a kart)
  brand                 jsonb not null default '{}',    -- {logo_url, primary, accent, ...}
  texts                 jsonb not null default '{}',    -- organiser wording: terms, deposit, start permission, safety
  status                event_status not null default 'draft',
  created_at            timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table categories (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,                -- always the full name, e.g. 'T4 Senior168'
  min_age     integer,
  max_age     integer,
  sort_order  integer not null default 0,
  -- Race numbers. New registrations get the next number in order of payment from
  -- number_start..number_end. reserved_start..reserved_end is held back for drivers an admin
  -- picks (e.g. last year's top finishers get 101, 102, 201 ...).
  number_start   integer,
  number_end     integer,
  reserved_start integer,
  reserved_end   integer,
  unique (event_id, name),
  check (number_end >= number_start),
  check (reserved_end >= reserved_start)
);

create table tickets (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  name           text not null,             -- 'Option 1'
  price_cents    integer not null check (price_cents >= 0),
  includes       text[] not null default '{}',
  excludes       text[] not null default '{}',
  note           text,
  includes_kart  boolean not null default false,   -- turns on kart fitting + kart sheets
  category_ids   uuid[],                    -- null = every category
  sort_order     integer not null default 0,
  active         boolean not null default true
);

-- Anything sold or rented at registration: toolkit, clothing, extra items.
create type product_kind as enum ('rental', 'clothing', 'other');
create table products (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  kind          product_kind not null,
  name          text not null,
  description   text,
  price_cents   integer not null check (price_cents >= 0),
  sizes         text[] not null default '{}',  -- empty = no size
  max_qty       integer not null default 1,     -- rentals: 1, clothing: more
  bundle_group  text,                           -- products sharing a group form a bundle
  refundable    boolean not null default true,
  sort_order    integer not null default 0,
  active        boolean not null default true
);

-- One of each product in the group = discount on that set.
create table bundles (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  bundle_group  text not null,
  name          text not null,
  discount_pct  numeric(5,2) not null check (discount_pct > 0 and discount_pct <= 100),
  unique (event_id, bundle_group)
);

-- Event sign-on slots. category_id null + for_unapproved = the "documents in progress" slot.
create table signon_slots (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  label           text not null,
  category_id     uuid references categories(id) on delete cascade,
  for_unapproved  boolean not null default false,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  check (ends_at > starts_at)
);

-- ---------------------------------------------------------------- registrations
create type registration_status as enum ('draft', 'awaiting_payment', 'paid', 'cancelled', 'refunded');
create type review_status as enum ('pending', 'approved', 'action_needed');
create table registrations (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete restrict,
  status              registration_status not null default 'draft',
  draft_token_hash    text,                 -- lets the browser resume a draft without an account
  form                jsonb not null default '{}',  -- the form as typed, while still a draft

  -- driver
  first_name          text, last_name text, gender text, date_of_birth date,
  email               text, phone text,
  address_line1       text, address_line2 text, city text, region text, postcode text, country text,

  -- parent / guardian (drivers under 18)
  guardian_first_name text, guardian_last_name text, guardian_email text, guardian_phone text,
  guardian_same_address boolean not null default true,
  guardian_address    jsonb,
  entrant_ack_at      timestamptz,

  -- licence
  category_id         uuid references categories(id),
  licence_number      text,
  licence_expires_on  date,
  federation_id       uuid references federations(id),
  federation_other    text,                 -- when the driver's federation isn't listed
  federation_email    text,
  representing        text,                 -- country represented
  licence_ack_at      timestamptz,
  start_permission_ack_at timestamptz,

  -- entry
  ticket_id           uuid references tickets(id),
  weight_kg           numeric(5,1), height_cm integer, waist_cm integer, seat_size text,
  seat_ack_at         timestamptz,
  free_tee_size       text,

  -- review & pay
  billing_same        boolean not null default true,
  billing             jsonb,
  coupon_code         text,
  terms_accepted_at   timestamptz, privacy_accepted_at timestamptz, safety_accepted_at timestamptz,
  subtotal_cents      integer, discount_cents integer, deposit_cents integer, total_cents integer,

  -- after payment
  race_number         integer,
  pin_hash            text,
  paid_at             timestamptz,

  -- document review by officials
  review              review_status not null default 'pending',
  reviewed_by         uuid references users(id),
  reviewed_at         timestamptz,
  start_permission_confirmed_on_licence boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (event_id, race_number)
);
create index registrations_event_status on registrations(event_id, status);

create table registration_lines (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid not null references registrations(id) on delete cascade,
  product_id       uuid not null references products(id),
  size             text,
  qty              integer not null check (qty > 0),
  unit_price_cents integer not null           -- price at the time of registration
);

create type document_kind as enum ('licence_front', 'licence_back', 'start_permission', 'entrant_licence');
create type document_status as enum ('submitted', 'approved', 'rejected');
create table documents (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid not null references registrations(id) on delete cascade,
  kind             document_kind not null,
  storage_key      text not null,             -- path in private file storage
  filename         text not null,
  mime_type        text not null,
  size_bytes       integer not null,
  status           document_status not null default 'submitted',
  reason           text,                      -- why a new upload was asked for
  reviewed_by      uuid references users(id),
  reviewed_at      timestamptz,
  uploaded_at      timestamptz not null default now(),
  replaced_by      uuid references documents(id)
);
create index documents_registration on documents(registration_id);

create type payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');
create table payments (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid references registrations(id) on delete set null,
  event_id         uuid not null references events(id),
  purpose          text not null,             -- 'registration', 'lead rental', 'missing tools', ...
  provider         text not null,             -- 'stripe', 'cash', 'card_terminal', 'deposit', 'test'
  provider_ref     text,
  amount_cents     integer not null,
  currency         char(3) not null,
  status           payment_status not null default 'pending',
  taken_by         uuid references users(id),
  created_at       timestamptz not null default now()
);
create unique index payments_provider_ref on payments(provider, provider_ref) where provider_ref is not null;

-- Every change an official, staff member or admin makes, for the audit trail.
create table audit_log (
  id         bigserial primary key,
  event_id   uuid references events(id) on delete cascade,
  user_id    uuid references users(id),
  action     text not null,
  subject    text,
  detail     jsonb,
  at         timestamptz not null default now()
);

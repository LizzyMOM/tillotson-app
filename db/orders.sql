-- Order Angel · dealer orders
-- Dealers order on the Tillotson website (WooCommerce). Every order arrives here by webhook and is
-- walked through five stages: submitted → verified → in progress → shipped → received.
-- WooCommerce stays the source of truth for what is on the order; this app owns the stage,
-- the people, the messages and the history. Money in cents, times as timestamptz.
-- Tables are prefixed oa_ to keep them apart from the event app's.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- dealers and people
-- A dealer is a business, matched to its WooCommerce customer account.
create table oa_dealers (
  id               uuid primary key default gen_random_uuid(),
  woo_customer_id  bigint unique,                 -- null for a dealer added by hand before they order
  name             text not null,
  country          text,
  region           text,                          -- e.g. 'UK', 'Ireland', 'Asia'; for filtering
  email            text,
  needs_setup      boolean not null default false,-- created automatically from an unknown Woo customer
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Who can sign in. A stand-in until Tillotson ID: same roles, same rules.
--   admin   : Mark, Andrew. See and do everything.
--   factory : Shane. Sees everything (incl. prices, he invoices); processes, ships, invoices.
--   dealer  : one or more people at a dealer. See only their own dealer's orders.
create type oa_role as enum ('admin', 'factory', 'dealer');
create table oa_accounts (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text not null,
  role        oa_role not null,
  dealer_id   uuid references oa_dealers(id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check ((role = 'dealer') = (dealer_id is not null))
);

-- ---------------------------------------------------------------- orders
create type oa_stage as enum ('submitted', 'verified', 'in_progress', 'shipped', 'received', 'cancelled');
create type oa_condition as enum ('ok', 'damaged', 'missing');

create table oa_orders (
  id                 uuid primary key default gen_random_uuid(),
  woo_order_id       bigint unique,               -- null only for orders made locally without WooCommerce (development)
  number             text not null,               -- the order number dealers see
  dealer_id          uuid not null references oa_dealers(id),
  stage              oa_stage not null default 'submitted',
  stage_since        timestamptz not null default now(),   -- the 14-day clock runs from here, per stage
  eta                date,                        -- new estimated date given with a delay or a shipment
  eta_reason         text,
  currency           char(3) not null default 'EUR',
  total_cents        integer not null default 0,
  tax_cents          integer not null default 0,
  shipping_address   jsonb,
  billing_address    jsonb,                       -- copied onto a reorder
  dealer_note        text,                        -- the note the dealer typed at checkout
  ordered_at         timestamptz not null default now(),
  woo_status         text,
  woo_modified_at    timestamptz,                 -- ignore webhook deliveries older than this
  -- received
  received_at        timestamptz,
  received_by        uuid references oa_accounts(id),
  received_auto      boolean not null default false,  -- closed automatically, never confirmed by the dealer
  received_condition oa_condition,
  received_note      text,
  reminders_sent     integer not null default 0,
  last_reminder_at   timestamptz,
  -- cancelled (by an admin, after talking to the dealer)
  cancelled_reason   text,
  -- invoicing (Shane)
  invoice_number     text,
  invoiced_at        timestamptz,
  invoiced_by        uuid references oa_accounts(id),
  created_at         timestamptz not null default now()
);
create index oa_orders_dealer on oa_orders (dealer_id, ordered_at desc);
create index oa_orders_stage on oa_orders (stage, stage_since);

create table oa_order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references oa_orders(id) on delete cascade,
  woo_item_id      bigint,                        -- the WooCommerce line item id
  woo_product_id   bigint,
  sku              text,
  name             text not null,
  qty              integer not null check (qty > 0),
  unit_price_cents integer not null,
  total_cents      integer not null,
  position         integer not null default 0
);
create index oa_order_items_order on oa_order_items (order_id, position);

-- An edit by Mark or Andrew, waiting for the dealer to approve. Only once approved is it pushed to
-- WooCommerce. lines is the full proposed order: [{wooItemId, wooProductId, sku, name, qty, unitPriceCents}]
create type oa_proposal_status as enum ('pending', 'approved', 'queried', 'withdrawn');
create table oa_proposals (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references oa_orders(id) on delete cascade,
  lines         jsonb not null,
  note          text,                             -- why it changed, shown to the dealer
  status        oa_proposal_status not null default 'pending',
  created_by    uuid not null references oa_accounts(id),
  created_at    timestamptz not null default now(),
  decided_by    uuid references oa_accounts(id),
  decided_at    timestamptz,
  dealer_reply  text,
  pushed_at     timestamptz,                      -- written to WooCommerce
  push_error    text
);
create unique index oa_one_pending_proposal on oa_proposals (order_id) where status = 'pending';

-- One order can go in several parcels. The order is shipped when the final one goes.
create table oa_shipments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references oa_orders(id) on delete cascade,
  seq           integer not null,
  carrier       text not null,
  tracking      text not null,
  tracking_url  text,
  contents      text,                             -- e.g. 'Engines; frames follow in parcel 2'
  eta           date,
  final         boolean not null default false,
  created_by    uuid not null references oa_accounts(id),
  created_at    timestamptz not null default now(),
  unique (order_id, seq)
);

-- Shane raises a problem to Mark and Andrew; they tell the dealer (delay notice) and resolve it.
create table oa_issues (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references oa_orders(id) on delete cascade,
  kind         text not null default 'factory',  -- 'factory' (raised by Shane) or 'received' (damaged/missing on arrival)
  body         text not null,
  raised_by    uuid not null references oa_accounts(id),
  raised_at    timestamptz not null default now(),
  resolved_by  uuid references oa_accounts(id),
  resolved_at  timestamptz,
  resolution   text
);

-- The message thread on each order. internal = staff only (Mark, Andrew, Shane), never shown to the dealer.
create table oa_messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references oa_orders(id) on delete cascade,
  author_id   uuid references oa_accounts(id),
  body        text not null,
  internal    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index oa_messages_order on oa_messages (order_id, created_at);

-- Photos the dealer adds when marking an order received.
create table oa_files (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references oa_orders(id) on delete cascade,
  storage_key  text not null,
  filename     text not null,
  mime         text not null,
  size_bytes   integer not null,
  added_by     uuid references oa_accounts(id),
  created_at   timestamptz not null default now()
);

-- Who did what and when, for every order. actor null = WooCommerce or the daily check.
create table oa_activity (
  id        bigserial primary key,
  order_id  uuid not null references oa_orders(id) on delete cascade,
  actor_id  uuid references oa_accounts(id),
  action    text not null,
  detail    jsonb,
  at        timestamptz not null default now()
);
create index oa_activity_order on oa_activity (order_id, at);

-- Notifications shown in the app (and emailed).
create table oa_notifications (
  id          bigserial primary key,
  account_id  uuid not null references oa_accounts(id) on delete cascade,
  order_id    uuid references oa_orders(id) on delete cascade,
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz
);
create index oa_notifications_unread on oa_notifications (account_id, created_at desc) where read_at is null;

-- WooCommerce retries webhooks; each delivery is handled once.
create table oa_webhook_deliveries (
  delivery_id  text primary key,
  topic        text,
  received_at  timestamptz not null default now()
);

-- The numbers we agreed to set later, in one row. Change them here, not in code.
create table oa_settings (
  id                     boolean primary key default true check (id),
  flag_days              integer not null default 14,   -- per stage: flag an order that hasn't moved in this many days
  received_reminder_days integer not null default 3,    -- remind the dealer to press Received every this many days
  auto_close_days        integer not null default 30,   -- after shipping, close as 'not confirmed' after this many days
  shop_url               text                            -- the website's spare-parts finder (New order button)
);
insert into oa_settings default values;

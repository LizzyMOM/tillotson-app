-- T4 Nations Cup 2027 · event setup
-- Everything here is data an organiser edits in the admin screens, not code.
-- Marked PLACEHOLDER where the real value isn't confirmed yet.

begin;

insert into organisers (id, name) values ('00000000-0000-4000-8000-000000000001', 'Team Tillotson');

-- Federations: kept once, reused for every event.
-- PLACEHOLDER rules: every federation is 'check' (officials read the licence) until the
-- country-by-country start permission list is added.
insert into federations (organiser_id, name, country, start_permission) values
  ('00000000-0000-4000-8000-000000000001', 'RFEDA', 'Spain', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'Motorsport UK', 'United Kingdom', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'Motorsport Ireland', 'Ireland', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'FFSA', 'France', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'ACI Sport', 'Italy', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'DMSB', 'Germany', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'KNAF', 'Netherlands', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'RACB', 'Belgium', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'FPAK', 'Portugal', 'check'),
  ('00000000-0000-4000-8000-000000000001', 'Svenska Bilsportförbundet', 'Sweden', 'check');

insert into events (id, organiser_id, slug, name, venue, country, host_federation_id, starts_on, ends_on,
  timezone, currency, deposit_cents, registration_opens_at, registration_closes_at,
  tee_sizes, seat_sizes, brand, texts, status)
select '00000000-0000-4000-8000-0000000000e1', o.id, 't4nc27', 'T4 Nations Cup 2027',
  'South Garda Karting, Lonato',                     -- from the T4 Series UK 2027 calendar
  'Italy', f.id,
  date '2027-09-22', date '2027-09-26',              -- Wednesday to Sunday
  'Europe/Rome', 'EUR', 30000,
  timestamptz '2027-01-15 09:00+01', timestamptz '2027-08-22 23:59+02',  -- PLACEHOLDER opening and closing
  array['Youth (age 4)','Youth small (age 5–7)','Youth (age 8–10)','Youth (age 12)','S','M','L','XL','XXL','3XL'],
  array['XXS','XS','S','M','L','XL','XXL'],
  '{"primary":"#0B1B2B","accent":"#0074C8","logo_text":"T4"}'::jsonb,
  jsonb_build_object(
    'licence', 'All drivers entering the event must hold a valid National Karting Licence issued by their ASN affiliated to the FIA.',
    'start_permission', 'Drivers will need to show start permission. This can be found on the back of your licence or can be obtained from your ASN. It is the driver''s responsibility to provide all relevant documentation. Refunds will not be issued to drivers who arrive without the relevant documentation. There will be no exceptions.',
    'entrant', 'All drivers under 18 must have an entrant present at registration with a valid entrant''s licence.',
    'seat', 'If the seat size is chosen incorrectly, the driver will pay a fee to change it.',
    'deposit', 'Mandatory. Covers smaller kart damage and rental items at the event. Refunded in varying amounts depending on the kart''s condition and the return of all rented items. Crash damage is assessed on site case by case. Non-refundable if the driver does not attend.',
    'terms', 'It is the applicant''s responsibility to ensure the documentation needed to compete is correct and meets the requirements set out by Tillotson. Each driver under 18 must have an entrant present at registration with an entrant''s licence. It is the responsibility of each driver to ensure there are no medical reasons, to the best of their knowledge, which would stop them competing at this event. Refunds will not be given to any driver who has not fully complied with the regulations set out by Tillotson. Partial refunds may be given in extenuating circumstances to drivers who cannot attend and notify Tillotson by email before the registration closing date.',
    'safety', 'It is the driver''s responsibility to make sure all driver equipment meets the required FIA safety standards: karting body protection FIA 8870-2018, karting helmets FIA 8878-2024, karting overalls & clothing FIA 8877-2022.'),
  'open'
from organisers o, federations f where o.id = '00000000-0000-4000-8000-000000000001' and f.name = 'ACI Sport';

-- Race numbers: in order of payment from the category's range; the reserved block is for
-- drivers an admin assigns (previous year's top finishers).
-- T4 Bambino (if an event offers it): numbers 10–99, reserved 1–9.
insert into categories (event_id, name, min_age, max_age, sort_order, number_start, number_end, reserved_start, reserved_end) values
  ('00000000-0000-4000-8000-0000000000e1', 'T4 Mini',      7, 12,   1, 110, 199, 101, 109),
  ('00000000-0000-4000-8000-0000000000e1', 'T4 Junior',    11, 16,  2, 210, 299, 201, 209),
  ('00000000-0000-4000-8000-0000000000e1', 'T4 Senior',    15, null, 3, 310, 499, 301, 309),
  ('00000000-0000-4000-8000-0000000000e1', 'T4 Senior168', 15, null, 4, 510, 599, 501, 509);

insert into tickets (event_id, name, price_cents, includes, excludes, note, includes_kart, sort_order) values
  ('00000000-0000-4000-8000-0000000000e1', 'Option 1', 279500,
   array['Kart & trolley','Transponder','Practice tyres','Race tyres','Tent space','Fuel','Entry fees','1 event T-shirt'], '{}', null, true, 1),
  ('00000000-0000-4000-8000-0000000000e1', 'Option 2', 135000,
   array['Transponder','Practice tyres','Race tyres','Tent space','Fuel','Entry fees','1 event T-shirt'], array['Kart & trolley'],
   'Bring your own kart and trolley.', false, 2);

insert into products (event_id, kind, name, description, price_cents, sizes, max_qty, bundle_group, refundable, sort_order) values
  ('00000000-0000-4000-8000-0000000000e1', 'rental', 'Tillotson Toolkit',
   'Includes all spanners, allen keys, drivers, sockets, screwdrivers and a T-bar set needed to work on your T4 kart, packed in a Senzo toolbox. No drills or impact guns. Non-refundable.',
   10000, '{}', 1, null, false, 1),
  -- PLACEHOLDER clothing prices
  ('00000000-0000-4000-8000-0000000000e1', 'clothing', 'Extra event T-shirt', null, 2500,
   array['Youth (age 4)','Youth small (age 5–7)','Youth (age 8–10)','Youth (age 12)','S','M','L','XL','XXL','3XL'], 10, 'clothing', true, 2),
  ('00000000-0000-4000-8000-0000000000e1', 'clothing', 'Event polo', null, 3500, array['S','M','L','XL','XXL','3XL'], 10, 'clothing', true, 3),
  ('00000000-0000-4000-8000-0000000000e1', 'clothing', 'Event hoody', null, 4500, array['S','M','L','XL','XXL','3XL'], 10, 'clothing', true, 4);

insert into bundles (event_id, bundle_group, name, discount_pct) values
  ('00000000-0000-4000-8000-0000000000e1', 'clothing', 'T-shirt, polo and hoody', 20);

-- PLACEHOLDER sign-on slots (first day, Wednesday)
insert into signon_slots (event_id, label, category_id, for_unapproved, starts_at, ends_at)
select '00000000-0000-4000-8000-0000000000e1', 'Documents in progress', null, true, timestamptz '2027-09-22 07:30+02', timestamptz '2027-09-22 08:15+02'
union all
select c.event_id, c.name || ' · fast-track', c.id, false,
  timestamptz '2027-09-22 08:15+02' + (c.sort_order - 1) * interval '30 minutes',
  timestamptz '2027-09-22 08:45+02' + (c.sort_order - 1) * interval '30 minutes'
from categories c where c.event_id = '00000000-0000-4000-8000-0000000000e1';

commit;

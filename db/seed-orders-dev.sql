-- Order Angel · people for local testing only. Real accounts come from Tillotson ID.
-- Emails are placeholders (example.com) so nothing reaches a real inbox.
insert into oa_dealers (id, woo_customer_id, name, country, region, email) values
  ('00000000-0000-4000-a000-000000000101', 101, 'Demo Karting UK', 'United Kingdom', 'UK', 'orders@demo-uk.example.com'),
  ('00000000-0000-4000-a000-000000000102', 102, 'Demo Kart Shop Ireland', 'Ireland', 'Ireland', 'orders@demo-ie.example.com');

insert into oa_accounts (email, name, role, dealer_id) values
  ('mark@example.com',    'Mark',   'admin',   null),
  ('andrew@example.com',  'Andrew', 'admin',   null),
  ('shane@example.com',   'Shane',  'factory', null),
  ('dealer.uk@example.com', 'Demo UK dealer',      'dealer', '00000000-0000-4000-a000-000000000101'),
  ('dealer.ie@example.com', 'Demo Ireland dealer', 'dealer', '00000000-0000-4000-a000-000000000102');

update oa_settings set shop_url = 'https://example.com/spare-parts';

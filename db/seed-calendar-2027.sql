-- First entries for the dealer calendars: Tillotson T4 Global Events 2027 (on every country's
-- calendar) and the Tillotson T4 Series UK 2027 calendar. The IGP Plate is also on Ireland's and Northern Ireland's.
-- Ireland's T4 dates from the Motorsport Ireland Karting Calendar 2027.
-- Track locations from OpenStreetMap (© OpenStreetMap contributors). Websites are only filled
-- in where confirmed; the rest are for Tillotson admin to add.
begin;

insert into venues (organiser_id, slug, name, full_name, address, country, lat, lng, location_approx, website) values
  ('00000000-0000-4000-8000-000000000001', 'clay-pigeon',   'Clay Pigeon',   'Clay Pigeon Raceway',          'Long Ash Lane, Frome St Quintin, Dorchester, Dorset',      'United Kingdom', 50.823950, -2.554449, false, null),
  ('00000000-0000-4000-8000-000000000001', 'fulbeck',       'Fulbeck',       'Fulbeck Kart Circuit',         'Former RAF Fulbeck airfield, Fulbeck, Lincolnshire',       'United Kingdom', 53.045140, -0.655430, false, null),
  ('00000000-0000-4000-8000-000000000001', 'pfi',           'PFI',           'PF International',             'Stragglethorpe Lane, Caythorpe, Grantham, Lincolnshire',   'United Kingdom', 53.038780, -0.659960, false, 'https://kartpfi.com'),
  ('00000000-0000-4000-8000-000000000001', 'forest-edge',   'Forest Edge',   'Forest Edge Kart Club',        'Basingstoke Road, Barton Stacey, Winchester, Hampshire',   'United Kingdom', 51.180370, -1.362810, false, null),
  ('00000000-0000-4000-8000-000000000001', 'rowrah',        'Rowrah',        'The Lakeland Circuit, Rowrah', 'A5086, Rowrah, Cumbria',                                   'United Kingdom', 54.551350, -3.443203, false, 'https://www.cumbriakrc.co.uk'),
  ('00000000-0000-4000-8000-000000000001', 'buckmore-park', 'Buckmore Park', 'Buckmore Park Kart Circuit',   'Chatham, Kent ME1 3DQ',                    'United Kingdom', 51.343011,  0.501241, false, 'https://www.buckmore.co.uk'),
  ('00000000-0000-4000-8000-000000000001', 'shenington',    'Shenington',    'Shenington Kart Racing Club',  'Rattlecombe Road, Shenington, Banbury, Oxfordshire',       'United Kingdom', 52.081590, -1.475940, false, null),
  ('00000000-0000-4000-8000-000000000001', 'whilton-mill',  'Whilton Mill',  'Whilton Mill',                 'Roman Road, Whilton, Daventry, Northamptonshire',          'United Kingdom', 52.277120, -1.089340, false, null),
  ('00000000-0000-4000-8000-000000000001', 'warden-law',    'Warden Law',    'Warden Law Motorsports Centre','Hangmans Lane, Sunderland SR3 2PR',                        'United Kingdom', 54.843080, -1.428584, true,  null),
  ('00000000-0000-4000-8000-000000000001', 'nutts-corner',  'Nutts Corner',  'Nutts Corner Circuit',         'Ballydonaghy Road, Crumlin, County Antrim',                'Northern Ireland', 54.620260, -6.144292, false, null),
  ('00000000-0000-4000-8000-000000000001', 'motorland',     'Motorland',     'MotorLand Aragón',             'Alcañiz, Teruel',                                          'Spain',          41.077810, -0.194960, false, null),
  ('00000000-0000-4000-8000-000000000001', 'lonato',        'Lonato',        'South Garda Karting',          'Via Corte Ferrarini, Lonato del Garda, Brescia',           'Italy',          45.425010, 10.506060, false, null),
  ('00000000-0000-4000-8000-000000000001', 'autodromo-de-leon', 'Autódromo de León', 'Autódromo León',     'Calle Jazmín, Las Arboledas, León, Guanajuato',            'Mexico',         21.035882, -101.574800, false, null),
  ('00000000-0000-4000-8000-000000000001', 'kiltorcan',     'Kiltorcan Raceway', 'Kiltorcan Raceway',     'Kiltorcan, County Kilkenny',                               'Ireland',        52.462887, -7.182296, false, null),
  ('00000000-0000-4000-8000-000000000001', 'athboy',        'Athboy Karting Centre', 'Athboy Karting Centre', 'Copperalley, County Westmeath',                      'Ireland',        53.610727, -6.985793, false, null),
  ('00000000-0000-4000-8000-000000000001', 'kartworld-cork','Kartworld, Cork', 'Kartworld',                  'Watergrasshill, County Cork',                              'Ireland',        52.001669, -8.326413, false, null),
  ('00000000-0000-4000-8000-000000000001', 'whiteriver-park','Whiteriver Park', 'WhiteRiver Park Kart Racing Circuit', 'R169, Collon, County Louth',                   'Ireland',        53.798966, -6.482150, false, null),
  ('00000000-0000-4000-8000-000000000001', 'carmona',       'Carmona',       'Carmona Race Track',           'Bancal, Carmona, Cavite',                                  'Philippines',    14.281991, 121.009068, false, null);

create temp table cal (regions text[], kind calendar_kind, series text, round text, title text, s date, e date, venue text, tags text[], descr text);
insert into cal values
  ('{UK}', 'pre_season',    'T4 Series UK',  null,   'Winter Warmer',           '2027-03-06', '2027-03-07', 'clay-pigeon',   '{}', 'Pre-season event'),
  ('{UK}', 'championship',  'T4 Series UK',  'Round 1', 'T4 Series UK · Round 1', '2027-04-03', '2027-04-04', 'clay-pigeon',   '{}', null),
  ('{UK}', 'championship',  'T4 Series UK',  'Round 2', 'T4 Series UK · Round 2', '2027-05-29', '2027-05-30', 'fulbeck',       '{}', null),
  ('{UK}', 'championship',  'T4 Series UK',  'Round 3', 'T4 Series UK · Round 3', '2027-06-18', '2027-06-20', 'pfi',           '{"T4 Nations Cup qualifier"}', 'British Kart Championship event'),
  ('{UK}', 'championship',  'T4 Series UK',  'Round 4', 'T4 Series UK · Round 4', '2027-07-03', '2027-07-04', 'forest-edge',   '{}', null),
  ('{UK}', 'championship',  'T4 Series UK',  'Round 5', 'T4 Series UK · Round 5', '2027-07-31', '2027-08-01', 'rowrah',        '{}', null),
  ('{UK}', 'championship',  'T4 Series UK',  'Round 6', 'T4 Series UK · Round 6', '2027-09-04', '2027-09-05', 'buckmore-park', '{}', null),
  ('{Global}', 'international', null,            null,   'T4 Americas Cup',         '2027-02-12', '2027-02-14', 'autodromo-de-leon', '{}', null),
  ('{Global}', 'international', null,            null,   'T4 Asia Cup',             '2027-02-25', '2027-02-28', 'carmona',       '{}', null),
  ('{Global}', 'international', null,            null,   'T4 Euro Cup',             '2027-05-05', '2027-05-08', 'motorland',     '{}', null),
  ('{UK,Ireland,Northern Ireland}', 'international', null, null, 'IGP Plate',               '2027-08-13', '2027-08-15', 'nutts-corner',  '{}', null),
  ('{Global}', 'international', null,            null,   'T4 Nations Cup',          '2027-09-22', '2027-09-26', 'lonato',        '{}', null),
  ('{UK}', 'series',        'UK Kart Series','Round 1', 'UK Kart Series · Round 1','2027-02-27', '2027-02-28', 'shenington',    '{}', null),
  ('{UK}', 'series',        'UK Kart Series','Round 2', 'UK Kart Series · Round 2','2027-05-15', '2027-05-16', 'whilton-mill',  '{}', null),
  ('{UK}', 'series',        'UK Kart Series','Round 3', 'UK Kart Series · Round 3','2027-10-09', '2027-10-10', 'warden-law',    '{}', null),
  -- Ireland: T4 dates from the Motorsport Ireland Karting Calendar 2027
  ('{Ireland}', 'other',     null,           null,   'KT Cup',                  '2027-03-14', '2027-03-14', 'kiltorcan',     '{"Non-championship"}', 'Motorsport Ireland permitted'),
  ('{Ireland}', 'championship', 'T4 Series Ireland', 'Round 1', 'T4 Series Ireland · Round 1',  '2027-04-18', '2027-04-18', 'kiltorcan',     '{}', null),
  ('{Ireland}', 'championship', 'T4 Series Ireland', 'Round 2', 'T4 Series Ireland · Round 2',  '2027-05-16', '2027-05-16', 'athboy',        '{}', null),
  ('{Ireland}', 'championship', 'T4 Series Ireland', 'Round 3', 'T4 Series Ireland · Round 3',  '2027-05-30', '2027-05-30', 'kiltorcan',     '{}', null),
  ('{Ireland}', 'championship', 'T4 Series Ireland', 'Round 4', 'T4 Series Ireland · Round 4',  '2027-06-27', '2027-06-27', 'kartworld-cork','{}', null),
  ('{Ireland}', 'championship', 'T4 Series Ireland', 'Round 5', 'T4 Series Ireland · Round 5',  '2027-07-10', '2027-07-11', 'kiltorcan',     '{}', null),
  ('{Ireland}', 'championship', 'T4 Series Ireland', 'Round 6', 'T4 Series Ireland · Round 6',  '2027-08-08', '2027-08-08', 'whiteriver-park','{}', null),
  ('{UK}', 'series',        'UK Kart Series','Round 4', 'UK Kart Series · Round 4','2027-11-06', '2027-11-07', 'shenington',    '{}', null);

insert into calendar_entries (organiser_id, regions, kind, series, round, title, starts_on, ends_on, venue_id, tags, description, source)
select '00000000-0000-4000-8000-000000000001', c.regions, c.kind, c.series, c.round, c.title, c.s, c.e, v.id, c.tags, c.descr, 'tillotson'
from cal c join venues v on v.slug = c.venue and v.organiser_id = '00000000-0000-4000-8000-000000000001';
insert into calendar_regions (organiser_id, name, title) values
  ('00000000-0000-4000-8000-000000000001', 'UK', 'T4 Series UK'),
  ('00000000-0000-4000-8000-000000000001', 'Ireland', 'T4 Series Ireland');
commit;

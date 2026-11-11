# Event app

White-labelled event app: driver registration, officials' document review, staff handout
sheets and the organiser dashboard. First event: T4 Nations Cup 2027.

## What's here so far

| Path | What it is | Status |
|---|---|---|
| `db/schema.sql` | Database design. Organisers, federations and their start permission rule, events (branding, host country, dates, deposit), categories, tickets, rentals and clothing, bundles, sign-on slots, registrations, documents, payments, audit log | Tested on PostgreSQL 16 |
| `db/functions.sql` | `complete_registration()`: marks a registration paid and gives the next race number in its category's range, in order of payment. `admin_set_race_number()`: lets an organiser admin (only) move a driver to a reserved number such as 101 or 201, with an audit trail | Tested: `test/race-numbers.sql` |
| `db/backup.sql` | Backup copy of every registration. Each time one is submitted, paid or changed, or its documents or payments change, a full snapshot is queued in the same transaction. A background job copies each to a separate locked bucket. Drafts aren't backed up; PINs and card details never appear | Tested: `test/backup.sql` |
| `db/seed-t4nc27.sql` | T4 Nations Cup 2027 set up as data. Values marked PLACEHOLDER still need confirming | Tested |
| `src/lib/rules.ts` | Registration rules shared by browser and server: ages on the event date, which steps show, required documents from the driver's federation, pricing with bundles, validation | 11 tests passing |
| `src/lib/secrets.ts` | Driver PINs and resume tokens (hashed, never stored in plain text) | Tested |
| `test/rules.test.ts` | The tests | `node --test --experimental-strip-types test/rules.test.ts` |

## Registration (working)

- `/e/<event>`: event page, branded per event. `/e/<event>/register`: the registration.
- Steps: driver details → parent / guardian (under-18s only) → licence & documents → entry ticket → event clothing → review & pay.
- Saves as the driver goes, so they can close the page and carry on later on the same device.
- Uploads: photos or PDFs up to 10 MB, kept private. Which documents are asked for comes from the driver's federation and age.
- The server re-checks every answer and works out the price itself before payment.
- Payment: Stripe Checkout. Until a Stripe key is added, a test payment page stands in (development only).
- After payment: race number from the category's range, a 6-digit PIN, and a confirmation email to the driver (or the parent / guardian).

Tested end to end in a browser: an under-18 T4 Mini driver with a Swedish licence (letter required, 4 documents,
Option 1, toolkit, kart fitting, clothing bundle: €3,279.00, race number 110) and an adult T4 Senior driver with a
UK licence (2 documents, Option 2: €1,650.00, race number 310). Also checked: paying twice doesn't re-number or
re-email, strangers can't see another driver's confirmation, bad values and wrong file types are refused.

## Calendar and tracks (working)

- `/calendar/uk`: the UK dealer calendar, month by month. First entries: the Tillotson T4 Series UK 2027 calendar
  (Winter Warmer, 6 championship rounds, IGP Plate, 4 UK Kart Series rounds).
- Tillotson T4 Global Events 2027 (T4 Americas Cup, T4 Asia Cup, T4 Euro Cup, T4 Nations Cup) are entered once, as
  region 'Global', and appear on every country's calendar.
- Every track name is a link to `/tracks/<track>`: a zoomed-in map that shows the circuit itself, directions,
  satellite view, the track's website where known, and what's coming up there.
- `db/calendar.sql` (tracks, calendar entries; dealers will add their own once logins exist), `db/seed-calendar-2027.sql`.

## Run it

```
npm install
cp .env.example .env.local        # then fill in what you have
npm run db:local                  # local database only
npm run dev                       # http://localhost:3000/e/t4nc27
npm test                          # rules and pricing tests
```

## Next

1. Accounts: Supabase (database + private file storage), Vercel (web address), Stripe, email. Then go live in test mode.
2. Driver sign-in (race number + PIN) and dashboard.
3. Officials' document review; staff handout sheets; organiser dashboard; admin screens to set up events.
4. Backup job that copies each registration to the locked backup bucket.

## Accounts needed to go live (all have free tiers to start)

- **Supabase**: database, file storage for licences
- **Vercel**: hosting, gives the app its web address
- **Stripe**: card payments
- **Resend** (or similar): emails with race number, PIN and receipts
- **Cloudflare R2** (or similar, separate from Supabase): locked backup bucket

## Run the database locally

```
createdb eventapp
psql -d eventapp -f db/schema.sql -f db/functions.sql -f db/backup.sql -f db/calendar.sql -f db/seed-t4nc27.sql -f db/seed-calendar-2027.sql
```

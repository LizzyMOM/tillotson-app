-- Backup tests. Run after schema, functions, backup and the T4NC27 seed:
--   psql -d eventapp_test -v ON_ERROR_STOP=1 -f test/backup.sql
begin;
create function pg_temp.expect(got bigint, want bigint, what text) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL %: got %, want %', what, got, want; end if; raise notice 'ok  %', what; end $$;
create function pg_temp.n() returns bigint language sql as $$ select count(*) from backup_outbox $$;

insert into registrations (id, event_id, status, first_name, last_name, category_id, ticket_id, email)
select '00000000-0000-4000-9000-0000000000b1', e.id, 'draft', 'Alex', 'Moreno', c.id, t.id, 'alex@example.com'
from events e join categories c on c.event_id = e.id and c.name = 'T4 Mini' join tickets t on t.event_id = e.id and t.name = 'Option 1'
where e.slug = 't4nc27';
select pg_temp.expect(pg_temp.n(), 0, 'drafts are not backed up');

update registrations set status = 'awaiting_payment' where id = '00000000-0000-4000-9000-0000000000b1';
select pg_temp.expect(pg_temp.n(), 1, 'submitting queues a backup');

insert into documents (registration_id, kind, storage_key, filename, mime_type, size_bytes)
values ('00000000-0000-4000-9000-0000000000b1', 'licence_front', 'events/t4nc27/x/licence_front.jpg', 'front.jpg', 'image/jpeg', 120000);
select pg_temp.expect(pg_temp.n(), 2, 'a document upload queues a backup');

insert into payments (registration_id, event_id, purpose, provider, provider_ref, amount_cents, currency, status)
select '00000000-0000-4000-9000-0000000000b1', event_id, 'registration', 'stripe', 'cs_test_123', 330900, 'EUR', 'succeeded'
from registrations where id = '00000000-0000-4000-9000-0000000000b1';
select complete_registration('00000000-0000-4000-9000-0000000000b1', 'scrypt$secret$hash');
select pg_temp.expect(pg_temp.n(), 4, 'payment and paid status each queue a backup');

select pg_temp.expect((select (snapshot->'registration'->>'race_number')::bigint from backup_outbox order by id desc limit 1), 110, 'latest backup has the race number');
select pg_temp.expect((select jsonb_array_length(snapshot->'documents') from backup_outbox order by id desc limit 1), 1, 'backup lists the documents');
select pg_temp.expect((select jsonb_array_length(snapshot->'payments') from backup_outbox order by id desc limit 1), 1, 'backup lists the payment');
select pg_temp.expect((select count(*) from backup_outbox where snapshot::text like '%scrypt%'), 0, 'PINs never appear in backups');
select pg_temp.expect((select count(*) from backup_outbox where reason = 'registration paid'), 1, 'reason is recorded');

update registrations set phone = phone where id = '00000000-0000-4000-9000-0000000000b1';
select pg_temp.expect(pg_temp.n(), 4, 'saving with no change adds nothing');

-- a failed save rolls back its backup too
savepoint s;
do $$ begin
  update registrations set first_name = 'Changed' where id = '00000000-0000-4000-9000-0000000000b1';
  raise exception 'simulated crash';
exception when others then null; end $$;
select pg_temp.expect(pg_temp.n(), 4, 'a failed change leaves no half-written backup');
rollback;

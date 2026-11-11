-- Race number tests. Run on a fresh database with schema, functions and the T4NC27 seed loaded:
--   psql -d eventapp_test -v ON_ERROR_STOP=1 -f test/race-numbers.sql
-- Each check raises an error if it fails.
begin;
\set ev '''00000000-0000-4000-8000-0000000000e1'''

create temp table t_ids (k text primary key, id uuid);
create function pg_temp.reg(k text, cat text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into registrations (event_id, status, first_name, last_name, category_id)
  select '00000000-0000-4000-8000-0000000000e1', 'awaiting_payment', k, 'Test', id from categories
   where event_id = '00000000-0000-4000-8000-0000000000e1' and name = cat returning registrations.id into v;
  insert into t_ids values (k, v); return v;
end $$;
create function pg_temp.pay(k text) returns integer language sql as $$ select complete_registration((select id from t_ids where t_ids.k = pay.k), 'h') $$;
create function pg_temp.expect(got integer, want integer, what text) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL %: got %, want %', what, got, want; end if; raise notice 'ok  %', what; end $$;

insert into users (id, organiser_id, email, name, role) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000001', 'admin@example.com', 'Admin', 'admin'),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000001', 'staff@example.com', 'Staff', 'staff');

select pg_temp.reg('m1','T4 Mini'), pg_temp.reg('m2','T4 Mini'), pg_temp.reg('j1','T4 Junior'), pg_temp.reg('s1','T4 Senior'), pg_temp.reg('x1','T4 Senior168');
select pg_temp.expect(pg_temp.pay('m1'), 110, 'first T4 Mini gets 110');
select pg_temp.expect(pg_temp.pay('j1'), 210, 'first T4 Junior gets 210');
select pg_temp.expect(pg_temp.pay('m2'), 111, 'second T4 Mini gets 111');
select pg_temp.expect(pg_temp.pay('s1'), 310, 'first T4 Senior gets 310');
select pg_temp.expect(pg_temp.pay('x1'), 510, 'first T4 Senior168 gets 510');
select pg_temp.expect(pg_temp.pay('m1'), 110, 'paying twice keeps the same number');

-- admin moves last year's winner to 101; 110 is freed but not reused while the range has room
select pg_temp.expect(admin_set_race_number((select id from t_ids where k='m1'), 101, '00000000-0000-4000-a000-000000000001'), 101, 'admin gives reserved 101');
select pg_temp.reg('m3','T4 Mini');
select pg_temp.expect(pg_temp.pay('m3'), 112, 'next T4 Mini still gets 112 (order of payment kept)');
select pg_temp.expect((select count(*)::int from audit_log where action = 'race_number_changed'), 1, 'change is in the audit log');

do $$ begin
  perform admin_set_race_number((select id from t_ids where k='m2'), 101, '00000000-0000-4000-a000-000000000001');
  raise exception 'FAIL taken number accepted';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok  taken number refused: %', sqlerrm; end $$;
do $$ begin
  perform admin_set_race_number((select id from t_ids where k='m2'), 201, '00000000-0000-4000-a000-000000000001');
  raise exception 'FAIL other category accepted';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok  other category refused: %', sqlerrm; end $$;
do $$ begin
  perform admin_set_race_number((select id from t_ids where k='m2'), 102, '00000000-0000-4000-a000-000000000002');
  raise exception 'FAIL staff allowed';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok  staff refused: %', sqlerrm; end $$;

-- fill T4 Senior168 (510–599) and check gap filling, then a full range
do $$ declare i int; begin
  for i in 2..90 loop perform pg_temp.reg('x'||i, 'T4 Senior168'); perform pg_temp.pay('x'||i); end loop; end $$;
select pg_temp.expect((select max(race_number) from registrations where race_number between 500 and 599), 599, 'T4 Senior168 range filled to 599');
select admin_set_race_number((select id from t_ids where k='x5'), 501, '00000000-0000-4000-a000-000000000001');
select pg_temp.reg('x91','T4 Senior168');
select pg_temp.expect(pg_temp.pay('x91'), 514, 'range full: freed 514 is reused');
select pg_temp.reg('x92','T4 Senior168');
select pg_temp.expect(pg_temp.pay('x92'), null, 'no numbers left: paid without a number');
select pg_temp.expect((select count(*)::int from audit_log where action = 'race_number_needed'), 1, 'admin is flagged to assign one');
rollback;

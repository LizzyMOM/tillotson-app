-- Database functions that must be safe when many drivers pay at the same moment.

-- Marks a registration paid and gives it a race number from its category's range, in order
-- of payment: the number after the highest one already given out in that range. Numbers an
-- admin frees up are only reused once the range has run out, so earlier payers always have
-- lower numbers. An advisory lock per event means two payments finishing together can never
-- get the same number. Calling it twice for the same registration returns the same number.
-- If the category has no range or the range is full, the registration is still marked paid
-- with no number, and the audit log flags it for an admin.
create or replace function complete_registration(p_registration uuid, p_pin_hash text)
returns integer language plpgsql as $$
declare
  v_event uuid; v_status registration_status; v_num integer; v_cat categories%rowtype;
begin
  select event_id, status, race_number into v_event, v_status, v_num from registrations where id = p_registration for update;
  if v_event is null then raise exception 'registration % not found', p_registration; end if;
  if v_status = 'paid' then return v_num; end if;
  if v_status not in ('draft', 'awaiting_payment') then raise exception 'registration % is %', p_registration, v_status; end if;

  perform pg_advisory_xact_lock(hashtext(v_event::text));
  select c.* into v_cat from categories c join registrations r on r.category_id = c.id where r.id = p_registration;

  v_num := null;
  if v_cat.number_start is not null then
    select coalesce(max(race_number) + 1, v_cat.number_start) into v_num from registrations
     where event_id = v_event and race_number between v_cat.number_start and v_cat.number_end;
    if v_num > v_cat.number_end then           -- top of the range reached: fill a gap if there is one
      select min(n) into v_num from generate_series(v_cat.number_start, v_cat.number_end) n
       where not exists (select 1 from registrations r where r.event_id = v_event and r.race_number = n);
    end if;
  end if;

  update registrations set status = 'paid', paid_at = now(), race_number = v_num, pin_hash = p_pin_hash, updated_at = now()
   where id = p_registration;
  if v_num is null then
    insert into audit_log (event_id, action, subject, detail)
    values (v_event, 'race_number_needed', p_registration::text,
            jsonb_build_object('category', v_cat.name, 'reason', case when v_cat.id is null then 'no category' when v_cat.number_start is null then 'category has no number range' else 'number range full' end));
  end if;
  return v_num;
end $$;

-- An admin gives a driver a number, typically a reserved one for last year's top finishers
-- (101, 102, 201 ...). Only admins of the event's organiser may do it; the number must be free
-- in this event and inside the driver's category's reserved block or normal range. The driver's
-- previous number becomes free. Every change is written to the audit log.
create or replace function admin_set_race_number(p_registration uuid, p_number integer, p_user uuid)
returns integer language plpgsql as $$
declare
  v_reg registrations%rowtype; v_cat categories%rowtype; v_user users%rowtype; v_org uuid; v_taken text;
begin
  select * into v_reg from registrations where id = p_registration for update;
  if v_reg.id is null then raise exception 'Registration not found'; end if;
  select organiser_id into v_org from events where id = v_reg.event_id;
  select * into v_user from users where id = p_user;
  if v_user.id is null or v_user.role <> 'admin' or not v_user.active or v_user.organiser_id <> v_org then
    raise exception 'Only an organiser admin can change race numbers';
  end if;
  if v_reg.status <> 'paid' then raise exception 'Only paid registrations have race numbers'; end if;
  perform pg_advisory_xact_lock(hashtext(v_reg.event_id::text));
  select * into v_cat from categories where id = v_reg.category_id;
  if not ((p_number between v_cat.reserved_start and v_cat.reserved_end) or (p_number between v_cat.number_start and v_cat.number_end)) then
    raise exception 'Number % is outside % (reserved %–%, normal %–%)', p_number, v_cat.name,
      v_cat.reserved_start, v_cat.reserved_end, v_cat.number_start, v_cat.number_end;
  end if;
  select coalesce(first_name,'') || ' ' || coalesce(last_name,'') into v_taken from registrations
   where event_id = v_reg.event_id and race_number = p_number and id <> p_registration;
  if v_taken is not null then raise exception 'Number % is already taken by %', p_number, trim(v_taken); end if;

  update registrations set race_number = p_number, updated_at = now() where id = p_registration;
  insert into audit_log (event_id, user_id, action, subject, detail)
  values (v_reg.event_id, p_user, 'race_number_changed', p_registration::text,
          jsonb_build_object('from', v_reg.race_number, 'to', p_number));
  return p_number;
end $$;

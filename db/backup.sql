-- Backup copies of every registration, kept outside the app.
--
-- Every time a registration is submitted, paid, changed, or its documents or payments
-- change, a complete snapshot of it is queued here in the same transaction, so a change
-- can never be saved without its backup also being queued. A small background job then
-- copies each snapshot as its own file to a separate, locked storage bucket at a different
-- provider, and marks it shipped. Drafts are not backed up: until a driver submits, there
-- is nothing to lose.
--
-- No card details ever reach the app (Stripe holds them), so none are in these files.

create table backup_outbox (
  id               bigserial primary key,
  event_id         uuid not null,
  registration_id  uuid not null,
  reason           text not null,            -- 'registration paid', 'document uploaded', ...
  snapshot         jsonb not null,
  created_at       timestamptz not null default now(),
  shipped_at       timestamptz,              -- set by the job once the file is safely stored
  shipped_to       text,                     -- e.g. 'r2://t4-backups/t4nc27/...json'
  attempts         integer not null default 0,
  last_error       text
);
create index backup_outbox_unshipped on backup_outbox (id) where shipped_at is null;

-- Everything about one registration in one JSON document: enough to rebuild it on its own.
create or replace function registration_snapshot(p_registration uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'snapshot_version', 1,
    'taken_at', now(),
    'event', jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name),
    'registration', to_jsonb(r) - 'pin_hash' - 'draft_token_hash',
    'category', c.name,
    'ticket', jsonb_build_object('name', t.name, 'price_cents', t.price_cents),
    'federation', coalesce(f.name, r.federation_other),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('product', p.name, 'size', l.size, 'qty', l.qty, 'unit_price_cents', l.unit_price_cents) order by p.sort_order)
                       from registration_lines l join products p on p.id = l.product_id where l.registration_id = r.id), '[]'),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'filename', d.filename, 'storage_key', d.storage_key,
                             'status', d.status, 'reason', d.reason, 'uploaded_at', d.uploaded_at, 'reviewed_at', d.reviewed_at) order by d.uploaded_at)
                           from documents d where d.registration_id = r.id), '[]'),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'provider', pm.provider, 'provider_ref', pm.provider_ref,
                            'amount_cents', pm.amount_cents, 'currency', pm.currency, 'status', pm.status, 'at', pm.created_at) order by pm.created_at)
                          from payments pm where pm.registration_id = r.id), '[]')
  )
  from registrations r
  join events e on e.id = r.event_id
  left join categories c on c.id = r.category_id
  left join tickets t on t.id = r.ticket_id
  left join federations f on f.id = r.federation_id
  where r.id = p_registration
$$;

create or replace function queue_backup(p_registration uuid, p_reason text) returns void
language plpgsql as $$
declare v_status registration_status; v_event uuid;
begin
  select status, event_id into v_status, v_event from registrations where id = p_registration;
  if v_status is null or v_status = 'draft' then return; end if;
  insert into backup_outbox (event_id, registration_id, reason, snapshot)
  values (v_event, p_registration, p_reason, registration_snapshot(p_registration));
end $$;

create or replace function trg_backup_registration() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new is not distinct from old then return new; end if;
  perform queue_backup(new.id,
    case when tg_op = 'UPDATE' and old.status is distinct from new.status then 'registration ' || replace(new.status::text, '_', ' ')
         when tg_op = 'UPDATE' and old.race_number is distinct from new.race_number then 'race number changed'
         when tg_op = 'UPDATE' and old.review is distinct from new.review then 'review ' || replace(new.review::text, '_', ' ')
         else 'registration updated' end);
  return new;
end $$;

create or replace function trg_backup_child() returns trigger language plpgsql as $$
declare v_reg uuid := coalesce(new.registration_id, old.registration_id);
begin
  if v_reg is not null then perform queue_backup(v_reg, tg_argv[0] || ' ' || lower(tg_op)); end if;
  return coalesce(new, old);
end $$;

-- 'after' triggers: the snapshot sees the saved row. Same transaction: no backup, no change.
create trigger backup_registrations after insert or update on registrations
  for each row execute function trg_backup_registration();
create trigger backup_documents after insert or update or delete on documents
  for each row execute function trg_backup_child('document');
create trigger backup_payments after insert or update on payments
  for each row execute function trg_backup_child('payment');
create trigger backup_lines after insert or update or delete on registration_lines
  for each row execute function trg_backup_child('order line');

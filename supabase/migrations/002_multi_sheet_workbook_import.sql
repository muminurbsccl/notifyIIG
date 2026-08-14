alter table public.circuits
  add column if not exists renewal_procedure_start_date date,
  add column if not exists segment text,
  add column if not exists connected_router text,
  add column if not exists raw_cost_details text;

alter table public.circuits drop constraint if exists circuits_renewal_procedure_before_expiry;
alter table public.circuits add constraint circuits_renewal_procedure_before_expiry check (
  renewal_procedure_start_date is null
  or expiry_date is null
  or renewal_procedure_start_date <= expiry_date
);

create or replace function public.normalize_import_identifier(p_value text)
returns text
language sql
immutable
strict
as $$
  select upper(regexp_replace(regexp_replace(p_value, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.validate_circuit_state()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(73482123::bigint);
  if tg_op = 'DELETE' then return old; end if;
  new.normalized_circuit_id := public.normalize_import_identifier(new.external_circuit_id);
  if new.status in ('active', 'renewal_pending') then
    if new.expiry_date is null or new.verified_at is null or new.verified_by is null then raise exception 'Active circuits require a verified expiry date'; end if;
    if new.owner_user_id is null and nullif(btrim(new.owner_override), '') is null then raise exception 'Active circuits require a responsible owner'; end if;
    if new.owner_user_id is not null and not exists (select 1 from public.profiles where id = new.owner_user_id and active) then raise exception 'Circuit owner must be an active user'; end if;
    if new.backup_owner_user_id is not null and not exists (select 1 from public.profiles where id = new.backup_owner_user_id and active) then raise exception 'Circuit backup owner must be an active user'; end if;
    if new.verified_at > now() then raise exception 'Verification time cannot be in the future'; end if;
    if not exists (select 1 from public.profiles where id = new.verified_by and active) then raise exception 'Verification requires an active user'; end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.expiry_date is not distinct from old.expiry_date and new.expiry_version <> old.expiry_version then raise exception 'Expiry version can only change when expiry date changes'; end if;
    if old.verified_at is not null and new.verified_at is null then raise exception 'Verification cannot be cleared'; end if;
    if old.verified_by is not null and new.verified_by is null then raise exception 'Verification cannot be cleared'; end if;
    if old.verified_at is not null and new.verified_at < old.verified_at then raise exception 'Verification timestamp cannot move backwards'; end if;
    if new.verified_at is distinct from old.verified_at or new.verified_by is distinct from old.verified_by then
      if new.verified_at is null or new.verified_by is null or new.verified_at > now() then raise exception 'Verification requires a valid timestamp and active user'; end if;
      if not exists (select 1 from public.profiles where id = new.verified_by and active) then raise exception 'Verification requires an active user'; end if;
    end if;
    if new.status in ('active', 'renewal_pending') and old.status not in ('active', 'renewal_pending') then
      if new.verified_at <= coalesce(old.verified_at, '-infinity'::timestamptz) then raise exception 'Activation requires a fresh verification'; end if;
    end if;
    if new.expiry_date is distinct from old.expiry_date then
      if new.expiry_version <= old.expiry_version then raise exception 'Expiry version must increase when expiry date changes'; end if;
      if new.verified_at is null or new.verified_at <= coalesce(old.verified_at, '-infinity'::timestamptz) or new.verified_by is null then raise exception 'A changed expiry date requires a new verification'; end if;
      if new.verified_at > now() or not exists (select 1 from public.profiles where id = new.verified_by and active) then raise exception 'Expiry verification requires an active user and a valid timestamp'; end if;
    end if;
  end if;
  return new;
end;
$$;

create table if not exists public.circuit_identifiers (
  id uuid primary key default gen_random_uuid(),
  circuit_id uuid not null references public.circuits(id) on delete cascade,
  identifier_kind text not null check (identifier_kind in ('circuit', 'link', 'bscplc', 'provider', 'customer_link', 'service_order', 'alternate')),
  original_value text not null check (length(btrim(original_value)) > 0),
  normalized_value text not null check (
    length(btrim(normalized_value)) > 0
    and normalized_value = public.normalize_import_identifier(original_value)
  ),
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

drop index if exists public.circuit_identifiers_unique_value_idx;
create unique index if not exists circuit_identifiers_unique_value_idx
  on public.circuit_identifiers (circuit_id, normalized_value);
create unique index if not exists circuit_identifiers_one_primary_idx
  on public.circuit_identifiers (circuit_id) where is_primary;
create index if not exists circuit_identifiers_normalized_search_idx
  on public.circuit_identifiers (normalized_value);

insert into public.circuit_identifiers (circuit_id, identifier_kind, original_value, normalized_value, is_primary)
select id, case when identifier_type = 'durable' then 'alternate' else identifier_type end,
       external_circuit_id, public.normalize_import_identifier(external_circuit_id), true
from public.circuits
where length(btrim(external_circuit_id)) > 0 and length(btrim(normalized_circuit_id)) > 0
on conflict (circuit_id, normalized_value) do update
set original_value = excluded.original_value,
    is_primary = true;

create or replace function public.sync_circuit_primary_identifier()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  mapped_kind text := case when new.identifier_type = 'durable' then 'alternate' else new.identifier_type end;
begin
  delete from public.circuit_identifiers
  where circuit_id = new.id and not is_primary and normalized_value = new.normalized_circuit_id;
  update public.circuit_identifiers
  set identifier_kind = mapped_kind,
      original_value = new.external_circuit_id,
      normalized_value = new.normalized_circuit_id
  where circuit_id = new.id and is_primary;
  if not found then
    insert into public.circuit_identifiers (circuit_id, identifier_kind, original_value, normalized_value, is_primary)
    values (new.id, mapped_kind, new.external_circuit_id, new.normalized_circuit_id, true);
  end if;
  return new;
end;
$$;

drop trigger if exists circuits_sync_primary_identifier on public.circuits;
create trigger circuits_sync_primary_identifier
after insert or update of external_circuit_id, identifier_type on public.circuits
for each row execute function public.sync_circuit_primary_identifier();

create or replace function public.require_circuit_primary_identifier()
returns trigger
language plpgsql
as $$
declare
  old_id uuid;
  new_id uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then new_id := new.circuit_id; end if;
  if tg_op in ('UPDATE', 'DELETE') then old_id := old.circuit_id; end if;
  if new_id is not null
     and exists (select 1 from public.circuits where id = new_id)
     and (select count(*) from public.circuit_identifiers where circuit_id = new_id and is_primary) <> 1 then
    raise exception 'Circuit must have exactly one primary identifier';
  end if;
  if new_id is not null and exists (
    select 1 from public.circuit_identifiers ci
    join public.circuits c on c.id = ci.circuit_id
    where ci.circuit_id = new_id and ci.is_primary
      and (ci.original_value is distinct from c.external_circuit_id
           or ci.normalized_value is distinct from c.normalized_circuit_id)
  ) then
    raise exception 'Primary identifier must match circuit compatibility values';
  end if;
  if tg_op = 'UPDATE' and old.circuit_id is distinct from new.circuit_id
     and exists (select 1 from public.circuits where id = old_id)
     and (select count(*) from public.circuit_identifiers where circuit_id = old_id and is_primary) <> 1 then
    raise exception 'Circuit must have exactly one primary identifier';
  end if;
  if tg_op = 'UPDATE' and old.circuit_id is distinct from new.circuit_id and exists (
    select 1 from public.circuit_identifiers ci
    join public.circuits c on c.id = ci.circuit_id
    where ci.circuit_id = old_id and ci.is_primary
      and (ci.original_value is distinct from c.external_circuit_id
           or ci.normalized_value is distinct from c.normalized_circuit_id)
  ) then
    raise exception 'Primary identifier must match circuit compatibility values';
  end if;
  if tg_op = 'DELETE'
     and exists (select 1 from public.circuits where id = old_id)
     and (select count(*) from public.circuit_identifiers where circuit_id = old_id and is_primary) <> 1 then
    raise exception 'Circuit must have exactly one primary identifier';
  end if;
  if tg_op = 'DELETE' and exists (
    select 1 from public.circuit_identifiers ci
    join public.circuits c on c.id = ci.circuit_id
    where ci.circuit_id = old_id and ci.is_primary
      and (ci.original_value is distinct from c.external_circuit_id
           or ci.normalized_value is distinct from c.normalized_circuit_id)
  ) then
    raise exception 'Primary identifier must match circuit compatibility values';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists circuit_identifiers_require_primary on public.circuit_identifiers;
create constraint trigger circuit_identifiers_require_primary
after insert or update or delete on public.circuit_identifiers
deferrable initially deferred for each row execute function public.require_circuit_primary_identifier();

alter table public.import_batches add column if not exists idempotency_checksum text;
with ranked_commits as (
  select id, checksum,
         row_number() over (partition by checksum order by committed_at desc nulls last, created_at desc, id desc) as replay_rank
  from public.import_batches
  where status = 'committed'
)
update public.import_batches ib
set idempotency_checksum = ranked_commits.checksum
from ranked_commits
where ib.id = ranked_commits.id and ranked_commits.replay_rank = 1;
create unique index if not exists import_batches_committed_checksum_idx
  on public.import_batches (idempotency_checksum) where idempotency_checksum is not null;

alter table public.circuit_identifiers enable row level security;
drop policy if exists circuit_identifiers_select_scope on public.circuit_identifiers;
drop policy if exists circuit_identifiers_write_scope on public.circuit_identifiers;
create policy circuit_identifiers_select_scope on public.circuit_identifiers for select using (
  exists (
    select 1 from public.circuits c
    where c.id = circuit_id and public.has_provider_access(c.provider_id)
  )
);
create policy circuit_identifiers_write_scope on public.circuit_identifiers for all using (
  public.is_admin_or_editor()
  and exists (
    select 1 from public.circuits c
    where c.id = circuit_id and public.has_provider_access(c.provider_id)
  )
) with check (
  public.is_admin_or_editor()
  and exists (
    select 1 from public.circuits c
    where c.id = circuit_id and public.has_provider_access(c.provider_id)
  )
);

drop function if exists public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb);
create or replace function public.commit_import_batch(
  p_actor_user_id uuid,
  p_filename text,
  p_checksum text,
  p_sheet_names jsonb,
  p_preview jsonb,
  p_decisions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  batch_id uuid;
  provider_item jsonb;
  item jsonb;
  source_item jsonb;
  identifier_item jsonb;
  primary_identifier jsonb;
  target_provider_id uuid;
  existing_id uuid;
  target_circuit_id uuid;
  provider_code text;
  normalized_id text;
  imported_external_id text;
  stored_external_id text;
  stored_normalized_id text;
  decision text;
  import_status text;
  computed_status text;
  computed_identifier_normalized text;
  imported_expiry_date date;
  actor_role text;
  primary_count integer;
  candidate_number bigint;
  prior_batch_id uuid;
  prior_counts jsonb;
  created_circuits integer := 0;
  skipped_circuits integer := 0;
  merged_circuits integer := 0;
  versioned_circuits integer := 0;
  invoice_count integer := 0;
begin
  if p_actor_user_id is null then
    raise exception 'Import commit requires an actor';
  end if;
  select role into actor_role from public.profiles where id = p_actor_user_id and active;
  if actor_role is null or actor_role not in ('admin', 'operations_editor') then
    raise exception 'Import commit requires an administrator or operations editor';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('import:' || p_checksum, 0));
  select ib.id, al.after_json into prior_batch_id, prior_counts
  from public.import_batches ib
  left join lateral (
    select after_json from public.audit_logs
    where entity_type = 'import_batch' and entity_id = ib.id and action = 'import.commit'
    order by created_at desc limit 1
  ) al on true
  where checksum = p_checksum and status = 'committed'
  order by ib.committed_at desc
  limit 1;
  if prior_batch_id is not null then
    return jsonb_build_object('batchId', prior_batch_id, 'counts', prior_counts);
  end if;

  insert into public.import_batches (filename, checksum, sheet_names, preview_summary, status, created_by)
  values (p_filename, p_checksum, p_sheet_names, jsonb_build_object(
    'providerCount', coalesce((p_preview #>> '{summary,providerCount}')::integer, 0),
    'serviceCount', coalesce((p_preview #>> '{summary,serviceCount}')::integer, 0),
    'activeCount', coalesce((p_preview #>> '{summary,activeCount}')::integer, 0),
    'expiredCount', coalesce((p_preview #>> '{summary,expiredCount}')::integer, 0),
    'draftCount', coalesce((p_preview #>> '{summary,draftCount}')::integer, 0),
    'mergedCount', coalesce((p_preview #>> '{summary,mergedCount}')::integer, 0)
  ), 'previewed', p_actor_user_id)
  returning id into batch_id;

  begin
    for provider_item in select value from jsonb_array_elements(coalesce(p_preview->'providers', '[]'::jsonb)) loop
      target_provider_id := public.resolve_import_provider(provider_item->>'code', provider_item->>'name');
      if target_provider_id is null then
        insert into public.providers (code, name, active)
        values (provider_item->>'code', provider_item->>'name', false)
        on conflict (code) do nothing
        returning id into target_provider_id;
        if target_provider_id is null then
          select id into target_provider_id from public.providers where code = provider_item->>'code' limit 1;
        end if;
      end if;
      for source_item in select value from jsonb_array_elements(coalesce(provider_item->'sources', '[]'::jsonb)) loop
        insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
        values ('provider', target_provider_id, batch_id, source_item->>'sheetName', (source_item->>'rowNumber')::integer, provider_item->>'code');
      end loop;
    end loop;

    for item, candidate_number in
      select candidate_value, candidate_ordinal
      from jsonb_array_elements(coalesce(p_preview->'circuitCandidates', '[]'::jsonb)) with ordinality as candidates(candidate_value, candidate_ordinal)
    loop
      target_circuit_id := null;
      existing_id := null;
      primary_identifier := null;
      select count(*) into primary_count
      from jsonb_array_elements(coalesce(item->'identifiers', '[]'::jsonb)) identifier
      where coalesce((identifier->>'primary')::boolean, false);
      if primary_count <> 1 then
        raise exception 'Imported circuit must contain exactly one primary identifier';
      end if;
      select value into primary_identifier
      from jsonb_array_elements(item->'identifiers') identifiers(value)
      where (value->>'primary')::boolean
      limit 1;

      provider_code := item->>'providerCode';
      imported_external_id := item->>'externalCircuitId';
      normalized_id := public.normalize_import_identifier(imported_external_id);
      if provider_code is null or normalized_id is null or length(btrim(normalized_id)) = 0 then
        raise exception 'Imported circuit provider or primary identifier is missing';
      end if;
      if imported_external_id is distinct from primary_identifier->>'value' then
        raise exception 'Imported circuit display identifier must equal its primary identifier';
      end if;
      if primary_identifier->>'normalizedValue' is distinct from normalized_id then
        raise exception 'Imported identifier normalization is invalid';
      end if;
      for identifier_item in select value from jsonb_array_elements(item->'identifiers') loop
        computed_identifier_normalized := public.normalize_import_identifier(identifier_item->>'value');
        if identifier_item->>'normalizedValue' is distinct from computed_identifier_normalized then
          raise exception 'Imported identifier normalization is invalid';
        end if;
      end loop;
      target_provider_id := public.resolve_import_provider(provider_code, item->>'providerName');
      if target_provider_id is null then
        raise exception 'Imported circuit provider could not be resolved';
      end if;
      imported_expiry_date := nullif(item->>'expiryDate', '')::date;
      computed_status := case
        when imported_expiry_date is null then 'draft'
        when imported_expiry_date < timezone('Asia/Dhaka', now())::date then 'expired'
        else 'active'
      end;
      if item->>'status' is distinct from computed_status then
        raise exception 'Imported lifecycle does not match database-derived lifecycle';
      end if;
      if coalesce((item->>'notificationEnabled')::boolean, false) is distinct from (computed_status = 'active')
         or item->>'ownerOverride' is distinct from case when computed_status = 'active' then 'BSCPLC IIG Support' else null end then
        raise exception 'Imported notification or ownership state does not match lifecycle';
      end if;
      import_status := computed_status;

      perform pg_catalog.pg_advisory_xact_lock(hashtextextended(target_provider_id::text || ':' || normalized_id, 0));
      select id into existing_id
      from public.circuits
      where provider_id = target_provider_id and normalized_circuit_id = normalized_id and status <> 'archived'
      limit 1;
      decision := p_decisions ->> (provider_code || ':' || normalized_id);
      if existing_id is not null and decision is null then
        raise exception 'A duplicate import candidate requires an explicit decision';
      end if;
      decision := coalesce(decision, 'create');
      if decision not in ('skip', 'merge', 'create') then raise exception 'Unsupported import decision'; end if;
      if existing_id is null and decision in ('skip', 'merge') then raise exception 'Skip or merge requires an existing circuit'; end if;

      if existing_id is not null and decision = 'skip' then
        target_circuit_id := existing_id;
        skipped_circuits := skipped_circuits + 1;
      elsif existing_id is not null and decision = 'merge' then
        target_circuit_id := existing_id;
        update public.circuits set
          external_circuit_id = imported_external_id,
          identifier_type = item->>'identifierType',
          service_type = coalesce(item->>'serviceType', service_type),
          capacity = coalesce(item->>'capacity', capacity),
          location = coalesce(item->>'location', location),
          segment = coalesce(item->>'segment', segment),
          connected_router = coalesce(item->>'connectedRouter', connected_router),
          start_date = coalesce(nullif(item->>'startDate', '')::date, start_date),
          expiry_version = case when coalesce(imported_expiry_date, expiry_date) is distinct from expiry_date then expiry_version + 1 else expiry_version end,
          expiry_date = coalesce(imported_expiry_date, expiry_date),
          renewal_procedure_start_date = coalesce(nullif(item->>'renewalProcedureStartDate', '')::date, renewal_procedure_start_date),
          monthly_cost = coalesce(nullif(item->>'monthlyCost', '')::numeric, monthly_cost),
          currency = coalesce(nullif(upper(item->>'currency'), ''), currency),
          raw_cost_details = coalesce(item->>'rawCostDetails', raw_cost_details),
          notes = coalesce(item->>'notes', notes),
          status = case when import_status = 'draft' then status else import_status end,
          notification_enabled = case when import_status = 'draft' then notification_enabled else (import_status = 'active') end,
          owner_override = case when import_status = 'draft' then owner_override when import_status = 'active' then 'BSCPLC IIG Support' else null end,
          verified_by = case when import_status = 'draft' then verified_by else p_actor_user_id end,
          verified_at = case when import_status = 'draft' then verified_at else timezone('utc', now()) end
        where id = target_circuit_id;
        merged_circuits := merged_circuits + 1;
      else
        stored_external_id := imported_external_id;
        stored_normalized_id := normalized_id;
        if existing_id is not null then
          stored_external_id := imported_external_id || '#V' || replace(batch_id::text, '-', '') || '_' || candidate_number::text;
          stored_normalized_id := normalized_id || '#V' || replace(batch_id::text, '-', '') || '_' || candidate_number::text;
          import_status := 'draft';
          versioned_circuits := versioned_circuits + 1;
        end if;
        insert into public.circuits (
          provider_id, external_circuit_id, normalized_circuit_id, identifier_type,
          service_type, capacity, location, segment, connected_router, start_date, expiry_date,
          renewal_procedure_start_date, monthly_cost, currency, raw_cost_details, notes,
          status, notification_enabled, owner_override, verified_by, verified_at
        ) values (
          target_provider_id, stored_external_id, stored_normalized_id, item->>'identifierType',
          item->>'serviceType', item->>'capacity', item->>'location', item->>'segment', item->>'connectedRouter',
          nullif(item->>'startDate', '')::date, nullif(item->>'expiryDate', '')::date,
          nullif(item->>'renewalProcedureStartDate', '')::date, nullif(item->>'monthlyCost', '')::numeric,
          nullif(upper(item->>'currency'), ''), item->>'rawCostDetails', item->>'notes',
          import_status, (import_status = 'active'), case when import_status = 'active' then 'BSCPLC IIG Support' else null end,
          case when import_status = 'draft' then null else p_actor_user_id end,
          case when import_status = 'draft' then null else timezone('utc', now()) end
        ) returning id into target_circuit_id;
        created_circuits := created_circuits + 1;
      end if;

      if decision <> 'skip' then
        if not (existing_id is not null and decision = 'create') then
          update public.circuit_identifiers
          set identifier_kind = primary_identifier->>'kind',
              original_value = imported_external_id,
              normalized_value = normalized_id
          where circuit_id = target_circuit_id and is_primary;
        else
          update public.circuit_identifiers
          set identifier_kind = primary_identifier->>'kind'
          where circuit_id = target_circuit_id and is_primary;
        end if;
        for identifier_item in
          select value from jsonb_array_elements(coalesce(item->'identifiers', '[]'::jsonb))
          order by coalesce((value->>'primary')::boolean, false) desc, value->>'normalizedValue', value->>'kind'
        loop
          computed_identifier_normalized := public.normalize_import_identifier(identifier_item->>'value');
          if coalesce((identifier_item->>'primary')::boolean, false)
             and not (existing_id is not null and decision = 'create') then
            continue;
          end if;
          insert into public.circuit_identifiers (circuit_id, identifier_kind, original_value, normalized_value, is_primary)
          values (
            target_circuit_id,
            identifier_item->>'kind',
            identifier_item->>'value',
            computed_identifier_normalized,
            false
          )
          on conflict (circuit_id, normalized_value) do update
          set original_value = excluded.original_value;
        end loop;
        if (select count(*) from public.circuit_identifiers where circuit_id = target_circuit_id and is_primary) <> 1 then
          raise exception 'Imported circuit must persist exactly one primary identifier';
        end if;
      end if;

      for source_item in select value from jsonb_array_elements(coalesce(item->'sources', '[]'::jsonb)) loop
        insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
        values ('circuit', target_circuit_id, batch_id, source_item->>'sheetName', (source_item->>'rowNumber')::integer, imported_external_id);
      end loop;
    end loop;

    update public.import_batches
    set status = 'committed', committed_at = timezone('utc', now()), idempotency_checksum = p_checksum
    where id = batch_id;
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, after_json)
    values (p_actor_user_id, 'import.commit', 'import_batch', batch_id, jsonb_build_object(
      'createdCircuits', created_circuits,
      'skippedCircuits', skipped_circuits,
      'mergedCircuits', merged_circuits,
      'versionedCircuits', versioned_circuits,
      'invoiceCount', invoice_count
    ));
    return jsonb_build_object(
      'batchId', batch_id,
      'counts', jsonb_build_object(
        'createdCircuits', created_circuits,
        'skippedCircuits', skipped_circuits,
        'mergedCircuits', merged_circuits,
        'versionedCircuits', versioned_circuits,
        'invoiceCount', invoice_count
      )
    );
  exception when others then
    update public.import_batches
    set status = 'rejected',
        preview_summary = jsonb_build_object('status', 'rejected', 'errorCode', 'IMPORT_COMMIT_FAILED')
    where id = batch_id;
    return jsonb_build_object('status', 'rejected', 'batchId', batch_id, 'errorCode', 'IMPORT_COMMIT_FAILED');
  end;
end;
$$;

revoke all on function public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb) from public;
revoke all on function public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb) to service_role;

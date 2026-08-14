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

create table if not exists public.circuit_identifiers (
  id uuid primary key default gen_random_uuid(),
  circuit_id uuid not null references public.circuits(id) on delete cascade,
  identifier_kind text not null check (identifier_kind in ('circuit', 'link', 'bscplc', 'provider', 'customer_link', 'service_order', 'alternate')),
  original_value text not null check (length(btrim(original_value)) > 0),
  normalized_value text not null check (length(btrim(normalized_value)) > 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists circuit_identifiers_unique_value_idx
  on public.circuit_identifiers (circuit_id, identifier_kind, normalized_value);
create unique index if not exists circuit_identifiers_one_primary_idx
  on public.circuit_identifiers (circuit_id) where is_primary;
create index if not exists circuit_identifiers_normalized_search_idx
  on public.circuit_identifiers (normalized_value);

insert into public.circuit_identifiers (circuit_id, identifier_kind, original_value, normalized_value, is_primary)
select id, identifier_type, external_circuit_id, normalized_circuit_id, true
from public.circuits
where length(btrim(external_circuit_id)) > 0 and length(btrim(normalized_circuit_id)) > 0
on conflict (circuit_id, identifier_kind, normalized_value) do update
set original_value = excluded.original_value,
    is_primary = true;

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
  actor_role text;
  primary_count integer;
  candidate_number bigint;
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

  insert into public.import_batches (filename, checksum, sheet_names, preview_summary, status, created_by)
  values (p_filename, p_checksum, p_sheet_names, coalesce(p_preview->'summary', '{}'::jsonb), 'previewed', p_actor_user_id)
  returning id into batch_id;

  begin
    for provider_item in select value from jsonb_array_elements(coalesce(p_preview->'providers', '[]'::jsonb)) loop
      target_provider_id := public.resolve_import_provider(provider_item->>'code', provider_item->>'name');
      if target_provider_id is null then
        insert into public.providers (code, name, active)
        values (provider_item->>'code', provider_item->>'name', true)
        on conflict (code) do update set name = excluded.name, active = true
        returning id into target_provider_id;
      else
        update public.providers set name = provider_item->>'name', active = true where id = target_provider_id;
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
      normalized_id := primary_identifier->>'normalizedValue';
      imported_external_id := item->>'externalCircuitId';
      if provider_code is null or normalized_id is null or length(btrim(normalized_id)) = 0 then
        raise exception 'Imported circuit provider or primary identifier is missing';
      end if;
      if imported_external_id is distinct from primary_identifier->>'value' then
        raise exception 'Imported circuit display identifier must equal its primary identifier';
      end if;
      target_provider_id := public.resolve_import_provider(provider_code, item->>'providerName');
      if target_provider_id is null then
        raise exception 'Imported circuit provider could not be resolved';
      end if;
      import_status := item->>'status';
      if import_status not in ('draft', 'active', 'expired') then
        raise exception 'Imported circuit lifecycle is invalid';
      end if;

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
          service_type = coalesce(item->>'serviceType', service_type),
          capacity = coalesce(item->>'capacity', capacity),
          location = coalesce(item->>'location', location),
          segment = coalesce(item->>'segment', segment),
          connected_router = coalesce(item->>'connectedRouter', connected_router),
          start_date = coalesce(nullif(item->>'startDate', '')::date, start_date),
          expiry_version = case when nullif(item->>'expiryDate', '')::date is distinct from expiry_date then expiry_version + 1 else expiry_version end,
          expiry_date = coalesce(nullif(item->>'expiryDate', '')::date, expiry_date),
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
        if existing_id is not null then
          insert into public.circuit_identifiers (circuit_id, identifier_kind, original_value, normalized_value, is_primary)
          values (target_circuit_id, item->>'identifierType', stored_external_id, stored_normalized_id, true);
        end if;
      end if;

      if decision <> 'skip' then
        for identifier_item in
          select value from jsonb_array_elements(coalesce(item->'identifiers', '[]'::jsonb))
          order by coalesce((value->>'primary')::boolean, false) desc, value->>'normalizedValue', value->>'kind'
        loop
          insert into public.circuit_identifiers (circuit_id, identifier_kind, original_value, normalized_value, is_primary)
          values (
            target_circuit_id,
            identifier_item->>'kind',
            identifier_item->>'value',
            identifier_item->>'normalizedValue',
            case
              when existing_id is not null and decision = 'create' then false
              when coalesce((identifier_item->>'primary')::boolean, false)
                and not exists (select 1 from public.circuit_identifiers ci where ci.circuit_id = target_circuit_id and ci.is_primary)
              then true else false
            end
          )
          on conflict (circuit_id, identifier_kind, normalized_value) do update
          set original_value = excluded.original_value;
        end loop;
      end if;

      for source_item in select value from jsonb_array_elements(coalesce(item->'sources', '[]'::jsonb)) loop
        insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
        values ('circuit', target_circuit_id, batch_id, source_item->>'sheetName', (source_item->>'rowNumber')::integer, imported_external_id);
      end loop;
    end loop;

    update public.import_batches set status = 'committed', committed_at = timezone('utc', now()) where id = batch_id;
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

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  role text not null default 'viewer' check (role in ('admin', 'provider_manager', 'operations_editor', 'auditor', 'viewer')),
  active boolean not null default false,
  allowed_provider_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default timezone('utc', now()),
  last_login_at timestamptz
);

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(code) between 2 and 40),
  name text not null,
  active boolean not null default false,
  default_responsible_officer text,
  primary_owner_user_id uuid references public.profiles(id) on delete set null,
  backup_owner_user_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.provider_contacts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  contact_type text not null check (contact_type in ('internal_owner', 'provider_account_manager', 'recipient', 'other')),
  name text not null,
  role_title text,
  email text,
  phone_e164 text,
  whatsapp_opt_in_at timestamptz,
  whatsapp_opt_in_source text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

create table if not exists public.provider_notification_settings (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  email_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  discord_enabled boolean not null default false,
  email_to jsonb not null default '[]'::jsonb,
  email_cc jsonb not null default '[]'::jsonb,
  email_bcc jsonb not null default '[]'::jsonb,
  reply_to text,
  subject_prefix text,
  email_template_override text,
  whatsapp_template_name text,
  whatsapp_recipient_ids uuid[] not null default '{}'::uuid[],
  discord_webhook_ciphertext text,
  discord_mention_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  provider_id uuid references public.providers(id) on delete cascade,
  circuit_id uuid,
  first_lead_months smallint not null default 4 check (first_lead_months >= 0 and first_lead_months <= 24),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  check (provider_id is null or circuit_id is null)
);

create table if not exists public.circuits (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  external_circuit_id text not null,
  normalized_circuit_id text not null,
  identifier_type text not null default 'circuit' check (identifier_type in ('circuit', 'link', 'durable')),
  service_type text,
  capacity text,
  location text,
  start_date date,
  expiry_date date,
  expiry_version integer not null default 1 check (expiry_version > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'renewal_pending', 'renewed', 'expired', 'terminated', 'archived')),
  action_status text not null default 'no_action' check (action_status in ('no_action', 'reviewing', 'renewal_requested', 'renewal_confirmed', 'termination_planned', 'closed')),
  owner_user_id uuid references public.profiles(id) on delete restrict,
  owner_override text,
  backup_owner_user_id uuid references public.profiles(id) on delete set null,
  monthly_cost numeric(14, 2),
  currency text check (currency is null or length(currency) = 3),
  notes text,
  notification_enabled boolean not null default true,
  notification_rule_id uuid references public.notification_rules(id) on delete set null,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (start_date is null or expiry_date is null or expiry_date > start_date),
  check (status not in ('active', 'renewal_pending') or (expiry_date is not null and verified_at is not null))
);

alter table public.notification_rules
  drop constraint if exists notification_rules_circuit_id_fkey;
alter table public.notification_rules
  add constraint notification_rules_circuit_id_fkey
  foreign key (circuit_id) references public.circuits(id) on delete cascade;

alter table public.circuits drop constraint if exists circuits_owner_user_id_fkey;
alter table public.circuits drop constraint if exists circuits_verified_by_fkey;
alter table public.circuits
  add constraint circuits_owner_user_id_fkey foreign key (owner_user_id) references public.profiles(id) on delete restrict;
alter table public.circuits
  add constraint circuits_verified_by_fkey foreign key (verified_by) references public.profiles(id) on delete restrict;

create table if not exists public.notification_milestones (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.notification_rules(id) on delete cascade,
  milestone_key text not null,
  label text not null,
  months_before smallint,
  days_before smallint,
  enabled boolean not null default true,
  unique (rule_id, milestone_key),
  check ((months_before is not null and days_before is null) or (months_before is null and days_before is not null)),
  check (months_before is null or (months_before >= 0 and months_before <= 24)),
  check (days_before is null or (days_before >= 0 and days_before <= 3650))
);

create table if not exists public.renewal_history (
  id uuid primary key default gen_random_uuid(),
  circuit_id uuid not null references public.circuits(id) on delete restrict,
  expiry_version integer not null,
  previous_expiry_date date,
  new_expiry_date date,
  previous_action_status text,
  new_action_status text,
  renewal_reference text,
  notes text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email', 'whatsapp', 'discord')),
  provider_id uuid references public.providers(id) on delete cascade,
  name text not null,
  language text not null default 'en',
  subject text,
  body text not null,
  version integer not null default 1,
  active boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (channel, provider_id, name, version)
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  circuit_id uuid not null references public.circuits(id) on delete restrict,
  expiry_version integer not null,
  rule_id uuid references public.notification_rules(id) on delete set null,
  milestone_key text not null,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'partial_failure', 'failed', 'cancelled')),
  generated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (circuit_id, expiry_version, milestone_key)
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete restrict,
  channel text not null check (channel in ('email', 'whatsapp', 'discord')),
  target_hash text not null,
  masked_target text not null,
  target_ciphertext text,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'retry_scheduled', 'permanent_failure', 'suppressed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  external_message_id text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (event_id, channel, target_hash)
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  checksum text not null,
  sheet_names jsonb not null default '[]'::jsonb,
  preview_summary jsonb not null default '{}'::jsonb,
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'rejected')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  committed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.import_batches alter column created_by set not null;

create table if not exists public.invoice_references (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.providers(id) on delete set null,
  circuit_id uuid references public.circuits(id) on delete set null,
  reference_number text not null,
  source_line text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.source_lineage (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  import_batch_id uuid not null references public.import_batches(id) on delete restrict,
  sheet_name text not null,
  row_number integer not null check (row_number > 0),
  raw_identifier text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  request_id text,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists providers_active_code_idx on public.providers (lower(code)) where active;
create unique index if not exists circuits_current_identifier_idx on public.circuits (provider_id, normalized_circuit_id) where status <> 'archived';
create unique index if not exists invoice_reference_provider_idx on public.invoice_references (coalesce(provider_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(reference_number));
create index if not exists circuits_due_idx on public.circuits (status, expiry_date) where notification_enabled;
create index if not exists events_due_idx on public.notification_events (status, due_date);
create index if not exists deliveries_queue_idx on public.notification_deliveries (status, next_attempt_at);
create index if not exists audit_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'viewer',
    false
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

drop trigger if exists providers_touch_updated_at on public.providers;
create trigger providers_touch_updated_at before update on public.providers for each row execute procedure public.touch_updated_at();
drop trigger if exists contacts_touch_updated_at on public.provider_contacts;
create trigger contacts_touch_updated_at before update on public.provider_contacts for each row execute procedure public.touch_updated_at();
drop trigger if exists settings_touch_updated_at on public.provider_notification_settings;
create trigger settings_touch_updated_at before update on public.provider_notification_settings for each row execute procedure public.touch_updated_at();
drop trigger if exists circuits_touch_updated_at on public.circuits;
create trigger circuits_touch_updated_at before update on public.circuits for each row execute procedure public.touch_updated_at();
drop trigger if exists deliveries_touch_updated_at on public.notification_deliveries;
create trigger deliveries_touch_updated_at before update on public.notification_deliveries for each row execute procedure public.touch_updated_at();

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid() and active limit 1;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin_or_editor()
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select public.current_profile_role() in ('admin', 'operations_editor');
$$;

create or replace function public.has_provider_access(target_provider_id uuid)
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active
      and (
        role in ('admin', 'operations_editor')
        or target_provider_id = any(allowed_provider_ids)
      )
  );
$$;

create or replace function public.validate_provider_state()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  -- Serialize provider/profile lifecycle changes so owner checks cannot race deactivation.
  perform pg_catalog.pg_advisory_xact_lock(73482123::bigint);

  if new.active and nullif(btrim(new.default_responsible_officer), '') is null and new.primary_owner_user_id is null then
    raise exception 'Active providers require a responsible owner';
  end if;
  if new.primary_owner_user_id is not null and not exists (
    select 1 from public.profiles where id = new.primary_owner_user_id and active
  ) then
    raise exception 'Provider owner must be an active user';
  end if;
  if new.backup_owner_user_id is not null and not exists (
    select 1 from public.profiles where id = new.backup_owner_user_id and active
  ) then
    raise exception 'Provider backup owner must be an active user';
  end if;
  return new;
end;
$$;

drop trigger if exists providers_validate_state on public.providers;
create trigger providers_validate_state before insert or update on public.providers
for each row execute procedure public.validate_provider_state();

create or replace function public.update_circuit_action(
  target_circuit_id uuid,
  new_action_status text,
  new_notes text default null
)
returns public.circuits
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  updated_circuit public.circuits;
begin
  if public.current_profile_role() not in ('admin', 'operations_editor', 'provider_manager') then
    raise exception 'Only operational roles may update renewal action';
  end if;
  update public.circuits
  set action_status = new_action_status,
      notes = coalesce(new_notes, notes),
      updated_at = timezone('utc', now())
  where id = target_circuit_id and public.has_provider_access(provider_id)
  returning * into updated_circuit;

  if updated_circuit.id is null then
    raise exception 'Circuit is outside the current provider scope or not found';
  end if;
  return updated_circuit;
end;
$$;

revoke all on function public.update_circuit_action(uuid, text, text) from public;
grant execute on function public.update_circuit_action(uuid, text, text) to authenticated;

create or replace function public.validate_circuit_state()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  -- Serialize lifecycle/profile changes so verifier and owner checks cannot race.
  perform pg_catalog.pg_advisory_xact_lock(73482123::bigint);

  if tg_op = 'DELETE' then
    return old;
  end if;

  new.normalized_circuit_id := upper(regexp_replace(regexp_replace(new.external_circuit_id, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'));

  if new.status in ('active', 'renewal_pending') then
    if new.expiry_date is null or new.verified_at is null or new.verified_by is null then
      raise exception 'Active circuits require a verified expiry date';
    end if;
    if new.owner_user_id is null and nullif(btrim(new.owner_override), '') is null then
      raise exception 'Active circuits require a responsible owner';
    end if;
    if new.owner_user_id is not null and not exists (select 1 from public.profiles where id = new.owner_user_id and active) then
      raise exception 'Circuit owner must be an active user';
    end if;
    if new.backup_owner_user_id is not null and not exists (select 1 from public.profiles where id = new.backup_owner_user_id and active) then
      raise exception 'Circuit backup owner must be an active user';
    end if;
    if new.verified_at > now() then
      raise exception 'Verification time cannot be in the future';
    end if;
    if not exists (select 1 from public.profiles where id = new.verified_by and active) then
      raise exception 'Verification requires an active user';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.expiry_date is not distinct from old.expiry_date and new.expiry_version <> old.expiry_version then
      raise exception 'Expiry version can only change when expiry date changes';
    end if;
    if old.verified_at is not null and new.verified_at is null then
      raise exception 'Verification cannot be cleared';
    end if;
    if old.verified_by is not null and new.verified_by is null then
      raise exception 'Verification cannot be cleared';
    end if;
    if old.verified_at is not null and new.verified_at < old.verified_at then
      raise exception 'Verification timestamp cannot move backwards';
    end if;
    if new.verified_at is distinct from old.verified_at or new.verified_by is distinct from old.verified_by then
      if new.verified_at is null or new.verified_by is null or new.verified_at > now() then
        raise exception 'Verification requires a valid timestamp and active user';
      end if;
      if not exists (select 1 from public.profiles where id = new.verified_by and active) then
        raise exception 'Verification requires an active user';
      end if;
    end if;
    if new.status in ('active', 'renewal_pending') and old.status not in ('active', 'renewal_pending') then
      if new.verified_at <= coalesce(old.verified_at, '-infinity'::timestamptz) then
        raise exception 'Activation requires a fresh verification';
      end if;
    end if;
    if new.expiry_date is distinct from old.expiry_date then
      if new.expiry_version <= old.expiry_version then
        raise exception 'Expiry version must increase when expiry date changes';
      end if;
      if new.verified_at is null or new.verified_at <= coalesce(old.verified_at, '-infinity'::timestamptz) or new.verified_by is null then
        raise exception 'A changed expiry date requires a new verification';
      end if;
      if new.verified_at > now() or not exists (select 1 from public.profiles where id = new.verified_by and active) then
        raise exception 'Expiry verification requires an active user and a valid timestamp';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.record_circuit_expiry_change()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.expiry_date is distinct from old.expiry_date then
    update public.notification_events
    set status = 'cancelled', completed_at = timezone('utc', now())
    where circuit_id = new.id
      and expiry_version = old.expiry_version
      and status in ('pending', 'processing');

    insert into public.renewal_history (
      circuit_id, expiry_version, previous_expiry_date, new_expiry_date,
      previous_action_status, new_action_status, changed_by
    ) values (
      new.id, new.expiry_version, old.expiry_date, new.expiry_date,
      old.action_status, new.action_status, auth.uid()
    );
  end if;
  return new;
end;
$$;

create or replace function public.prevent_profile_circuit_invariants()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Profiles cannot be deleted; deactivate the account instead';
  end if;

  if old.active and not new.active then
     perform pg_catalog.pg_advisory_xact_lock(73482123::bigint);
      if exists (
        select 1
        from (
         select status
         from public.circuits
         where owner_user_id = old.id or verified_by = old.id or backup_owner_user_id = old.id
        ) as affected_circuit
        where affected_circuit.status in ('active', 'renewal_pending')
       ) then
        raise exception 'Active circuits require their owner and verifier to remain active';
      end if;
     if exists (
       select 1
       from public.providers
       where active and (primary_owner_user_id = old.id or backup_owner_user_id = old.id)
     ) then
       raise exception 'Active providers require their owners to remain active';
     end if;
   end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_circuit_invariants on public.profiles;
create trigger profiles_protect_circuit_invariants before update or delete on public.profiles for each row execute procedure public.prevent_profile_circuit_invariants();

drop trigger if exists circuits_validate_expiry on public.circuits;
drop trigger if exists circuits_validate_state on public.circuits;
create trigger circuits_validate_state before insert or update or delete on public.circuits for each row execute procedure public.validate_circuit_state();
drop trigger if exists circuits_record_expiry on public.circuits;
create trigger circuits_record_expiry after update on public.circuits for each row execute procedure public.record_circuit_expiry_change();

drop function if exists public.commit_import_batch(uuid, uuid, text, text, jsonb, jsonb, jsonb);
drop function if exists public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb);

create or replace function public.resolve_import_provider(p_code text, p_name text)
returns uuid
language plpgsql
stable
as $$
declare
  matched_id uuid;
  name_match_count integer;
begin
  if p_code is not null then
    select id into matched_id
    from public.providers
    where code = p_code
    limit 1;
    if matched_id is not null then
      return matched_id;
    end if;
  end if;
  select count(*) into name_match_count
  from public.providers
  where p_name is not null and upper(name) = upper(p_name);
  if name_match_count = 0 then
    return null;
  end if;
  if name_match_count > 1 then
    raise exception 'Provider name % is ambiguous; resolve it by code before importing', p_name;
  end if;
  select id into matched_id
  from public.providers
  where upper(name) = upper(p_name)
  limit 1;
  return matched_id;
end;
$$;

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
  item jsonb;
  target_provider_id uuid;
  existing_id uuid;
  circuit_id uuid;
  invoice_id uuid;
  provider_code text;
  normalized_id text;
  decision text;
  created_circuits integer := 0;
  skipped_circuits integer := 0;
  merged_circuits integer := 0;
  versioned_circuits integer := 0;
  invoice_count integer := 0;
  actor_role text;
  candidate_number bigint;
begin
  if p_actor_user_id is null then
    raise exception 'Import commit requires an actor';
  end if;
  select role into actor_role from public.profiles where id = p_actor_user_id and active;
  if actor_role is null or actor_role not in ('admin', 'operations_editor') then
    raise exception 'Import commit requires an administrator or operations editor';
  end if;

  insert into public.import_batches (filename, checksum, sheet_names, preview_summary, status, created_by)
  values (p_filename, p_checksum, p_sheet_names, p_preview, 'previewed', p_actor_user_id)
  returning id into batch_id;

  begin
    for item in select value from jsonb_array_elements(coalesce(p_preview->'providers', '[]'::jsonb)) loop
      target_provider_id := public.resolve_import_provider(item->>'code', item->>'name');
      if target_provider_id is null then
        insert into public.providers (code, name, active)
        values (item->>'code', item->>'name', false)
        on conflict (code) do nothing
        returning id into target_provider_id;
        if target_provider_id is null then
          select id into target_provider_id from public.providers where code = item->>'code' limit 1;
        end if;
      end if;
      if target_provider_id is null then
        raise exception 'Imported provider could not be resolved';
      end if;
      insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
      values ('provider', target_provider_id, batch_id, item->'source'->>'sheetName', (item->'source'->>'rowNumber')::integer, item->>'code');
    end loop;

    for item, candidate_number in
      select candidate_value, candidate_ordinal
      from jsonb_array_elements(coalesce(p_preview->'circuitCandidates', '[]'::jsonb)) with ordinality as candidates(candidate_value, candidate_ordinal)
    loop
      provider_code := regexp_replace(upper(item->>'providerName'), '[^A-Z0-9]+', '_', 'g');
      provider_code := trim(both '_' from provider_code);
      target_provider_id := public.resolve_import_provider(provider_code, item->>'providerName');
      if target_provider_id is null then
        raise exception 'Imported circuit provider could not be resolved';
      end if;

      normalized_id := upper(regexp_replace(regexp_replace(item->>'externalCircuitId', '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'));
      existing_id := null;
      select id into existing_id
      from public.circuits
      where circuits.provider_id = target_provider_id and circuits.normalized_circuit_id = normalized_id and circuits.status <> 'archived'
      limit 1;

      decision := p_decisions ->> (provider_code || ':' || normalized_id);
      if existing_id is not null and decision is null then
        raise exception 'A duplicate import candidate requires an explicit decision';
      end if;
      decision := coalesce(decision, 'create');
      if decision not in ('skip', 'merge', 'create') then
        raise exception 'Unsupported import decision';
      end if;
      if existing_id is null and decision in ('skip', 'merge') then
        raise exception 'Skip or merge requires an existing circuit';
      end if;
      if existing_id is not null and decision = 'skip' then
        insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
        values ('circuit', existing_id, batch_id, item->'source'->>'sheetName', (item->'source'->>'rowNumber')::integer, item->>'externalCircuitId');
        skipped_circuits := skipped_circuits + 1;
        continue;
      end if;
      if existing_id is not null and decision = 'merge' then
        insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
        values ('circuit', existing_id, batch_id, item->'source'->>'sheetName', (item->'source'->>'rowNumber')::integer, item->>'externalCircuitId');
        merged_circuits := merged_circuits + 1;
        continue;
      end if;
      if existing_id is not null and decision = 'create' then
        normalized_id := normalized_id || '#V' || replace(batch_id::text, '-', '') || '_' || candidate_number::text;
      end if;

      insert into public.circuits (
        provider_id, external_circuit_id, normalized_circuit_id, identifier_type,
        status, notification_enabled, notes
      ) values (
        target_provider_id,
        case when existing_id is null then item->>'externalCircuitId' else (item->>'externalCircuitId') || '#V' || replace(batch_id::text, '-', '') || '_' || candidate_number::text end,
        normalized_id,
        item->>'identifierType',
        'draft', false,
        case when existing_id is null then 'Imported draft; contract dates require verification.' else 'Versioned import of an existing identifier; manual review required.' end
      ) returning id into circuit_id;
      insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
      values ('circuit', circuit_id, batch_id, item->'source'->>'sheetName', (item->'source'->>'rowNumber')::integer, item->>'externalCircuitId');
      created_circuits := created_circuits + 1;
      if existing_id is not null then versioned_circuits := versioned_circuits + 1; end if;
    end loop;

    for item in select value from jsonb_array_elements(coalesce(p_preview->'invoiceReferences', '[]'::jsonb)) loop
      provider_code := regexp_replace(upper(item->>'providerName'), '[^A-Z0-9]+', '_', 'g');
      provider_code := trim(both '_' from provider_code);
      target_provider_id := public.resolve_import_provider(provider_code, item->>'providerName');
      invoice_id := null;
      insert into public.invoice_references (provider_id, reference_number, source_line)
      values (target_provider_id, item->>'referenceNumber', (item->'source'->>'sheetName') || ':' || (item->'source'->>'rowNumber'))
      on conflict do nothing
      returning id into invoice_id;
      if invoice_id is null then
        select id into invoice_id
        from public.invoice_references
        where provider_id is not distinct from target_provider_id
          and lower(reference_number) = lower(item->>'referenceNumber')
        limit 1;
      else
        invoice_count := invoice_count + 1;
      end if;
      if invoice_id is not null then
        insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
        values ('invoice_reference', invoice_id, batch_id, item->'source'->>'sheetName', (item->'source'->>'rowNumber')::integer, item->>'referenceNumber');
      end if;
    end loop;

    update public.import_batches set status = 'committed', committed_at = timezone('utc', now()) where id = batch_id;
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, after_json)
    values (p_actor_user_id, 'import.commit', 'import_batch', batch_id, jsonb_build_object('createdCircuits', created_circuits, 'skippedCircuits', skipped_circuits, 'mergedCircuits', merged_circuits, 'versionedCircuits', versioned_circuits, 'invoiceCount', invoice_count));

    return jsonb_build_object(
      'batchId', batch_id,
      'counts', jsonb_build_object('createdCircuits', created_circuits, 'skippedCircuits', skipped_circuits, 'mergedCircuits', merged_circuits, 'versionedCircuits', versioned_circuits, 'invoiceCount', invoice_count)
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

create or replace function public.append_audit_log(
  p_actor_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before_json jsonb,
  p_after_json jsonb,
  p_request_id text
)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if p_actor_user_id is null then
    raise exception 'Audit append requires an actor';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_user_id and active) then
    raise exception 'Audit append requires an active actor';
  end if;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, request_id)
  values (p_actor_user_id, p_action, p_entity_type, p_entity_id, p_before_json, p_after_json, p_request_id);
end;
$$;

revoke all on function public.append_audit_log(uuid, text, text, uuid, jsonb, jsonb, text) from public;
revoke all on function public.append_audit_log(uuid, text, text, uuid, jsonb, jsonb, text) from authenticated;
grant execute on function public.append_audit_log(uuid, text, text, uuid, jsonb, jsonb, text) to service_role;

revoke all on table public.audit_logs from public;
revoke all on table public.audit_logs from anon;
revoke all on table public.audit_logs from authenticated;

create or replace function public.redact_audit_json(value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb;
begin
  if value is null then
    return null;
  end if;
  if jsonb_typeof(value) = 'object' then
    select coalesce(jsonb_object_agg(key, case
      when key ~* '(secret|token|password|api[_-]?key|webhook|ciphertext|bcc|service.?role.?key|encryption.?key|^key$)' then '"[REDACTED]"'::jsonb
      else public.redact_audit_json(child)
    end), '{}'::jsonb)
    into result
    from jsonb_each(value) as entries(key, child);
    return result;
  end if;
  if jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(public.redact_audit_json(child)), '[]'::jsonb)
    into result
    from jsonb_array_elements(value) as entries(child);
    return result;
  end if;
  return value;
end;
$$;

create or replace function public.sanitize_audit_log()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.before_json = public.redact_audit_json(new.before_json);
  new.after_json = public.redact_audit_json(new.after_json);
  return new;
end;
$$;

drop trigger if exists audit_sanitize on public.audit_logs;
create trigger audit_sanitize before insert on public.audit_logs for each row execute procedure public.sanitize_audit_log();

alter table public.profiles enable row level security;
alter table public.providers enable row level security;
alter table public.provider_contacts enable row level security;
alter table public.provider_notification_settings enable row level security;
alter table public.notification_rules enable row level security;
alter table public.circuits enable row level security;
alter table public.notification_milestones enable row level security;
alter table public.renewal_history enable row level security;
alter table public.templates enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.import_batches enable row level security;
alter table public.invoice_references enable row level security;
alter table public.source_lineage enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'profiles', 'providers', 'provider_contacts', 'provider_notification_settings',
        'notification_rules', 'circuits', 'notification_milestones', 'renewal_history',
        'templates', 'notification_events', 'notification_deliveries', 'import_batches',
        'invoice_references', 'source_lineage', 'audit_logs'
      ])
  loop
    execute format('drop policy if exists %I on public.%I', existing_policy.policyname, existing_policy.tablename);
  end loop;
end;
$$;

create policy profiles_select_self_or_admin on public.profiles for select using (id = auth.uid() or public.current_profile_role() = 'admin');
create policy profiles_update_admin on public.profiles for update using (public.current_profile_role() = 'admin') with check (public.current_profile_role() = 'admin');

create policy providers_select_scope on public.providers for select using (public.has_provider_access(id));
create policy providers_insert_admin_editor on public.providers for insert with check (public.is_admin_or_editor());
create policy providers_update_admin_editor on public.providers for update using (public.is_admin_or_editor()) with check (public.is_admin_or_editor());

create policy contacts_select_scope on public.provider_contacts for select using (public.has_provider_access(provider_id));
create policy contacts_write_admin_editor on public.provider_contacts for all using (public.is_admin_or_editor()) with check (public.is_admin_or_editor());

create policy settings_select_admin on public.provider_notification_settings for select using (public.current_profile_role() = 'admin');
create policy settings_write_admin on public.provider_notification_settings for all using (public.current_profile_role() = 'admin') with check (public.current_profile_role() = 'admin');

create policy rules_select_active_scope on public.notification_rules for select using (
  public.is_active_user()
  and (
    (provider_id is null and circuit_id is null)
    or (provider_id is not null and public.has_provider_access(provider_id))
    or (circuit_id is not null and exists (
      select 1 from public.circuits c where c.id = notification_rules.circuit_id and public.has_provider_access(c.provider_id)
    ))
  )
);
create policy rules_write_admin on public.notification_rules for all using (public.current_profile_role() = 'admin') with check (public.current_profile_role() = 'admin');
create policy milestones_select_scope on public.notification_milestones for select using (
  public.is_active_user() and exists (
    select 1 from public.notification_rules r
    where r.id = rule_id
      and (
        (r.provider_id is null and r.circuit_id is null)
        or (r.provider_id is not null and public.has_provider_access(r.provider_id))
        or (r.circuit_id is not null and exists (
          select 1 from public.circuits c where c.id = r.circuit_id and public.has_provider_access(c.provider_id)
        ))
      )
  )
);
create policy milestones_write_admin on public.notification_milestones for all using (public.current_profile_role() = 'admin') with check (public.current_profile_role() = 'admin');

create policy circuits_select_scope on public.circuits for select using (public.has_provider_access(provider_id));
create policy circuits_insert_admin_editor on public.circuits for insert with check (public.is_admin_or_editor());
create policy circuits_update_admin_editor on public.circuits for update using (public.is_admin_or_editor()) with check (public.is_admin_or_editor());

create policy renewal_select_scope on public.renewal_history for select using (exists (select 1 from public.circuits c where c.id = circuit_id and public.has_provider_access(c.provider_id)));

create policy templates_select_scope on public.templates for select using (public.is_active_user() and (provider_id is null or public.has_provider_access(provider_id)));
create policy templates_write_admin on public.templates for all using (public.current_profile_role() = 'admin') with check (public.current_profile_role() = 'admin');

create policy events_select_scope on public.notification_events for select using (exists (select 1 from public.circuits c where c.id = circuit_id and public.has_provider_access(c.provider_id)));
create policy deliveries_select_scope on public.notification_deliveries for select using (exists (select 1 from public.notification_events e join public.circuits c on c.id = e.circuit_id where e.id = event_id and public.has_provider_access(c.provider_id)));

create policy imports_select_authorized on public.import_batches for select using (public.current_profile_role() in ('admin', 'operations_editor', 'auditor'));
create policy invoice_select_scope on public.invoice_references for select using (
  public.current_profile_role() in ('admin', 'auditor')
  or (provider_id is not null and public.has_provider_access(provider_id))
);
create policy lineage_select_authorized on public.source_lineage for select using (public.current_profile_role() in ('admin', 'operations_editor', 'auditor'));

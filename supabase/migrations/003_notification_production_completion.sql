-- Production completion primitives for deterministic notification scheduling and claims.
alter table public.circuits
  add column if not exists renewal_procedure_start_date date;

create table if not exists public.notification_milestone_states (
  circuit_id uuid not null references public.circuits(id) on delete cascade,
  expiry_version integer not null,
  milestone_key text not null,
  due_date date not null,
  state text not null check (state in ('satisfied', 'event_created')),
  event_id uuid references public.notification_events(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (circuit_id, expiry_version, milestone_key)
);

create index if not exists notification_milestone_states_due_idx on public.notification_milestone_states (circuit_id, expiry_version, due_date);

alter table public.notification_events
  add column if not exists is_catch_up boolean not null default false;
alter table public.notification_events
  add column if not exists catch_up_milestone_keys text[] not null default '{}'::text[];

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

  new.normalized_circuit_id := upper(regexp_replace(regexp_replace(new.external_circuit_id, '^\s+|\s+$', '', 'g'), '\\s+', ' ', 'g'));

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
    if
      new.expiry_date is not distinct from old.expiry_date and
      new.renewal_procedure_start_date is not distinct from old.renewal_procedure_start_date and
      new.expiry_version <> old.expiry_version
    then
      raise exception 'Expiry version can only change when schedule inputs change';
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

    if new.renewal_procedure_start_date is distinct from old.renewal_procedure_start_date then
      if new.expiry_version <= old.expiry_version then
        raise exception 'Expiry version must increase when procedure start date changes';
      end if;
      if new.verified_at is null or new.verified_by is null or new.verified_at > now() then
        raise exception 'Procedure start date changes require a valid verification';
      end if;
      if not exists (select 1 from public.profiles where id = new.verified_by and active) then
        raise exception 'Procedure start date verification requires an active user';
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
  elsif new.renewal_procedure_start_date is distinct from old.renewal_procedure_start_date then
    update public.notification_events
    set status = 'cancelled', completed_at = timezone('utc', now())
    where circuit_id = new.id
      and expiry_version = old.expiry_version
      and status in ('pending', 'processing');

    update public.notification_milestone_states
    set state = 'satisfied'
    where circuit_id = new.id
      and expiry_version = old.expiry_version
      and state = 'satisfied';
  end if;

  return new;
end;
$$;

drop trigger if exists circuits_validate_state on public.circuits;
create trigger circuits_validate_state before insert or update or delete on public.circuits for each row execute procedure public.validate_circuit_state();
drop trigger if exists circuits_record_expiry on public.circuits;
create trigger circuits_record_expiry after update on public.circuits for each row execute procedure public.record_circuit_expiry_change();

create or replace function public.ensure_due_notification_events(
  p_circuit_id uuid,
  p_expiry_version integer,
  p_rule_id uuid,
  p_milestones jsonb
) returns uuid[]
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_due_milestones jsonb;
  v_count integer;
  v_has_states boolean := false;
  v_event_ids uuid[] := '{}'::uuid[];
  v_item jsonb;
  v_index integer;
  v_total integer;
  v_event_id uuid;
  v_catchup_keys text[] := '{}'::text[];
begin
  if p_milestones is null or jsonb_typeof(p_milestones) <> 'array' then
    return v_event_ids;
  end if;

  select jsonb_agg(item order by (item ->> 'dueDate')::date, item ->> 'key')
  into v_due_milestones
  from jsonb_array_elements(p_milestones) as item;

  select coalesce(jsonb_array_length(v_due_milestones), 0)
  into v_count;
  if v_count = 0 then
    return v_event_ids;
  end if;

  if not exists (
    select 1 from public.circuits where id = p_circuit_id and expiry_version = p_expiry_version
  ) then
    return v_event_ids;
  end if;

  perform 1 from public.circuits where id = p_circuit_id for update;

  select exists(
    select 1 from public.notification_milestone_states
    where circuit_id = p_circuit_id and expiry_version = p_expiry_version
  ) into v_has_states;

  if v_has_states then
    for v_item in
      select m
      from jsonb_array_elements(v_due_milestones) as m
    loop
      if exists (
        select 1 from public.notification_milestone_states
        where circuit_id = p_circuit_id
          and expiry_version = p_expiry_version
          and milestone_key = v_item ->> 'key'
      ) then
        continue;
      end if;

      insert into public.notification_events (
        circuit_id,
        expiry_version,
        rule_id,
        milestone_key,
        due_date,
        status,
        generated_at
      )
      values (
        p_circuit_id,
        p_expiry_version,
        p_rule_id,
        v_item ->> 'key',
        (v_item ->> 'dueDate')::date,
        'pending',
        timezone('utc', now())
      )
      returning id into v_event_id;

      insert into public.notification_milestone_states (
        circuit_id,
        expiry_version,
        milestone_key,
        due_date,
        state,
        event_id
      )
      values (
        p_circuit_id,
        p_expiry_version,
        v_item ->> 'key',
        (v_item ->> 'dueDate')::date,
        'event_created',
        v_event_id
      );

      v_event_ids := array_append(v_event_ids, v_event_id);
    end loop;

    return v_event_ids;
  end if;

  v_index := 0;
  v_total := v_count;
  for v_item in
    select m
    from jsonb_array_elements(v_due_milestones) as m
  loop
    v_index := v_index + 1;

    if v_total > 1 and v_index < v_total then
      insert into public.notification_milestone_states (
        circuit_id,
        expiry_version,
        milestone_key,
        due_date,
        state
      )
      values (
        p_circuit_id,
        p_expiry_version,
        v_item ->> 'key',
        (v_item ->> 'dueDate')::date,
        'satisfied'
      );
      v_catchup_keys := array_append(v_catchup_keys, v_item ->> 'key');
      continue;
    end if;

    insert into public.notification_events (
      circuit_id,
      expiry_version,
      rule_id,
      milestone_key,
      due_date,
      status,
      generated_at,
      is_catch_up,
      catch_up_milestone_keys
    )
    values (
      p_circuit_id,
      p_expiry_version,
      p_rule_id,
      v_item ->> 'key',
      (v_item ->> 'dueDate')::date,
      'pending',
      timezone('utc', now()),
      v_total > 1,
      case when v_total > 1 then array_append(v_catchup_keys, v_item ->> 'key') else '{}'::text[] end
    )
    returning id into v_event_id;

    insert into public.notification_milestone_states (
      circuit_id,
      expiry_version,
      milestone_key,
      due_date,
      state,
      event_id
    )
    values (
      p_circuit_id,
      p_expiry_version,
      v_item ->> 'key',
      (v_item ->> 'dueDate')::date,
      'event_created',
      v_event_id
    );

    v_event_ids := array_append(v_event_ids, v_event_id);
  end loop;

  return v_event_ids;
end;
$$;

grant execute on function public.ensure_due_notification_events(uuid, integer, uuid, jsonb) to service_role;

create or replace function public.claim_notification_deliveries(p_limit integer default 100)
returns table(
  id uuid,
  event_id uuid,
  channel text,
  target_hash text,
  target_ciphertext text,
  status text,
  attempts integer,
  next_attempt_at timestamptz,
  idempotency_key text
)
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 0), 0);
begin
  return query
  with candidates as (
    select d.id as delivery_id
    from public.notification_deliveries d
    where d.status in ('queued', 'retry_scheduled')
      and (
        d.status = 'queued'
        or d.next_attempt_at is null
        or d.next_attempt_at <= timezone('utc', now())
      )
    order by d.updated_at, d.id
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.notification_deliveries d
    set status = 'sending',
        attempts = coalesce(d.attempts, 0) + 1,
        updated_at = timezone('utc', now())
    where d.id in (select delivery_id from candidates)
    returning
      d.id,
      d.event_id,
      d.channel,
      d.target_hash,
      d.target_ciphertext,
      d.status,
      d.attempts,
      d.next_attempt_at,
      d.idempotency_key
  )
  select * from claimed;
  
  return;
end;
$$;

grant execute on function public.claim_notification_deliveries(integer) to service_role;

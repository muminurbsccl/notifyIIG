-- Fix circuit identifier normalization regression.
--
-- Migration 003 redefined validate_circuit_state with an inline regexp
-- literal '\\s+' (two backslashes). With standard_conforming_strings = on
-- backslashes inside string literals are literal, so the regex pattern was
-- actually '\\s+' (literal backslash followed by 's+') which never matches
-- newlines or other whitespace. As a result any external circuit id
-- containing whitespace (e.g. a multi-line cell like "3-002204095\n3-002204127")
-- kept the whitespace in normalized_circuit_id, and the sync trigger then
-- failed the circuit_identifiers normalization check when inserting the
-- primary identifier, rejecting the whole import batch.
--
-- Use the single source of truth public.normalize_import_identifier (an
-- IMMUTABLE SQL function that correctly collapses \s+ to a single space),
-- matching what migration 002 already did.

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

  new.normalized_circuit_id := public.normalize_import_identifier(new.external_circuit_id);

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

-- Guard: the normalization must collapse embedded newlines/whitespace.
do $guard$
begin
  if public.normalize_import_identifier('A' || chr(10) || 'B') <> 'A B' then
    raise exception 'normalize_import_identifier must collapse embedded whitespace';
  end if;
end
$guard$;

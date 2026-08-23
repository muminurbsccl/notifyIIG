create or replace function public.protect_last_active_admin()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(91827364::bigint);
  if old.role = 'admin' and old.active and (
    tg_op = 'DELETE' or new.role is distinct from 'admin' or new.active is distinct from true
  ) and not exists (
    select 1 from public.profiles
    where id <> old.id and active and role = 'admin'
  ) then
    raise exception 'The last active administrator cannot be removed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists profiles_protect_last_admin on public.profiles;
create trigger profiles_protect_last_admin
before update or delete on public.profiles
for each row execute procedure public.protect_last_active_admin();

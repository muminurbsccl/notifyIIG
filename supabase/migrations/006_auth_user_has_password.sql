-- Email-first sign-in: lets the server decide between the password step and a
-- magic link without exposing which accounts have passwords (service_role only).
create or replace function public.auth_user_has_password(email text)
returns boolean
language sql
security definer
set search_path = auth, pg_temp
as $$
  select exists (
    select 1 from auth.users u
    where u.email = $1 and coalesce(u.encrypted_password, '') <> ''
  );
$$;

revoke all on function public.auth_user_has_password(text) from public, anon, authenticated;
grant execute on function public.auth_user_has_password(text) to service_role;

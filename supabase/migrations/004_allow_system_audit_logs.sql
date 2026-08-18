-- Allow system jobs (NULL actor) to append audit logs.
-- The cron notification job records notification.expiry.cron.run with a NULL
-- actor because there is no signed-in user. 001_initial.sql rejected NULL
-- actors entirely, which made every scheduled run fail with a 500.
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
  if p_actor_user_id is not null and not exists (
    select 1 from public.profiles where id = p_actor_user_id and active
  ) then
    raise exception 'Audit append requires an active actor';
  end if;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, request_id)
  values (p_actor_user_id, p_action, p_entity_type, p_entity_id, p_before_json, p_after_json, p_request_id);
end;
$$;

revoke all on function public.append_audit_log(uuid, text, text, uuid, jsonb, jsonb, text) from public;
revoke all on function public.append_audit_log(uuid, text, text, uuid, jsonb, jsonb, text) from authenticated;
grant execute on function public.append_audit_log(uuid, text, text, uuid, jsonb, jsonb, text) to service_role;

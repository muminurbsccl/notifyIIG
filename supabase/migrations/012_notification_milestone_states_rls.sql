-- notification_milestone_states was the only table in the schema never given
-- row level security. Supabase grants authenticated/anon direct table access
-- by default unless explicitly revoked (see the audit_logs revoke in
-- 001_initial.sql and the grant gap fixed in 010) -- without RLS here, any
-- signed-in user, including a viewer scoped to zero providers, could read
-- this table directly via the client SDK, or insert a fake 'satisfied' row
-- to suppress a real expiry notification for any circuit.
--
-- All writes to this table happen exclusively through the SECURITY DEFINER
-- function ensure_due_notification_events(), invoked by the service-role
-- cron job, so authenticated needs read-only access scoped like the other
-- circuit-derived tables and no write policy at all.
alter table public.notification_milestone_states enable row level security;

create policy milestone_states_select_scope on public.notification_milestone_states for select using (
  exists (
    select 1 from public.circuits c
    where c.id = notification_milestone_states.circuit_id and public.has_provider_access(c.provider_id)
  )
);

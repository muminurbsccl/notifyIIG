create policy audit_select_authorized on public.audit_logs
for select using (public.current_profile_role() in ('admin', 'operations_editor', 'auditor'));

-- 001_initial.sql revoked all table privileges on audit_logs from `authenticated`
-- (writes go through the append_audit_log() security-definer function only).
-- 008_audit_read_policy.sql then added a read RLS policy for admin/operations_editor/
-- auditor roles, but never restored SELECT, so Postgres denies the query before RLS
-- is even evaluated ("permission denied for table audit_logs", 42501). The RLS policy
-- itself still restricts which rows are visible, so this grant is safe.
grant select on public.audit_logs to authenticated;

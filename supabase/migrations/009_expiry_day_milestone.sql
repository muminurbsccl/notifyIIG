-- Expiry-day notification (009): fire once on the circuit's expiry date across
-- all enabled channels. days_before = 0 places the milestone due date exactly
-- on the expiry date; the scheduler's idempotent event upsert guarantees a
-- single event per circuit/expiry-version, and the engine's grace window lets a
-- missed cron run still deliver this notice shortly after expiry.
insert into public.notification_milestones (rule_id, milestone_key, label, days_before, enabled)
select id, 'T-0', 'Expiry-day notification', 0, true
from public.notification_rules
where code = 'global-default'
on conflict (rule_id, milestone_key) do update set enabled = true, label = excluded.label;

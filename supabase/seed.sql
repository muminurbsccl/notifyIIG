insert into public.providers (code, name, active, default_responsible_officer)
values
  ('NTT', 'NTT', false, 'Muntasim-Ul-Haque'),
  ('SGIX', 'SGIX', false, 'Md. Arifur Rahman'),
  ('HE', 'HE', false, 'Md. Arifur Rahman'),
  ('DE-CIX', 'DE-CIX', false, 'Md. Arifur Rahman'),
  ('PCCW', 'PCCW', false, 'Khondakar Hayat Mahmud'),
  ('COGENT', 'COGENT', false, 'Syed Hassan Shovo'),
  ('TIS', 'TIS', false, 'H.M. Reza Latif')
on conflict (code) do nothing;

insert into public.notification_rules (code, name, first_lead_months, active)
values ('global-default', 'BSCPLC default expiry reminders', 4, true)
on conflict (code) do nothing;

insert into public.notification_milestones (rule_id, milestone_key, label, months_before, enabled)
select id, 'T-4M', 'Initial four-month expiry reminder', 4, true
from public.notification_rules
where code = 'global-default'
on conflict (rule_id, milestone_key) do nothing;

insert into public.notification_milestones (rule_id, milestone_key, label, days_before, enabled)
select id, 'T-30D', 'Thirty-day expiry reminder', 30, true
from public.notification_rules
where code = 'global-default'
on conflict (rule_id, milestone_key) do nothing;

insert into public.notification_milestones (rule_id, milestone_key, label, days_before, enabled)
select id, 'T-0', 'Expiry-day notification', 0, true
from public.notification_rules
where code = 'global-default'
on conflict (rule_id, milestone_key) do nothing;

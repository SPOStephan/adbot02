-- Conversion-Ereignisse Teil 3: Roh-Aktionen je Kampagne (30 Tage) fürs Reporting.
--
-- Rein additiv: neue, nur lesende View. Gleiches 30-Tage-Fenster wie
-- meta_campaign_performance_30d (Anker = letzter Insights-Tag des Kontos).
-- Summiert performance_data.actions / action_values je action_type, damit das
-- Reporting Registrierungen, Abos usw. für das gewählte Optimierungsereignis
-- zählen kann. Sync, performance_data, bestehende Views (leads, purchases,
-- conversions) und alle Write-Pfade bleiben unverändert.

begin;

create or replace view public.meta_campaign_conversion_actions_30d
with (security_invoker = true)
as
with account_anchor as (
  select
    pd.user_id,
    pd.platform_account_id,
    max(pd.date) as window_end
  from public.performance_data pd
  where pd.platform = 'meta'
  group by pd.user_id, pd.platform_account_id
),
windowed as (
  select
    pd.user_id,
    pd.platform_account_id,
    pd.campaign_id,
    pd.actions,
    pd.action_values
  from public.performance_data pd
  join account_anchor anchor
    on anchor.user_id = pd.user_id
   and anchor.platform_account_id = pd.platform_account_id
  where pd.platform = 'meta'
    and pd.campaign_id is not null
    and pd.date between anchor.window_end - 29 and anchor.window_end
),
action_sums as (
  select
    w.user_id,
    w.platform_account_id,
    w.campaign_id,
    'count'::text as kind,
    entry.key,
    sum(entry.value::numeric) as total
  from windowed w
  cross join lateral jsonb_each_text(
    case when jsonb_typeof(w.actions) = 'object' then w.actions else '{}'::jsonb end
  ) entry
  where entry.value ~ '^-?[0-9]+(\.[0-9]+)?$'
  group by w.user_id, w.platform_account_id, w.campaign_id, entry.key
  union all
  select
    w.user_id,
    w.platform_account_id,
    w.campaign_id,
    'value'::text as kind,
    entry.key,
    sum(entry.value::numeric) as total
  from windowed w
  cross join lateral jsonb_each_text(
    case when jsonb_typeof(w.action_values) = 'object' then w.action_values else '{}'::jsonb end
  ) entry
  where entry.value ~ '^-?[0-9]+(\.[0-9]+)?$'
  group by w.user_id, w.platform_account_id, w.campaign_id, entry.key
)
select
  s.user_id,
  s.platform_account_id,
  s.campaign_id,
  coalesce(
    jsonb_object_agg(s.key, s.total) filter (where s.kind = 'count'),
    '{}'::jsonb
  ) as actions,
  coalesce(
    jsonb_object_agg(s.key, s.total) filter (where s.kind = 'value'),
    '{}'::jsonb
  ) as action_values
from action_sums s
group by s.user_id, s.platform_account_id, s.campaign_id;

revoke all privileges on table public.meta_campaign_conversion_actions_30d
  from public, anon, authenticated;
grant select on table public.meta_campaign_conversion_actions_30d to authenticated;
grant select on table public.meta_campaign_conversion_actions_30d to service_role;

commit;

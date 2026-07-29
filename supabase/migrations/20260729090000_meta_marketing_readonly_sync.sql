begin;

-- Meta Campaign Intelligence v1 is strictly read-only toward Meta. Browser roles
-- may select their own normalized rows, while all persistence stays service-role-only.

alter table public.platform_accounts
  add column if not exists marketing_meta_ad_account_id text,
  add column if not exists marketing_currency text,
  add column if not exists marketing_timezone_name text,
  add column if not exists marketing_timezone_offset_hours_utc numeric,
  add column if not exists marketing_account_status integer,
  add column if not exists marketing_sync_status text not null default 'idle',
  add column if not exists marketing_sync_error_code text,
  add column if not exists marketing_last_sync_started_at timestamptz,
  add column if not exists marketing_last_success_at timestamptz,
  add column if not exists marketing_next_sync_at timestamptz,
  add column if not exists marketing_backoff_until timestamptz,
  add column if not exists marketing_consecutive_failures integer not null default 0,
  add column if not exists marketing_campaign_count integer not null default 0,
  add column if not exists marketing_ad_set_count integer not null default 0,
  add column if not exists marketing_ad_count integer not null default 0,
  add column if not exists marketing_creative_count integer not null default 0,
  add column if not exists marketing_insight_count integer not null default 0,
  add column if not exists marketing_recommendation_count integer not null default 0,
  add column if not exists marketing_insights_since date,
  add column if not exists marketing_insights_until date,
  add column if not exists marketing_sync_id uuid,
  add column if not exists marketing_usage jsonb not null default '{}'::jsonb;

alter table public.platform_accounts
  add constraint platform_accounts_marketing_sync_status_check
    check (marketing_sync_status in ('idle', 'syncing', 'success', 'error')),
  add constraint platform_accounts_marketing_failures_check
    check (marketing_consecutive_failures >= 0),
  add constraint platform_accounts_marketing_counts_check
    check (
      marketing_campaign_count >= 0
      and marketing_ad_set_count >= 0
      and marketing_ad_count >= 0
      and marketing_creative_count >= 0
      and marketing_insight_count >= 0
      and marketing_recommendation_count >= 0
    ),
  add constraint platform_accounts_marketing_window_check
    check (
      marketing_insights_since is null
      or marketing_insights_until is null
      or marketing_insights_since <= marketing_insights_until
    );

alter table public.campaigns
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists effective_status text,
  add column if not exists daily_budget_minor bigint,
  add column if not exists lifetime_budget_minor bigint,
  add column if not exists budget_remaining_minor bigint,
  add column if not exists spend_cap_minor bigint,
  add column if not exists bid_strategy text,
  add column if not exists special_ad_categories jsonb not null default '[]'::jsonb,
  add column if not exists start_time timestamptz,
  add column if not exists stop_time timestamptz,
  add column if not exists platform_created_time timestamptz,
  add column if not exists platform_updated_time timestamptz,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists last_seen_sync_id uuid,
  add column if not exists is_current boolean not null default true;

update public.campaigns c
set user_id = pa.user_id
from public.platform_accounts pa
where c.platform_account_id = pa.id
  and c.user_id is null;

alter table public.campaigns
  alter column platform_account_id set not null,
  alter column user_id set not null,
  add constraint campaigns_budget_minor_check
    check (
      (daily_budget_minor is null or daily_budget_minor >= 0)
      and (lifetime_budget_minor is null or lifetime_budget_minor >= 0)
      and (budget_remaining_minor is null or budget_remaining_minor >= 0)
      and (spend_cap_minor is null or spend_cap_minor >= 0)
    ),
  add constraint campaigns_special_categories_array_check
    check (jsonb_typeof(special_ad_categories) = 'array');

create index if not exists campaigns_user_current_idx
  on public.campaigns (user_id, is_current, platform_updated_time desc);

alter table public.ad_groups
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists platform_account_id uuid
    references public.platform_accounts(id) on delete cascade,
  add column if not exists effective_status text,
  add column if not exists optimization_goal text,
  add column if not exists billing_event text,
  add column if not exists destination_type text,
  add column if not exists daily_budget_minor bigint,
  add column if not exists lifetime_budget_minor bigint,
  add column if not exists budget_remaining_minor bigint,
  add column if not exists bid_amount_minor bigint,
  add column if not exists bid_strategy text,
  add column if not exists start_time timestamptz,
  add column if not exists end_time timestamptz,
  add column if not exists platform_created_time timestamptz,
  add column if not exists platform_updated_time timestamptz,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists last_seen_sync_id uuid,
  add column if not exists is_current boolean not null default true;

update public.ad_groups ag
set
  user_id = c.user_id,
  platform_account_id = c.platform_account_id
from public.campaigns c
where ag.campaign_id = c.id
  and (ag.user_id is null or ag.platform_account_id is null);

alter table public.ad_groups
  alter column campaign_id set not null,
  alter column user_id set not null,
  alter column platform_account_id set not null,
  add constraint ad_groups_budget_minor_check
    check (
      (daily_budget_minor is null or daily_budget_minor >= 0)
      and (lifetime_budget_minor is null or lifetime_budget_minor >= 0)
      and (budget_remaining_minor is null or budget_remaining_minor >= 0)
      and (bid_amount_minor is null or bid_amount_minor >= 0)
    );

create unique index if not exists ad_groups_connector_external_key
  on public.ad_groups (platform_account_id, platform_ad_group_id);

create index if not exists ad_groups_user_current_idx
  on public.ad_groups (user_id, is_current, platform_updated_time desc);

alter table public.creatives
  add column if not exists platform_account_id uuid
    references public.platform_accounts(id) on delete cascade,
  add column if not exists platform_creative_id text,
  add column if not exists source text not null default 'local',
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists call_to_action_type text,
  add column if not exists thumbnail_url text,
  add column if not exists effective_object_story_id text,
  add column if not exists effective_instagram_media_id text,
  add column if not exists instagram_permalink_url text,
  add column if not exists object_type text,
  add column if not exists platform_status text,
  add column if not exists platform_created_time timestamptz,
  add column if not exists platform_updated_time timestamptz,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists last_seen_sync_id uuid,
  add column if not exists is_current boolean not null default true;

alter table public.creatives
  add constraint creatives_source_check
    check (source in ('local', 'meta')),
  add constraint creatives_meta_identity_check
    check (
      source <> 'meta'
      or (
        user_id is not null
        and platform_account_id is not null
        and platform_creative_id is not null
      )
    ),
  add constraint creatives_thumbnail_url_length_check
    check (thumbnail_url is null or char_length(thumbnail_url) <= 2048),
  add constraint creatives_instagram_permalink_length_check
    check (instagram_permalink_url is null or char_length(instagram_permalink_url) <= 2048);

create unique index if not exists creatives_meta_connector_external_key
  on public.creatives (platform_account_id, platform_creative_id)
  where source = 'meta';

create index if not exists creatives_meta_user_current_idx
  on public.creatives (user_id, is_current, platform_updated_time desc)
  where source = 'meta';

alter table public.ads
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists platform_account_id uuid
    references public.platform_accounts(id) on delete cascade,
  add column if not exists platform_creative_id text,
  add column if not exists effective_status text,
  add column if not exists platform_created_time timestamptz,
  add column if not exists platform_updated_time timestamptz,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists last_seen_sync_id uuid,
  add column if not exists is_current boolean not null default true;

update public.ads a
set
  user_id = ag.user_id,
  platform_account_id = ag.platform_account_id
from public.ad_groups ag
where a.ad_group_id = ag.id
  and (a.user_id is null or a.platform_account_id is null);

alter table public.ads
  alter column ad_group_id set not null,
  alter column user_id set not null,
  alter column platform_account_id set not null;

create unique index if not exists ads_connector_external_key
  on public.ads (platform_account_id, platform_ad_id);

create index if not exists ads_user_current_idx
  on public.ads (user_id, is_current, platform_updated_time desc);

alter table public.performance_data
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists platform_account_id uuid
    references public.platform_accounts(id) on delete cascade,
  add column if not exists campaign_id uuid references public.campaigns(id) on delete cascade,
  add column if not exists ad_group_id uuid references public.ad_groups(id) on delete cascade,
  add column if not exists ad_id uuid references public.ads(id) on delete cascade,
  add column if not exists date_stop date,
  add column if not exists reach bigint,
  add column if not exists frequency numeric,
  add column if not exists inline_link_clicks bigint,
  add column if not exists cpm numeric,
  add column if not exists cpc numeric,
  add column if not exists ctr numeric,
  add column if not exists actions jsonb,
  add column if not exists action_values jsonb,
  add column if not exists cost_per_action_type jsonb,
  add column if not exists leads bigint,
  add column if not exists purchases bigint,
  add column if not exists purchase_value numeric,
  add column if not exists currency text,
  add column if not exists attribution_setting text,
  add column if not exists last_seen_sync_id uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table public.performance_data
  alter column conversions drop default,
  add constraint performance_data_meta_identity_check
    check (
      platform <> 'meta'
      or (
        user_id is not null
        and platform_account_id is not null
        and campaign_id is not null
        and ad_group_id is not null
        and ad_id is not null
        and entity_type = 'ad'
        and entity_id = ad_id
      )
    ),
  add constraint performance_data_nonnegative_check
    check (
      coalesce(impressions, 0) >= 0
      and coalesce(clicks, 0) >= 0
      and coalesce(spend, 0) >= 0
      and (reach is null or reach >= 0)
      and (frequency is null or frequency >= 0)
      and (inline_link_clicks is null or inline_link_clicks >= 0)
      and (leads is null or leads >= 0)
      and (purchases is null or purchases >= 0)
      and (purchase_value is null or purchase_value >= 0)
    ),
  add constraint performance_data_json_maps_check
    check (
      (actions is null or jsonb_typeof(actions) = 'object')
      and (action_values is null or jsonb_typeof(action_values) = 'object')
      and (
        cost_per_action_type is null
        or jsonb_typeof(cost_per_action_type) = 'object'
      )
    );

create unique index if not exists performance_data_meta_connector_ad_date_key
  on public.performance_data (platform_account_id, ad_id, date, platform)
  where platform = 'meta';

create index if not exists performance_data_meta_user_date_idx
  on public.performance_data (user_id, date desc)
  where platform = 'meta';

create table if not exists public.campaign_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  ad_group_id uuid references public.ad_groups(id) on delete cascade,
  ad_id uuid references public.ads(id) on delete cascade,
  target_key text generated always as (
    coalesce(ad_id::text, ad_group_id::text, campaign_id::text)
  ) stored,
  rule_key text not null,
  rule_version integer not null default 1,
  severity text not null check (severity in ('info', 'warning', 'opportunity')),
  priority integer not null check (priority between 1 and 100),
  title text not null,
  summary text not null,
  evidence jsonb not null,
  evidence_hash text not null,
  window_start date not null,
  window_end date not null,
  status text not null default 'active'
    check (status in ('active', 'expired')),
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint campaign_recommendations_window_check
    check (window_start <= window_end),
  constraint campaign_recommendations_evidence_object_check
    check (jsonb_typeof(evidence) = 'object'),
  constraint campaign_recommendations_rule_version_check
    check (rule_version > 0),
  constraint campaign_recommendations_connector_rule_target_key
    unique (platform_account_id, rule_key, rule_version, target_key)
);

create index if not exists campaign_recommendations_user_active_idx
  on public.campaign_recommendations (user_id, status, priority desc, generated_at desc);

alter table public.campaigns enable row level security;
alter table public.ad_groups enable row level security;
alter table public.ads enable row level security;
alter table public.creatives enable row level security;
alter table public.performance_data enable row level security;
alter table public.campaign_recommendations enable row level security;

revoke all privileges on table public.campaigns from anon, authenticated;
revoke all privileges on table public.ad_groups from anon, authenticated;
revoke all privileges on table public.ads from anon, authenticated;
revoke all privileges on table public.creatives from anon, authenticated;
revoke all privileges on table public.performance_data from anon, authenticated;
revoke all privileges on table public.campaign_recommendations from anon, authenticated;

-- Browser clients receive only the fields required for the live read-only dashboard.
grant select (
  id, platform_account_id, user_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, lifetime_budget_minor,
  budget_remaining_minor, spend_cap_minor, bid_strategy,
  special_ad_categories, start_time, stop_time, platform_created_time,
  platform_updated_time, last_seen_at, is_current
) on public.campaigns to authenticated;

grant select (
  id, campaign_id, platform_account_id, user_id, platform_ad_group_id, name,
  status, effective_status, optimization_goal, billing_event, destination_type,
  daily_budget_minor, lifetime_budget_minor, budget_remaining_minor,
  bid_amount_minor, bid_strategy, start_time, end_time,
  platform_created_time, platform_updated_time, last_seen_at, is_current
) on public.ad_groups to authenticated;

grant select (
  id, ad_group_id, platform_account_id, user_id, platform_ad_id, name, status,
  effective_status, creative_id, platform_creative_id, platform_created_time,
  platform_updated_time, last_seen_at, is_current
) on public.ads to authenticated;

grant select (
  id, user_id, platform_account_id, platform_creative_id, source, name, type,
  title, body, call_to_action_type, thumbnail_url, effective_object_story_id,
  effective_instagram_media_id, instagram_permalink_url, object_type,
  platform_status, platform_created_time, platform_updated_time, last_seen_at,
  is_current
) on public.creatives to authenticated;

grant select (
  id, user_id, platform_account_id, campaign_id, ad_group_id, ad_id,
  entity_type, date, date_stop, impressions, reach, frequency, clicks,
  inline_link_clicks, conversions, spend, cpm, cpc, ctr, actions,
  action_values, cost_per_action_type, leads, purchases, purchase_value,
  currency, attribution_setting, platform, created_at, updated_at
) on public.performance_data to authenticated;

grant select (
  id, user_id, platform_account_id, campaign_id, ad_group_id, ad_id,
  rule_key, rule_version, severity, priority, title, summary, evidence,
  window_start, window_end, status, generated_at, expires_at, updated_at
) on public.campaign_recommendations to authenticated;

grant all privileges on table public.campaigns to service_role;
grant all privileges on table public.ad_groups to service_role;
grant all privileges on table public.ads to service_role;
grant all privileges on table public.creatives to service_role;
grant all privileges on table public.performance_data to service_role;
grant all privileges on table public.campaign_recommendations to service_role;

create or replace view public.meta_account_performance_daily
with (security_invoker = true)
as
select
  pd.user_id,
  pd.platform_account_id,
  pd.date,
  min(pd.currency) as currency,
  sum(pd.spend) as spend,
  sum(pd.impressions) as impressions,
  sum(pd.reach) as reach,
  sum(pd.clicks) as clicks,
  sum(pd.inline_link_clicks) as inline_link_clicks,
  sum(pd.leads) as leads,
  sum(pd.purchases) as purchases,
  sum(pd.purchase_value) as purchase_value
from public.performance_data pd
where pd.platform = 'meta'
group by pd.user_id, pd.platform_account_id, pd.date;

create or replace view public.meta_campaign_performance_30d
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
)
select
  pd.user_id,
  pd.platform_account_id,
  pd.campaign_id,
  c.platform_campaign_id,
  c.name as campaign_name,
  c.objective,
  c.status,
  c.effective_status,
  anchor.window_end - 29 as window_start,
  anchor.window_end,
  min(pd.currency) as currency,
  sum(pd.spend) as spend,
  sum(pd.impressions) as impressions,
  sum(pd.reach) as reach,
  sum(pd.clicks) as clicks,
  sum(pd.inline_link_clicks) as inline_link_clicks,
  sum(pd.leads) as leads,
  sum(pd.purchases) as purchases,
  sum(pd.purchase_value) as purchase_value,
  case
    when sum(pd.impressions) > 0
      then round(sum(pd.inline_link_clicks)::numeric * 100 / sum(pd.impressions), 4)
    else null
  end as link_ctr,
  case
    when sum(pd.inline_link_clicks) > 0
      then round(sum(pd.spend) / sum(pd.inline_link_clicks), 6)
    else null
  end as link_cpc,
  case
    when sum(pd.impressions) > 0
      then round(sum(pd.spend) * 1000 / sum(pd.impressions), 6)
    else null
  end as cpm
from public.performance_data pd
join account_anchor anchor
  on anchor.user_id = pd.user_id
 and anchor.platform_account_id = pd.platform_account_id
join public.campaigns c on c.id = pd.campaign_id
where pd.platform = 'meta'
  and pd.date between anchor.window_end - 29 and anchor.window_end
group by
  pd.user_id,
  pd.platform_account_id,
  pd.campaign_id,
  c.platform_campaign_id,
  c.name,
  c.objective,
  c.status,
  c.effective_status,
  anchor.window_end;

revoke all privileges on table public.meta_account_performance_daily
  from public, anon, authenticated;
revoke all privileges on table public.meta_campaign_performance_30d
  from public, anon, authenticated;
grant select on table public.meta_account_performance_daily to authenticated;
grant select on table public.meta_campaign_performance_30d to authenticated;
grant select on table public.meta_account_performance_daily to service_role;
grant select on table public.meta_campaign_performance_30d to service_role;

drop policy if exists campaigns_select_own on public.campaigns;
create policy campaigns_select_own
on public.campaigns
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists ad_groups_select_own on public.ad_groups;
create policy ad_groups_select_own
on public.ad_groups
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists ads_select_own on public.ads;
create policy ads_select_own
on public.ads
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Nutzer verwalten eigene Creatives." on public.creatives;
drop policy if exists creatives_select_own on public.creatives;
create policy creatives_select_own
on public.creatives
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists performance_data_select_own on public.performance_data;
create policy performance_data_select_own
on public.performance_data
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists campaign_recommendations_select_own
  on public.campaign_recommendations;
create policy campaign_recommendations_select_own
on public.campaign_recommendations
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Safe connector metadata only. Tokens, locks, detailed usage and backoff stay server-only.
grant select (
  marketing_meta_ad_account_id,
  marketing_currency,
  marketing_timezone_name,
  marketing_account_status,
  marketing_sync_status,
  marketing_sync_error_code,
  marketing_last_sync_started_at,
  marketing_last_success_at,
  marketing_next_sync_at,
  marketing_campaign_count,
  marketing_ad_set_count,
  marketing_ad_count,
  marketing_creative_count,
  marketing_insight_count,
  marketing_recommendation_count,
  marketing_insights_since,
  marketing_insights_until
) on public.platform_accounts to authenticated;

create or replace function public.rebuild_meta_campaign_recommendations(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_window_end date,
  p_currency text,
  p_generated_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_window_end is null
    or not exists (
      select 1
      from public.platform_accounts pa
      where pa.id = p_platform_account_id
        and pa.user_id = p_user_id
        and pa.platform = 'meta'
        and pa.revoked_at is null
    ) then
    raise exception 'Invalid Meta recommendation scope';
  end if;

  update public.campaign_recommendations
  set status = 'expired', updated_at = p_generated_at
  where platform_account_id = p_platform_account_id
    and status = 'active';

  -- Rule 1: active campaigns without delivery for three complete days.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    'active_without_delivery_3d',
    1,
    'warning',
    90,
    'Auslieferung der aktiven Kampagne prüfen',
    'Für diese aktive Kampagne wurden an drei vollständigen Tagen weder Impressionen noch Ausgaben erfasst. Prüfe Freigaben, Zeitplan und Auslieferungsstatus in Meta.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 2,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    select
      c.user_id,
      c.platform_account_id,
      c.id as campaign_id,
      jsonb_build_object(
        'rule', 'active_without_delivery_3d',
        'campaign_name', c.name,
        'effective_status', coalesce(c.effective_status, c.status),
        'days_without_delivery', 3,
        'minimum_campaign_age_days', 2,
        'window_start', p_window_end - 2,
        'window_end', p_window_end
      ) as evidence
    from public.campaigns c
    where c.platform_account_id = p_platform_account_id
      and c.user_id = p_user_id
      and c.is_current
      and coalesce(c.effective_status, c.status) = 'ACTIVE'
      and (c.start_time is null or c.start_time::date <= p_window_end - 2)
      and not exists (
        select 1
        from public.performance_data pd
        where pd.platform_account_id = c.platform_account_id
          and pd.campaign_id = c.id
          and pd.platform = 'meta'
          and pd.date between p_window_end - 2 and p_window_end
          and (coalesce(pd.impressions, 0) > 0 or coalesce(pd.spend, 0) > 0)
      )
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  -- Rule 2: cost per tracked result increased by at least 30% week over week.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    'cost_per_result_up_30pct',
    1,
    'warning',
    80,
    'Kosten pro Ergebnis sind deutlich gestiegen',
    'Die Kosten pro erfasstem Ergebnis liegen mindestens 30 % über der Vorwoche. Prüfe Creative, Zielgruppe und Auslieferungsumfeld, bevor Budget verändert wird.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 13,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    select
      weekly.user_id,
      weekly.platform_account_id,
      weekly.campaign_id,
      jsonb_build_object(
        'rule', 'cost_per_result_up_30pct',
        'campaign_name', weekly.campaign_name,
        'result_type', weekly.result_type,
        'current_cost_per_result', round(weekly.current_spend / weekly.current_results, 4),
        'previous_cost_per_result', round(weekly.previous_spend / weekly.previous_results, 4),
        'increase_percent', round(
          ((weekly.current_spend / weekly.current_results)
            / (weekly.previous_spend / weekly.previous_results) - 1) * 100,
          2
        ),
        'current_results', weekly.current_results,
        'previous_results', weekly.previous_results,
        'currency', p_currency,
        'threshold_percent', 30,
        'window_start', p_window_end - 13,
        'window_end', p_window_end
      ) as evidence
    from (
      select
        c.user_id,
        c.platform_account_id,
        c.id as campaign_id,
        c.name as campaign_name,
        case when c.objective = 'OUTCOME_SALES' then 'purchases' else 'leads' end as result_type,
        coalesce(sum(pd.spend) filter (
          where pd.date between p_window_end - 6 and p_window_end
        ), 0) as current_spend,
        coalesce(sum(pd.spend) filter (
          where pd.date between p_window_end - 13 and p_window_end - 7
        ), 0) as previous_spend,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) filter (
          where pd.date between p_window_end - 6 and p_window_end
        ), 0)::numeric as current_results,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) filter (
          where pd.date between p_window_end - 13 and p_window_end - 7
        ), 0)::numeric as previous_results
      from public.campaigns c
      join public.performance_data pd
        on pd.platform_account_id = c.platform_account_id
       and pd.campaign_id = c.id
       and pd.platform = 'meta'
       and pd.date between p_window_end - 13 and p_window_end
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and c.objective in ('OUTCOME_LEADS', 'OUTCOME_SALES')
      group by c.user_id, c.platform_account_id, c.id, c.name, c.objective
    ) weekly
    where weekly.current_results >= 3
      and weekly.previous_results >= 3
      and weekly.current_spend > 0
      and weekly.previous_spend > 0
      and (weekly.current_spend / weekly.current_results)
        >= (weekly.previous_spend / weekly.previous_results) * 1.3
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  -- Rule 3: meaningful 14-day spend with observed result tracking but no results.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    'spend_without_results_14d',
    1,
    'warning',
    75,
    'Ausgaben ohne erfasstes Ergebnis',
    'In 14 vollständigen Tagen wurden Ausgaben und Auslieferung erfasst, aber kein passendes Ergebnis. Prüfe Tracking, Zielseite und Kampagnenaufbau vor einer Budgetentscheidung.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 13,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    select
      summary.user_id,
      summary.platform_account_id,
      summary.campaign_id,
      jsonb_build_object(
        'rule', 'spend_without_results_14d',
        'campaign_name', summary.campaign_name,
        'result_type', summary.result_type,
        'spend', round(summary.spend, 2),
        'impressions', summary.impressions,
        'results', summary.results,
        'currency', p_currency,
        'minimum_spend', 50,
        'minimum_impressions', 1000,
        'window_start', p_window_end - 13,
        'window_end', p_window_end
      ) as evidence
    from (
      select
        c.user_id,
        c.platform_account_id,
        c.id as campaign_id,
        c.name as campaign_name,
        case when c.objective = 'OUTCOME_SALES' then 'purchases' else 'leads' end as result_type,
        coalesce(sum(pd.spend), 0) as spend,
        coalesce(sum(pd.impressions), 0) as impressions,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ), 0)::numeric as results,
        count(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) as observed_result_rows
      from public.campaigns c
      join public.performance_data pd
        on pd.platform_account_id = c.platform_account_id
       and pd.campaign_id = c.id
       and pd.platform = 'meta'
       and pd.date between p_window_end - 13 and p_window_end
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and c.objective in ('OUTCOME_LEADS', 'OUTCOME_SALES')
      group by c.user_id, c.platform_account_id, c.id, c.name, c.objective
    ) summary
    where summary.observed_result_rows > 0
      and summary.spend >= 50
      and summary.impressions >= 1000
      and summary.results = 0
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  -- Rule 4: low link CTR with sufficient delivery on performance objectives.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    'low_link_ctr_7d',
    1,
    'opportunity',
    65,
    'Link-Klickrate liegt unter dem Prüfwert',
    'Die Link-Klickrate liegt bei ausreichender Auslieferung unter 0,50 %. Prüfe Botschaft, Creative und Zielgruppenpassung; die Empfehlung nimmt keine Änderung vor.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 6,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    select
      ctr.user_id,
      ctr.platform_account_id,
      ctr.campaign_id,
      jsonb_build_object(
        'rule', 'low_link_ctr_7d',
        'campaign_name', ctr.campaign_name,
        'impressions', ctr.impressions,
        'inline_link_clicks', ctr.inline_link_clicks,
        'link_ctr_percent', round(ctr.inline_link_clicks * 100 / ctr.impressions, 4),
        'threshold_percent', 0.5,
        'minimum_impressions', 1000,
        'window_start', p_window_end - 6,
        'window_end', p_window_end
      ) as evidence
    from (
      select
        c.user_id,
        c.platform_account_id,
        c.id as campaign_id,
        c.name as campaign_name,
        coalesce(sum(pd.impressions), 0)::numeric as impressions,
        coalesce(sum(pd.inline_link_clicks), 0)::numeric as inline_link_clicks,
        count(pd.inline_link_clicks) as observed_link_click_rows
      from public.campaigns c
      join public.performance_data pd
        on pd.platform_account_id = c.platform_account_id
       and pd.campaign_id = c.id
       and pd.platform = 'meta'
       and pd.date between p_window_end - 6 and p_window_end
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and c.objective in ('OUTCOME_TRAFFIC', 'OUTCOME_LEADS', 'OUTCOME_SALES')
      group by c.user_id, c.platform_account_id, c.id, c.name
    ) ctr
    where ctr.observed_link_click_rows > 0
      and ctr.impressions >= 1000
      and ctr.inline_link_clicks * 100 / ctr.impressions < 0.5
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  select count(*)::integer into v_count
  from public.campaign_recommendations
  where platform_account_id = p_platform_account_id
    and user_id = p_user_id
    and status = 'active'
    and expires_at > p_generated_at;

  return v_count;
end;
$$;

revoke all on function public.rebuild_meta_campaign_recommendations(
  uuid, uuid, date, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.rebuild_meta_campaign_recommendations(
  uuid, uuid, date, text, timestamptz
) to service_role;

create or replace function public.replace_meta_marketing_snapshot(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_sync_id uuid,
  p_account jsonb,
  p_campaigns jsonb,
  p_ad_sets jsonb,
  p_ads jsonb,
  p_creatives jsonb,
  p_insights jsonb,
  p_insights_since date,
  p_insights_until date,
  p_usage jsonb
)
returns table (
  campaigns_count integer,
  ad_sets_count integer,
  ads_count integer,
  creatives_count integer,
  insights_count integer,
  recommendations_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ad_account_id text;
  v_campaigns_count integer;
  v_ad_sets_count integer;
  v_ads_count integer;
  v_creatives_count integer;
  v_insights_count integer;
  v_recommendations_count integer;
begin
  if jsonb_typeof(p_account) is distinct from 'object'
    or jsonb_typeof(p_campaigns) is distinct from 'array'
    or jsonb_typeof(p_ad_sets) is distinct from 'array'
    or jsonb_typeof(p_ads) is distinct from 'array'
    or jsonb_typeof(p_creatives) is distinct from 'array'
    or jsonb_typeof(p_insights) is distinct from 'array'
    or jsonb_typeof(p_usage) is distinct from 'object' then
    raise exception 'Invalid Meta Marketing JSON payload';
  end if;

  if p_insights_since is null
    or p_insights_until is null
    or p_insights_since > p_insights_until
    or (p_insights_until - p_insights_since) > 62 then
    raise exception 'Invalid Meta Insights window';
  end if;

  if jsonb_array_length(p_campaigns) > 100000
    or jsonb_array_length(p_ad_sets) > 100000
    or jsonb_array_length(p_ads) > 100000
    or jsonb_array_length(p_creatives) > 100000
    or jsonb_array_length(p_insights) > 100000 then
    raise exception 'Meta Marketing payload exceeds object limit';
  end if;

  v_ad_account_id := regexp_replace(
    coalesce(p_account->>'meta_ad_account_id', ''),
    '^act_',
    ''
  );

  if v_ad_account_id !~ '^[0-9]+$' then
    raise exception 'Invalid Meta ad account ID';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) or not exists (
    select 1
    from public.meta_assets ma
    where ma.platform_account_id = p_platform_account_id
      and ma.user_id = p_user_id
      and ma.asset_type = 'ad_account'
      and regexp_replace(ma.meta_asset_id, '^act_', '') = v_ad_account_id
  ) then
    raise exception 'Meta ad account does not belong to connector';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_campaigns) item
    where nullif(item->>'account_id', '') is not null
      and regexp_replace(item->>'account_id', '^act_', '') <> v_ad_account_id
  ) or exists (
    select 1
    from jsonb_array_elements(p_ad_sets) item
    where nullif(item->>'account_id', '') is not null
      and regexp_replace(item->>'account_id', '^act_', '') <> v_ad_account_id
  ) or exists (
    select 1
    from jsonb_array_elements(p_ads) item
    where nullif(item->>'account_id', '') is not null
      and regexp_replace(item->>'account_id', '^act_', '') <> v_ad_account_id
  ) or exists (
    select 1
    from jsonb_array_elements(p_creatives) item
    where nullif(item->>'account_id', '') is not null
      and regexp_replace(item->>'account_id', '^act_', '') <> v_ad_account_id
  ) or exists (
    select 1
    from jsonb_array_elements(p_insights) item
    where nullif(item->>'account_id', '') is not null
      and regexp_replace(item->>'account_id', '^act_', '') <> v_ad_account_id
  ) then
    raise exception 'Cross-account Meta Marketing payload rejected';
  end if;

  if exists (
    select 1
    from (
      select item->>'platform_campaign_id' as id, count(*)
      from jsonb_array_elements(p_campaigns) item
      group by item->>'platform_campaign_id'
      having count(*) > 1
    ) duplicates
  ) or exists (
    select 1
    from (
      select item->>'platform_ad_set_id' as id, count(*)
      from jsonb_array_elements(p_ad_sets) item
      group by item->>'platform_ad_set_id'
      having count(*) > 1
    ) duplicates
  ) or exists (
    select 1
    from (
      select item->>'platform_ad_id' as id, count(*)
      from jsonb_array_elements(p_ads) item
      group by item->>'platform_ad_id'
      having count(*) > 1
    ) duplicates
  ) or exists (
    select 1
    from (
      select item->>'platform_creative_id' as id, count(*)
      from jsonb_array_elements(p_creatives) item
      group by item->>'platform_creative_id'
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'Duplicate Meta Marketing object ID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ad_sets) ad_set
    where not exists (
      select 1
      from jsonb_array_elements(p_campaigns) campaign
      where campaign->>'platform_campaign_id' = ad_set->>'platform_campaign_id'
    )
  ) or exists (
    select 1
    from jsonb_array_elements(p_ads) ad
    where not exists (
      select 1
      from jsonb_array_elements(p_campaigns) campaign
      where campaign->>'platform_campaign_id' = ad->>'platform_campaign_id'
    ) or not exists (
      select 1
      from jsonb_array_elements(p_ad_sets) ad_set
      where ad_set->>'platform_ad_set_id' = ad->>'platform_ad_set_id'
    )
  ) or exists (
    select 1
    from jsonb_array_elements(p_insights) insight
    where not exists (
      select 1
      from jsonb_array_elements(p_ads) ad
      where ad->>'platform_ad_id' = insight->>'platform_ad_id'
    )
      or (insight->>'date_start')::date <> (insight->>'date_stop')::date
      or (insight->>'date_start')::date < p_insights_since
      or (insight->>'date_start')::date > p_insights_until
  ) then
    raise exception 'Invalid Meta Marketing hierarchy or insight date';
  end if;

  update public.campaigns
  set is_current = false, updated_at = now()
  where platform_account_id = p_platform_account_id;

  insert into public.campaigns (
    platform_account_id, user_id, platform_campaign_id, name, status,
    effective_status, objective, daily_budget_minor, lifetime_budget_minor,
    budget_remaining_minor, spend_cap_minor, bid_strategy,
    special_ad_categories, start_time, stop_time, platform_created_time,
    platform_updated_time, last_seen_at, last_seen_sync_id, is_current,
    updated_at
  )
  select
    p_platform_account_id, p_user_id, item.platform_campaign_id,
    item.name, item.status, item.effective_status, item.objective,
    item.daily_budget_minor, item.lifetime_budget_minor,
    item.budget_remaining_minor, item.spend_cap_minor, item.bid_strategy,
    coalesce(item.special_ad_categories, '[]'::jsonb), item.start_time,
    item.stop_time, item.platform_created_time, item.platform_updated_time,
    now(), p_sync_id, true, now()
  from jsonb_to_recordset(p_campaigns) as item(
    platform_campaign_id text, account_id text, name text, objective text,
    status text, effective_status text, daily_budget_minor bigint,
    lifetime_budget_minor bigint, budget_remaining_minor bigint,
    spend_cap_minor bigint, bid_strategy text, special_ad_categories jsonb,
    start_time timestamptz, stop_time timestamptz,
    platform_created_time timestamptz, platform_updated_time timestamptz
  )
  on conflict (platform_account_id, platform_campaign_id)
  do update set
    user_id = excluded.user_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    objective = excluded.objective,
    daily_budget_minor = excluded.daily_budget_minor,
    lifetime_budget_minor = excluded.lifetime_budget_minor,
    budget_remaining_minor = excluded.budget_remaining_minor,
    spend_cap_minor = excluded.spend_cap_minor,
    bid_strategy = excluded.bid_strategy,
    special_ad_categories = excluded.special_ad_categories,
    start_time = excluded.start_time,
    stop_time = excluded.stop_time,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true,
    updated_at = now();

  update public.ad_groups
  set is_current = false, updated_at = now()
  where platform_account_id = p_platform_account_id;

  insert into public.ad_groups (
    campaign_id, platform_account_id, user_id, platform_ad_group_id, name,
    status, effective_status, optimization_goal, billing_event,
    destination_type, daily_budget_minor, lifetime_budget_minor,
    budget_remaining_minor, bid_amount_minor, bid_strategy, start_time,
    end_time, platform_created_time, platform_updated_time, last_seen_at,
    last_seen_sync_id, is_current, updated_at
  )
  select
    c.id, p_platform_account_id, p_user_id, item.platform_ad_set_id,
    item.name, item.status, item.effective_status, item.optimization_goal,
    item.billing_event, item.destination_type, item.daily_budget_minor,
    item.lifetime_budget_minor, item.budget_remaining_minor,
    item.bid_amount_minor, item.bid_strategy, item.start_time, item.end_time,
    item.platform_created_time, item.platform_updated_time, now(), p_sync_id,
    true, now()
  from jsonb_to_recordset(p_ad_sets) as item(
    platform_ad_set_id text, platform_campaign_id text, account_id text,
    name text, status text, effective_status text, optimization_goal text,
    billing_event text, destination_type text, daily_budget_minor bigint,
    lifetime_budget_minor bigint, budget_remaining_minor bigint,
    bid_amount_minor bigint, bid_strategy text, start_time timestamptz,
    end_time timestamptz, platform_created_time timestamptz,
    platform_updated_time timestamptz
  )
  join public.campaigns c
    on c.platform_account_id = p_platform_account_id
   and c.platform_campaign_id = item.platform_campaign_id
  on conflict (platform_account_id, platform_ad_group_id)
  do update set
    campaign_id = excluded.campaign_id,
    user_id = excluded.user_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    optimization_goal = excluded.optimization_goal,
    billing_event = excluded.billing_event,
    destination_type = excluded.destination_type,
    daily_budget_minor = excluded.daily_budget_minor,
    lifetime_budget_minor = excluded.lifetime_budget_minor,
    budget_remaining_minor = excluded.budget_remaining_minor,
    bid_amount_minor = excluded.bid_amount_minor,
    bid_strategy = excluded.bid_strategy,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true,
    updated_at = now();

  update public.creatives
  set is_current = false, updated_at = now()
  where platform_account_id = p_platform_account_id
    and source = 'meta';

  insert into public.creatives (
    user_id, platform_account_id, platform_creative_id, source, name, type,
    content, generated_by_ai, title, body, call_to_action_type,
    thumbnail_url, effective_object_story_id, effective_instagram_media_id,
    instagram_permalink_url, object_type, platform_status, last_seen_at,
    last_seen_sync_id, is_current, updated_at
  )
  select
    p_user_id, p_platform_account_id, item.platform_creative_id, 'meta',
    coalesce(nullif(item.name, ''), 'Meta Creative ' || item.platform_creative_id),
    coalesce(nullif(item.object_type, ''), 'meta'),
    jsonb_strip_nulls(jsonb_build_object(
      'title', item.title,
      'body', item.body,
      'call_to_action_type', item.call_to_action_type
    )),
    false, item.title, item.body, item.call_to_action_type,
    item.thumbnail_url, item.effective_object_story_id,
    item.effective_instagram_media_id, item.instagram_permalink_url,
    item.object_type, item.status, now(), p_sync_id, true, now()
  from jsonb_to_recordset(p_creatives) as item(
    platform_creative_id text, account_id text, name text, title text,
    body text, call_to_action_type text, thumbnail_url text,
    effective_object_story_id text, effective_instagram_media_id text,
    instagram_permalink_url text, object_type text, status text
  )
  on conflict (platform_account_id, platform_creative_id)
    where source = 'meta'
  do update set
    user_id = excluded.user_id,
    name = excluded.name,
    type = excluded.type,
    content = excluded.content,
    generated_by_ai = false,
    title = excluded.title,
    body = excluded.body,
    call_to_action_type = excluded.call_to_action_type,
    thumbnail_url = excluded.thumbnail_url,
    effective_object_story_id = excluded.effective_object_story_id,
    effective_instagram_media_id = excluded.effective_instagram_media_id,
    instagram_permalink_url = excluded.instagram_permalink_url,
    object_type = excluded.object_type,
    platform_status = excluded.platform_status,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true,
    updated_at = now();

  update public.ads
  set is_current = false, updated_at = now()
  where platform_account_id = p_platform_account_id;

  insert into public.ads (
    ad_group_id, platform_account_id, user_id, platform_ad_id, name, status,
    effective_status, creative_id, platform_creative_id,
    platform_created_time, platform_updated_time, last_seen_at,
    last_seen_sync_id, is_current, updated_at
  )
  select
    ag.id, p_platform_account_id, p_user_id, item.platform_ad_id,
    item.name, item.status, item.effective_status, cr.id,
    item.platform_creative_id, item.platform_created_time,
    item.platform_updated_time, now(), p_sync_id, true, now()
  from jsonb_to_recordset(p_ads) as item(
    platform_ad_id text, platform_campaign_id text, platform_ad_set_id text,
    platform_creative_id text, account_id text, name text, status text,
    effective_status text, platform_created_time timestamptz,
    platform_updated_time timestamptz
  )
  join public.ad_groups ag
    on ag.platform_account_id = p_platform_account_id
   and ag.platform_ad_group_id = item.platform_ad_set_id
  left join public.creatives cr
    on cr.platform_account_id = p_platform_account_id
   and cr.platform_creative_id = item.platform_creative_id
   and cr.source = 'meta'
  on conflict (platform_account_id, platform_ad_id)
  do update set
    ad_group_id = excluded.ad_group_id,
    user_id = excluded.user_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    creative_id = excluded.creative_id,
    platform_creative_id = excluded.platform_creative_id,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true,
    updated_at = now();

  delete from public.performance_data
  where platform_account_id = p_platform_account_id
    and platform = 'meta'
    and date between p_insights_since and p_insights_until;

  insert into public.performance_data (
    entity_id, entity_type, date, date_stop, impressions, reach, frequency,
    clicks, inline_link_clicks, conversions, spend, cpm, cpc, ctr, platform,
    user_id, platform_account_id, campaign_id, ad_group_id, ad_id, actions,
    action_values, cost_per_action_type, leads, purchases, purchase_value,
    currency, attribution_setting, last_seen_sync_id, updated_at
  )
  select
    a.id, 'ad', item.date_start, item.date_stop, item.impressions,
    item.reach, item.frequency, item.clicks, item.inline_link_clicks,
    coalesce(metrics.purchases, metrics.leads), item.spend, item.cpm,
    item.cpc, item.ctr, 'meta', p_user_id, p_platform_account_id,
    c.id, ag.id, a.id, item.actions, item.action_values,
    item.cost_per_action_type, metrics.leads, metrics.purchases,
    metrics.purchase_value, nullif(p_account->>'currency', ''),
    item.attribution_setting, p_sync_id, now()
  from jsonb_to_recordset(p_insights) as item(
    platform_campaign_id text, campaign_name text, platform_ad_set_id text,
    ad_set_name text, platform_ad_id text, ad_name text, account_id text,
    date_start date, date_stop date, impressions bigint, reach bigint,
    frequency numeric, clicks bigint, inline_link_clicks bigint,
    spend numeric, cpm numeric, cpc numeric, ctr numeric, actions jsonb,
    action_values jsonb, cost_per_action_type jsonb,
    attribution_setting text
  )
  join public.ads a
    on a.platform_account_id = p_platform_account_id
   and a.platform_ad_id = item.platform_ad_id
  join public.ad_groups ag on ag.id = a.ad_group_id
  join public.campaigns c on c.id = ag.campaign_id
  cross join lateral (
    select
      case when item.actions is null then null else coalesce((
        select round(sum(value::numeric))::bigint
        from jsonb_each_text(item.actions)
        where key = any(array[
          'lead', 'omni_lead', 'onsite_conversion.lead_grouped',
          'offsite_conversion.fb_pixel_lead'
        ])
      ), 0) end as leads,
      case when item.actions is null then null else coalesce((
        select round(sum(value::numeric))::bigint
        from jsonb_each_text(item.actions)
        where key = any(array[
          'purchase', 'omni_purchase',
          'offsite_conversion.fb_pixel_purchase'
        ])
      ), 0) end as purchases,
      case when item.action_values is null then null else coalesce((
        select sum(value::numeric)
        from jsonb_each_text(item.action_values)
        where key = any(array[
          'purchase', 'omni_purchase',
          'offsite_conversion.fb_pixel_purchase'
        ])
      ), 0) end as purchase_value
  ) metrics
  on conflict (entity_id, date)
  do update set
    date_stop = excluded.date_stop,
    impressions = excluded.impressions,
    reach = excluded.reach,
    frequency = excluded.frequency,
    clicks = excluded.clicks,
    inline_link_clicks = excluded.inline_link_clicks,
    conversions = excluded.conversions,
    spend = excluded.spend,
    cpm = excluded.cpm,
    cpc = excluded.cpc,
    ctr = excluded.ctr,
    platform = excluded.platform,
    user_id = excluded.user_id,
    platform_account_id = excluded.platform_account_id,
    campaign_id = excluded.campaign_id,
    ad_group_id = excluded.ad_group_id,
    ad_id = excluded.ad_id,
    actions = excluded.actions,
    action_values = excluded.action_values,
    cost_per_action_type = excluded.cost_per_action_type,
    leads = excluded.leads,
    purchases = excluded.purchases,
    purchase_value = excluded.purchase_value,
    currency = excluded.currency,
    attribution_setting = excluded.attribution_setting,
    last_seen_sync_id = excluded.last_seen_sync_id,
    updated_at = now();

  v_recommendations_count := public.rebuild_meta_campaign_recommendations(
    p_platform_account_id,
    p_user_id,
    p_insights_until,
    nullif(p_account->>'currency', ''),
    now()
  );

  select count(*)::integer into v_campaigns_count
  from public.campaigns
  where platform_account_id = p_platform_account_id and is_current;

  select count(*)::integer into v_ad_sets_count
  from public.ad_groups
  where platform_account_id = p_platform_account_id and is_current;

  select count(*)::integer into v_ads_count
  from public.ads
  where platform_account_id = p_platform_account_id and is_current;

  select count(*)::integer into v_creatives_count
  from public.creatives
  where platform_account_id = p_platform_account_id
    and source = 'meta' and is_current;

  select count(*)::integer into v_insights_count
  from public.performance_data
  where platform_account_id = p_platform_account_id
    and platform = 'meta'
    and date between p_insights_since and p_insights_until;

  update public.platform_accounts
  set
    marketing_meta_ad_account_id = v_ad_account_id,
    marketing_currency = nullif(p_account->>'currency', ''),
    marketing_timezone_name = nullif(p_account->>'timezone_name', ''),
    marketing_timezone_offset_hours_utc =
      nullif(p_account->>'timezone_offset_hours_utc', '')::numeric,
    marketing_account_status = nullif(p_account->>'account_status', '')::integer,
    marketing_sync_status = 'success',
    marketing_sync_error_code = null,
    marketing_last_success_at = now(),
    marketing_backoff_until = null,
    marketing_consecutive_failures = 0,
    marketing_campaign_count = v_campaigns_count,
    marketing_ad_set_count = v_ad_sets_count,
    marketing_ad_count = v_ads_count,
    marketing_creative_count = v_creatives_count,
    marketing_insight_count = v_insights_count,
    marketing_recommendation_count = v_recommendations_count,
    marketing_insights_since = p_insights_since,
    marketing_insights_until = p_insights_until,
    marketing_sync_id = p_sync_id,
    marketing_usage = p_usage,
    updated_at = now()
  where id = p_platform_account_id and user_id = p_user_id;

  return query select
    v_campaigns_count,
    v_ad_sets_count,
    v_ads_count,
    v_creatives_count,
    v_insights_count,
    v_recommendations_count;
end;
$$;

revoke all on function public.replace_meta_marketing_snapshot(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
  date, date, jsonb
) from public, anon, authenticated;

grant execute on function public.replace_meta_marketing_snapshot(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
  date, date, jsonb
) to service_role;

create or replace function public.invalidate_meta_marketing_on_asset_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.platform = 'meta'
    and old.ad_account_ids is distinct from new.ad_account_ids then
    update public.campaigns
    set is_current = false, updated_at = now()
    where platform_account_id = new.id;

    update public.ad_groups
    set is_current = false, updated_at = now()
    where platform_account_id = new.id;

    update public.ads
    set is_current = false, updated_at = now()
    where platform_account_id = new.id;

    update public.creatives
    set is_current = false, updated_at = now()
    where platform_account_id = new.id and source = 'meta';

    update public.campaign_recommendations
    set status = 'expired', updated_at = now()
    where platform_account_id = new.id and status = 'active';

    update public.platform_accounts
    set
      marketing_meta_ad_account_id = null,
      marketing_currency = null,
      marketing_timezone_name = null,
      marketing_timezone_offset_hours_utc = null,
      marketing_account_status = null,
      marketing_sync_status = 'idle',
      marketing_sync_error_code = null,
      marketing_last_sync_started_at = null,
      marketing_last_success_at = null,
      marketing_next_sync_at = now(),
      marketing_backoff_until = null,
      marketing_consecutive_failures = 0,
      marketing_campaign_count = 0,
      marketing_ad_set_count = 0,
      marketing_ad_count = 0,
      marketing_creative_count = 0,
      marketing_insight_count = 0,
      marketing_recommendation_count = 0,
      marketing_insights_since = null,
      marketing_insights_until = null,
      marketing_sync_id = null,
      marketing_usage = '{}'::jsonb,
      updated_at = now()
    where id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.invalidate_meta_marketing_on_asset_change()
  from public, anon, authenticated;

drop trigger if exists invalidate_meta_marketing_after_asset_change
  on public.platform_accounts;
create trigger invalidate_meta_marketing_after_asset_change
  after update of ad_account_ids on public.platform_accounts
  for each row
  when (old.ad_account_ids is distinct from new.ad_account_ids)
  execute function public.invalidate_meta_marketing_on_asset_change();

comment on function public.replace_meta_marketing_snapshot is
  'Service-role-only atomic replacement of a fully fetched read-only Meta Marketing snapshot and daily insight window.';
comment on table public.campaign_recommendations is
  'Deterministic read-only diagnostic recommendations. No row can execute or request a Meta mutation.';
comment on column public.platform_accounts.marketing_usage is
  'Server-only aggregate Meta Marketing rate-limit snapshot; contains no tokens or ad payloads.';

commit;

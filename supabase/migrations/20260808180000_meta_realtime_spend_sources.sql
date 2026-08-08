-- Reliable spend for optimization: ad-level insights alone can stay at 0 while
-- Meta already deducts budget (esp. Beitrag-Push with AD_SET budgets).
-- 1) Persist campaign-level insight spend on campaigns
-- 2) Persist account spend totals on platform_accounts
-- 3) Ampel: coalesce ad insights → campaign insights → budget-remaining delta

begin;

alter table public.campaigns
  add column if not exists insights_spend numeric
    check (insights_spend is null or insights_spend >= 0),
  add column if not exists insights_impressions bigint
    check (insights_impressions is null or insights_impressions >= 0),
  add column if not exists insights_synced_at timestamptz;

alter table public.platform_accounts
  add column if not exists marketing_spend_total numeric
    check (marketing_spend_total is null or marketing_spend_total >= 0),
  add column if not exists marketing_spend_today numeric
    check (marketing_spend_today is null or marketing_spend_today >= 0),
  add column if not exists marketing_insight_spend_rows integer
    check (
      marketing_insight_spend_rows is null
      or marketing_insight_spend_rows >= 0
    );

grant select (insights_spend, insights_impressions, insights_synced_at)
  on public.campaigns to authenticated;

grant select (
  marketing_spend_total,
  marketing_spend_today,
  marketing_insight_spend_rows
) on public.platform_accounts to authenticated;

create or replace function public.apply_meta_campaign_insight_spend(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_campaign_insights jsonb,
  p_account_spend_total numeric,
  p_account_spend_today numeric,
  p_insight_spend_rows integer,
  p_insights_until date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_platform_account_id is null or p_user_id is null then
    raise exception 'Meta campaign insight spend scope is invalid';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta campaign insight spend scope is invalid';
  end if;

  if p_campaign_insights is null
    or jsonb_typeof(p_campaign_insights) is distinct from 'array' then
    raise exception 'Meta campaign insights payload is invalid';
  end if;

  -- Reset then write window totals per current campaign (Meta platform id).
  update public.campaigns c
  set
    insights_spend = null,
    insights_impressions = null,
    insights_synced_at = null,
    updated_at = now()
  where c.platform_account_id = p_platform_account_id
    and c.user_id = p_user_id
    and c.is_current;

  update public.campaigns c
  set
    insights_spend = agg.spend,
    insights_impressions = agg.impressions,
    insights_synced_at = now(),
    updated_at = now()
  from (
    select
      item.platform_campaign_id,
      coalesce(sum(item.spend), 0)::numeric as spend,
      coalesce(sum(item.impressions), 0)::bigint as impressions
    from jsonb_to_recordset(p_campaign_insights) as item(
      platform_campaign_id text,
      date_start date,
      date_stop date,
      spend numeric,
      impressions bigint
    )
    where item.platform_campaign_id is not null
      and item.platform_campaign_id ~ '^[1-9][0-9]{0,39}$'
    group by item.platform_campaign_id
  ) agg
  where c.platform_account_id = p_platform_account_id
    and c.user_id = p_user_id
    and c.is_current
    and c.platform_campaign_id = agg.platform_campaign_id;

  update public.platform_accounts pa
  set
    marketing_spend_total = greatest(coalesce(p_account_spend_total, 0), 0),
    marketing_spend_today = greatest(coalesce(p_account_spend_today, 0), 0),
    marketing_insight_spend_rows = greatest(coalesce(p_insight_spend_rows, 0), 0),
    marketing_insights_until = coalesce(p_insights_until, pa.marketing_insights_until),
    updated_at = now()
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id;
end;
$$;

revoke all on function public.apply_meta_campaign_insight_spend(
  uuid, uuid, jsonb, numeric, numeric, integer, date
) from public, anon, authenticated;
grant execute on function public.apply_meta_campaign_insight_spend(
  uuid, uuid, jsonb, numeric, numeric, integer, date
) to service_role;

comment on function public.apply_meta_campaign_insight_spend is
  'Writes campaign-level Meta insight spend and account spend totals after marketing sync.';

drop function if exists public.list_meta_organic_boost_campaigns(uuid);

create or replace function public.list_meta_organic_boost_campaigns(
  p_platform_account_id uuid
)
returns table (
  link_id uuid,
  plan_id uuid,
  plan_status text,
  content_candidate_id uuid,
  object_story_id text,
  campaign_id uuid,
  campaign_name text,
  objective text,
  status text,
  effective_status text,
  budget_mode text,
  daily_budget_minor bigint,
  lifetime_budget_minor bigint,
  budget_remaining_minor bigint,
  duration_days integer,
  start_time timestamptz,
  end_time timestamptz,
  spend numeric,
  impressions bigint,
  post_engagements bigint,
  currency text,
  created_at timestamptz,
  plan_error_class text,
  plan_blocked_reason text,
  failed_step_key text,
  failed_step_error_code text,
  failed_step_error_detail text,
  plan_attempt_count integer,
  has_remote_campaign_binding boolean,
  any_step_remote_applied boolean,
  any_step_dispatch_started boolean,
  latest_step_dispatch_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_platform_account_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.platform_accounts account
    where account.id = p_platform_account_id
      and account.user_id = v_user_id
      and account.platform = 'meta'
      and account.revoked_at is null
  ) then
    return;
  end if;

  return query
  with boost_links as (
    select
      link.id as link_id,
      link.plan_id,
      link.content_candidate_id,
      link.object_story_id,
      link.created_at,
      plan.status as plan_status,
      plan.planned_payload,
      plan.error_class as plan_error_class,
      plan.blocked_reason as plan_blocked_reason,
      plan.attempt_count as plan_attempt_count
    from public.meta_organic_boost_links link
    join public.mutation_plans plan
      on plan.id = link.plan_id
     and plan.user_id = link.user_id
     and plan.platform_account_id = link.platform_account_id
    where link.user_id = v_user_id
      and link.platform_account_id = p_platform_account_id
    order by link.created_at desc
    limit 50
  ),
  failed_steps as (
    select distinct on (step.plan_id)
      step.plan_id,
      step.step_key,
      step.error_code,
      step.error_detail
    from public.mutation_plan_steps step
    join boost_links boost on boost.plan_id = step.plan_id
    where step.error_code is not null
      and (
        step.status = 'FAILED'
        or step.error_code like 'meta_graph_%'
      )
    order by step.plan_id, step.step_index desc
  ),
  step_wire as (
    select
      step.plan_id,
      bool_or(step.dispatch_state = 'REMOTE_APPLIED') as any_step_remote_applied,
      bool_or(
        step.dispatch_started_at is not null
        or step.dispatch_state is distinct from 'NOT_DISPATCHED'
      ) as any_step_dispatch_started,
      (
        array_agg(step.dispatch_state order by step.step_index desc)
      )[1] as latest_step_dispatch_state
    from public.mutation_plan_steps step
    join boost_links boost on boost.plan_id = step.plan_id
    group by step.plan_id
  ),
  bound as (
    select
      boost.link_id,
      campaign.id as campaign_id,
      binding.remote_object_id as platform_campaign_id,
      coalesce(
        campaign.name,
        boost.planned_payload#>>'{campaign,name}',
        'Beitrag-Push'
      ) as campaign_name,
      coalesce(
        campaign.objective,
        boost.planned_payload->>'objective'
      ) as objective,
      case when binding.id is not null then campaign.status else null end as status,
      case when binding.id is not null then campaign.effective_status else null end
        as effective_status,
      campaign.daily_budget_minor as campaign_daily_budget_minor,
      campaign.lifetime_budget_minor as campaign_lifetime_budget_minor,
      campaign.insights_spend as campaign_insights_spend,
      campaign.insights_impressions as campaign_insights_impressions,
      case when binding.id is not null then campaign.budget_remaining_minor else null end
        as campaign_budget_remaining_minor,
      case when binding.id is not null then campaign.start_time else null end
        as campaign_start_time,
      case when binding.id is not null then campaign.stop_time else null end
        as campaign_stop_time,
      (binding.id is not null) as has_remote_campaign_binding
    from boost_links boost
    left join public.remote_object_bindings binding
      on binding.plan_id = boost.plan_id
     and binding.user_id = v_user_id
     and binding.platform_account_id = p_platform_account_id
     and binding.object_type = 'CAMPAIGN'
    left join public.campaigns campaign
      on campaign.platform_account_id = p_platform_account_id
     and campaign.user_id = v_user_id
     and campaign.is_current
     and (
       (
         binding.remote_object_id is not null
         and campaign.platform_campaign_id = binding.remote_object_id
       )
       or (
         binding.local_campaign_id is not null
         and campaign.id = binding.local_campaign_id
       )
     )
  ),
  adset_live as (
    select
      bound.link_id,
      sum(coalesce(ag.daily_budget_minor, ag.lifetime_budget_minor))::bigint
        as adset_budget_minor,
      sum(ag.budget_remaining_minor)::bigint as adset_remaining_minor,
      sum(
        greatest(
          0,
          coalesce(ag.daily_budget_minor, ag.lifetime_budget_minor, 0)
          - coalesce(
            ag.budget_remaining_minor,
            coalesce(ag.daily_budget_minor, ag.lifetime_budget_minor, 0)
          )
        )
      )::numeric / 100 as derived_spend
    from bound
    join public.ad_groups ag
      on ag.campaign_id = bound.campaign_id
     and ag.platform_account_id = p_platform_account_id
     and ag.user_id = v_user_id
     and ag.is_current
     and ag.budget_remaining_minor is not null
     and coalesce(ag.daily_budget_minor, ag.lifetime_budget_minor) is not null
    where bound.campaign_id is not null
    group by bound.link_id
  )
  select
    boost.link_id,
    boost.plan_id,
    boost.plan_status,
    boost.content_candidate_id,
    boost.object_story_id,
    bound.campaign_id,
    bound.campaign_name,
    bound.objective,
    bound.status,
    bound.effective_status,
    coalesce(boost.planned_payload->>'budget_mode', 'DAILY') as budget_mode,
    coalesce(
      nullif(boost.planned_payload->>'daily_budget_minor', '')::bigint,
      bound.campaign_daily_budget_minor,
      adset_live.adset_budget_minor
    ) as daily_budget_minor,
    coalesce(
      nullif(boost.planned_payload->>'lifetime_budget_minor', '')::bigint,
      bound.campaign_lifetime_budget_minor
    ) as lifetime_budget_minor,
    coalesce(
      bound.campaign_budget_remaining_minor,
      adset_live.adset_remaining_minor
    ) as budget_remaining_minor,
    coalesce(nullif(boost.planned_payload->>'duration_days', '')::integer, null)
      as duration_days,
    coalesce(
      nullif(boost.planned_payload->>'start_time', '')::timestamptz,
      bound.campaign_start_time
    ) as start_time,
    coalesce(
      nullif(boost.planned_payload->>'end_time', '')::timestamptz,
      bound.campaign_stop_time
    ) as end_time,
    case
      when not coalesce(bound.has_remote_campaign_binding, false) then null
      else coalesce(
        nullif(perf.spend, 0),
        nullif(bound.campaign_insights_spend, 0),
        nullif(adset_live.derived_spend, 0),
        perf.spend,
        bound.campaign_insights_spend,
        adset_live.derived_spend
      )
    end as spend,
    case
      when not coalesce(bound.has_remote_campaign_binding, false) then null
      else coalesce(
        nullif(perf.impressions, 0),
        nullif(bound.campaign_insights_impressions, 0),
        perf.impressions,
        bound.campaign_insights_impressions
      )
    end as impressions,
    case when bound.has_remote_campaign_binding then perf.post_engagements else null end
      as post_engagements,
    coalesce(perf.currency, 'EUR') as currency,
    boost.created_at,
    boost.plan_error_class,
    boost.plan_blocked_reason,
    failed_steps.step_key,
    failed_steps.error_code,
    failed_steps.error_detail,
    coalesce(boost.plan_attempt_count, 0)::integer as plan_attempt_count,
    coalesce(bound.has_remote_campaign_binding, false) as has_remote_campaign_binding,
    coalesce(step_wire.any_step_remote_applied, false) as any_step_remote_applied,
    coalesce(step_wire.any_step_dispatch_started, false) as any_step_dispatch_started,
    step_wire.latest_step_dispatch_state
  from boost_links boost
  left join bound on bound.link_id = boost.link_id
  left join adset_live on adset_live.link_id = boost.link_id
  left join lateral (
    select
      min(pd.currency) as currency,
      sum(pd.spend) as spend,
      sum(pd.impressions)::bigint as impressions,
      round(sum(
        coalesce(nullif(pd.actions->>'post_engagement', ''), '0')::numeric
      ))::bigint as post_engagements
    from public.performance_data pd
    join public.campaigns c
      on c.id = pd.campaign_id
     and c.user_id = v_user_id
     and c.platform_account_id = p_platform_account_id
    where bound.has_remote_campaign_binding
      and pd.user_id = v_user_id
      and pd.platform_account_id = p_platform_account_id
      and pd.platform = 'meta'
      and pd.date >= current_date - 90
      and (
        (bound.campaign_id is not null and pd.campaign_id = bound.campaign_id)
        or (
          bound.platform_campaign_id is not null
          and c.platform_campaign_id = bound.platform_campaign_id
        )
      )
  ) perf on true
  left join failed_steps on failed_steps.plan_id = boost.plan_id
  left join step_wire on step_wire.plan_id = boost.plan_id
  order by boost.created_at desc;
end;
$$;

revoke all on function public.list_meta_organic_boost_campaigns(uuid)
  from public, anon, authenticated;
grant execute on function public.list_meta_organic_boost_campaigns(uuid)
  to authenticated, service_role;

comment on function public.list_meta_organic_boost_campaigns(uuid) is
  'Organic Ampel spend: ad insights, else campaign insights, else AD_SET budget delta.';

commit;

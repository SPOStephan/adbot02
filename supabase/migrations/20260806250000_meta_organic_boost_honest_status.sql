-- Beitrag-Push Ampel must never invent Meta progress.
-- Surface wire-proof fields and stop name-matching campaigns without bindings.

begin;

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
      step.error_code
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
      coalesce(binding.local_campaign_id, campaign.id) as campaign_id,
      coalesce(
        campaign.name,
        boost.planned_payload#>>'{campaign,name}',
        'Beitrag-Push'
      ) as campaign_name,
      coalesce(
        campaign.objective,
        boost.planned_payload->>'objective'
      ) as objective,
      -- Meta campaign status only when a real remote binding exists.
      case when binding.id is not null then campaign.status else null end as status,
      case when binding.id is not null then campaign.effective_status else null end
        as effective_status,
      campaign.daily_budget_minor as campaign_daily_budget_minor,
      campaign.lifetime_budget_minor as campaign_lifetime_budget_minor,
      case when binding.id is not null then campaign.budget_remaining_minor else null end
        as budget_remaining_minor,
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
       (binding.local_campaign_id is not null and campaign.id = binding.local_campaign_id)
       or (
         binding.remote_object_id is not null
         and campaign.platform_campaign_id = binding.remote_object_id
       )
     )
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
      bound.campaign_daily_budget_minor
    ) as daily_budget_minor,
    coalesce(
      nullif(boost.planned_payload->>'lifetime_budget_minor', '')::bigint,
      bound.campaign_lifetime_budget_minor
    ) as lifetime_budget_minor,
    bound.budget_remaining_minor,
    coalesce(nullif(boost.planned_payload->>'duration_days', '')::integer, null) as duration_days,
    coalesce(
      nullif(boost.planned_payload->>'start_time', '')::timestamptz,
      bound.campaign_start_time
    ) as start_time,
    coalesce(
      nullif(boost.planned_payload->>'end_time', '')::timestamptz,
      bound.campaign_stop_time
    ) as end_time,
    case when bound.has_remote_campaign_binding then perf.spend else null end as spend,
    case when bound.has_remote_campaign_binding then perf.impressions else null end
      as impressions,
    case when bound.has_remote_campaign_binding then perf.post_engagements else null end
      as post_engagements,
    coalesce(perf.currency, 'EUR') as currency,
    boost.created_at,
    boost.plan_error_class,
    boost.plan_blocked_reason,
    failed_steps.step_key,
    failed_steps.error_code,
    coalesce(boost.plan_attempt_count, 0)::integer as plan_attempt_count,
    coalesce(bound.has_remote_campaign_binding, false) as has_remote_campaign_binding,
    coalesce(step_wire.any_step_remote_applied, false) as any_step_remote_applied,
    coalesce(step_wire.any_step_dispatch_started, false) as any_step_dispatch_started,
    step_wire.latest_step_dispatch_state
  from boost_links boost
  left join bound on bound.link_id = boost.link_id
  left join lateral (
    select
      pd.campaign_id,
      min(pd.currency) as currency,
      sum(pd.spend) as spend,
      sum(pd.impressions)::bigint as impressions,
      round(sum(
        coalesce(nullif(pd.actions->>'post_engagement', ''), '0')::numeric
      ))::bigint as post_engagements
    from public.performance_data pd
    where bound.campaign_id is not null
      and bound.has_remote_campaign_binding
      and pd.user_id = v_user_id
      and pd.platform_account_id = p_platform_account_id
      and pd.platform = 'meta'
      and pd.campaign_id = bound.campaign_id
      and pd.date >= current_date - 90
    group by pd.campaign_id
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
  'Organic boost Ampel rows with wire-proof fields. Meta status/spend only when a CAMPAIGN remote binding exists.';

commit;

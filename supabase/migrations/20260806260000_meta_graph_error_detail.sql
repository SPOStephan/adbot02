-- Persist Meta Graph reject details (error_user_msg / subcode) so Beitrag-Push
-- Ampel can show the real reason instead of opaque meta_graph_100.

begin;

alter table public.mutation_plan_steps
  add column if not exists error_detail text;

alter table public.mutation_plan_steps
  drop constraint if exists mutation_plan_steps_error_detail_check;

alter table public.mutation_plan_steps
  add constraint mutation_plan_steps_error_detail_check
  check (
    error_detail is null
    or char_length(error_detail) between 1 and 400
  );

create or replace function public.meta_executor_safe_error_detail(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    else left(
      regexp_replace(
        regexp_replace(btrim(p_value), 'EAA[A-Za-z0-9]+|EAAB[A-Za-z0-9]+|access_token=[^&\s]+', '[redacted]', 'gi'),
        E'[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]',
        ' ',
        'g'
      ),
      400
    )
  end;
$$;

revoke all on function public.meta_executor_safe_error_detail(text)
  from public, anon, authenticated;
grant execute on function public.meta_executor_safe_error_detail(text)
  to service_role;

drop function if exists public.fail_meta_mutation_execution(
  uuid, uuid, uuid, text, text, text, integer
);

create or replace function public.fail_meta_mutation_execution(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid,
  p_error_class text,
  p_error_code text,
  p_remote_outcome text,
  p_retry_after_seconds integer default 120,
  p_error_detail text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_retryable boolean;
  v_plan_status text;
  v_step_status text;
  v_execution_status text;
  v_safe_code text;
  v_safe_detail text;
begin
  if p_remote_outcome not in ('NOT_APPLIED', 'UNKNOWN', 'PERMANENT')
    or p_error_class not in ('TRANSPORT', 'RATE_LIMIT', 'AUTH', 'META', 'PROTOCOL', 'PREFLIGHT', 'RECONCILIATION') then
    raise exception 'Invalid Meta execution failure classification';
  end if;

  v_safe_code := public.meta_executor_safe_error_code(p_error_code);
  v_safe_detail := public.meta_executor_safe_error_detail(p_error_detail);

  select me.* into v_execution from public.mutation_executions me
  where me.id = p_execution_id and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then raise exception 'Active Meta execution is required'; end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id and mp.lease_token = p_lease_token
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.status in ('CLAIMED', 'RUNNING')
  for update;
  if not found then raise exception 'Active Meta mutation step is required'; end if;

  v_retryable := p_remote_outcome = 'NOT_APPLIED'
    and p_error_class in ('TRANSPORT', 'RATE_LIMIT')
    and v_plan.attempt_count < v_plan.max_attempts;

  if p_remote_outcome = 'UNKNOWN'
    and v_plan.action_type = 'LAUNCH_CHAIN' then
    v_plan_status := 'COMPENSATION_REQUIRED';
    v_step_status := 'COMPENSATION_REQUIRED';
    v_execution_status := 'COMPENSATION_REQUIRED';
  elsif p_remote_outcome = 'UNKNOWN' then
    v_plan_status := 'RECONCILING';
    v_step_status := 'REMOTE_APPLIED';
    v_execution_status := 'RECONCILING';
  elsif v_retryable then
    v_plan_status := 'RETRYABLE';
    v_step_status := 'RETRYABLE';
    v_execution_status := 'RETRYABLE';
  elsif v_step.compensation_operation = 'PAUSE'
    and p_remote_outcome <> 'NOT_APPLIED' then
    v_plan_status := 'COMPENSATION_REQUIRED';
    v_step_status := 'COMPENSATION_REQUIRED';
    v_execution_status := 'COMPENSATION_REQUIRED';
  else
    v_plan_status := 'FAILED';
    v_step_status := 'FAILED';
    v_execution_status := 'FAILED';
  end if;

  update public.mutation_plan_steps
  set status = v_step_status,
      dispatch_state = case
        when p_remote_outcome = 'UNKNOWN' then 'REMOTE_UNKNOWN'
        when p_remote_outcome = 'NOT_APPLIED' then 'NOT_DISPATCHED'
        else dispatch_state
      end,
      dispatch_started_at = case
        when p_remote_outcome = 'NOT_APPLIED' then null
        else dispatch_started_at
      end,
      not_before = case when v_retryable
        then now() + make_interval(secs => greatest(30, least(86400, p_retry_after_seconds)))
        else not_before end,
      completed_at = case when v_step_status in ('FAILED', 'COMPENSATION_REQUIRED')
        then now() else completed_at end,
      error_class = p_error_class,
      error_code = v_safe_code,
      error_detail = v_safe_detail,
      updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = v_execution_status, finished_at = case
        when v_execution_status in ('RETRYABLE', 'COMPENSATION_REQUIRED', 'FAILED')
          then now() else finished_at end,
      error_class = p_error_class,
      error_code = v_safe_code,
      error_message = v_safe_detail
  where id = v_execution.id;

  update public.mutation_plans
  set status = v_plan_status,
      not_before = case when v_retryable
        then now() + make_interval(secs => greatest(30, least(86400, p_retry_after_seconds)))
        else not_before end,
      lease_token = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_token
        else null end,
      lease_owner = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_owner
        else null end,
      lease_expires_at = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_expires_at
        else null end,
      terminal_at = case when v_plan_status in ('FAILED', 'COMPENSATION_REQUIRED')
        then now() else terminal_at end,
      error_class = p_error_class, blocked_reason = v_safe_code,
      updated_at = now()
  where id = v_plan.id;

  if p_remote_outcome <> 'UNKNOWN'
    or v_plan.action_type = 'LAUNCH_CHAIN' then
    perform public.release_meta_account_operation(
      v_plan.platform_account_id, v_plan.user_id, p_lease_token
    );
  end if;

  insert into public.automation_alerts (
    user_id, platform_account_id, plan_id, dedup_key, severity, alert_type,
    title, message, details, status, first_seen_at, last_seen_at
  ) values (
    v_plan.user_id, v_plan.platform_account_id, v_plan.id,
    'executor:' || v_plan.id::text || ':' || v_safe_code,
    case when p_remote_outcome = 'UNKNOWN' then 'CRITICAL'
         when v_plan_status = 'FAILED' then 'CRITICAL' else 'WARNING' end,
    case when p_remote_outcome = 'UNKNOWN'
      then 'REMOTE_OUTCOME_AMBIGUOUS' else 'MUTATION_EXECUTION_FAILED' end,
    case when p_remote_outcome = 'UNKNOWN'
      then 'Meta-Ergebnis muss abgeglichen werden'
      else 'Meta-Änderung konnte nicht abgeschlossen werden' end,
    case
      when p_remote_outcome = 'UNKNOWN'
        then 'Ein Remote-Aufruf wurde gesendet, sein Ergebnis ist jedoch unbekannt. Der Executor wiederholt die Mutation nicht blind.'
      when v_safe_detail is not null
        then left('Meta: ' || v_safe_detail, 1000)
      else 'Die geplante Meta-Änderung wurde sicher gestoppt. Weitere Schritte folgen gemäß Retry- und Kompensationsregeln.'
    end,
    jsonb_build_object(
      'error_class', p_error_class,
      'error_code', v_safe_code,
      'remote_outcome', p_remote_outcome,
      'error_detail', coalesce(v_safe_detail, '')
    ),
    'OPEN', now(), now()
  ) on conflict (platform_account_id, dedup_key) do update set
    severity = excluded.severity, alert_type = excluded.alert_type,
    title = excluded.title, message = excluded.message,
    details = excluded.details, status = 'OPEN', last_seen_at = now(),
    resolved_at = null, acknowledged_at = null, updated_at = now();

  update public.platform_accounts as pa
  set automation_executor_status = case
        when p_remote_outcome = 'UNKNOWN' then 'ambiguous'
        when v_retryable then 'retryable'
        else 'error' end,
      automation_executor_error_code = v_safe_code,
      automation_executor_last_run_at = now(),
      automation_executor_last_plan_id = v_plan.id,
      updated_at = now()
  where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    case when p_remote_outcome = 'UNKNOWN'
      then 'MUTATION_REMOTE_OUTCOME_AMBIGUOUS' else 'MUTATION_EXECUTION_FAILED' end,
    jsonb_build_object('plan_status', v_plan.status, 'step_status', v_step.status,
                       'dispatch_state', v_step.dispatch_state),
    jsonb_build_object('request_hash', v_step.request_hash), '{}'::jsonb,
    jsonb_build_object('plan_status', v_plan_status, 'step_status', v_step_status,
                       'remote_outcome', p_remote_outcome),
    jsonb_build_object(
      'retry_after_seconds', p_retry_after_seconds,
      'error_detail', coalesce(v_safe_detail, '')
    ),
    'meta', null, null, null, p_error_class, now()
  );

  return v_plan_status;
end;
$$;

revoke all on function public.fail_meta_mutation_execution(
  uuid, uuid, uuid, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.fail_meta_mutation_execution(
  uuid, uuid, uuid, text, text, text, integer, text
) to service_role;

comment on function public.fail_meta_mutation_execution(
  uuid, uuid, uuid, text, text, text, integer, text
) is
  'Classifies not-applied/unknown/permanent outcomes and stores secret-safe Meta error_detail (user_msg/subcode).';

-- Ampel: surface failed_step_error_detail
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
    failed_steps.error_detail,
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
  'Organic boost Ampel with wire-proof fields and Meta error_detail (user_msg).';

commit;

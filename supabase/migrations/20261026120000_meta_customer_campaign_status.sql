-- Customer Pause/Fortsetzen for Adbot-launched Lead/Traffic campaigns.
--
-- 1) queue_meta_customer_campaign_status_change queues one PAUSE or ACTIVATE
--    plan (VALIDATE → UPDATE_STATUS → READ → RECONCILE) through the normal
--    executor gates (policy allow_status_changes, kill switch, MANAGED target,
--    before-state check). Beitrag-Push (organic-boost) campaigns are excluded.
-- 2) Hard-cap day-resume must not override a later status decision: once a
--    hard-cap SAFETY_PAUSE was followed by a SUCCEEDED PAUSE/ACTIVATE (customer
--    button, or an earlier day-resume that a manual Ads-Manager pause undid),
--    the campaign is no longer resumed automatically. Organic-boost campaigns
--    keep their existing resume behaviour (no collateral on Beitrag-Push).
-- 3) run_meta_lead_underperformer_pause pauses at most one comparatively weak
--    Adbot Lead campaign per account and day (7-day CPL > 2 x account best).

begin;

-- Shared PAUSE/ACTIVATE plan builder for one MANAGED campaign target. Callers
-- own every eligibility rule; this only checks the write gates and queues.
create or replace function public.queue_meta_campaign_status_plan_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_automation_target_id uuid,
  p_status text,
  p_source_rule_key text,
  p_evidence jsonb,
  p_actor_type text,
  p_actor_id text,
  p_planned_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := upper(coalesce(p_status, ''));
  v_action text;
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_campaign public.campaigns%rowtype;
  v_current_status text;
  v_configured_status text;
  v_kill_mode text;
  v_plan_id uuid := gen_random_uuid();
  v_existing_plan_id uuid;
  v_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_step_validate uuid := gen_random_uuid();
  v_step_mutate uuid := gen_random_uuid();
  v_step_read uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_validate_request jsonb;
  v_mutate_request jsonb;
  v_read_request jsonb;
  v_reconcile_request jsonb;
  v_step_prefix text;
begin
  if v_status not in ('PAUSED', 'ACTIVE') then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_status');
  end if;
  if p_source_rule_key not in ('customer_status_change', 'lead_underperformer_pause_v1')
    or p_actor_type not in ('CUSTOMER', 'SYSTEM')
    or jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_request');
  end if;
  v_action := case when v_status = 'PAUSED' then 'PAUSE' else 'ACTIVATE' end;
  v_step_prefix := case
    when p_source_rule_key = 'lead_underperformer_pause_v1' then 'lead-underperformer-pause'
    when v_status = 'PAUSED' then 'customer-pause'
    else 'customer-resume'
  end;

  select target.* into v_target
  from public.automation_targets target
  where target.id = p_automation_target_id
    and target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'CAMPAIGN'
    and target.status = 'MANAGED'
  for update;

  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'target_not_managed');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':status-target:' || v_target.target_key,
      0
    )
  );

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  order by ap.version desc
  limit 1;

  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'policy_inactive');
  end if;
  if not v_policy.allow_status_changes then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'status_changes_not_allowed');
  end if;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_target.campaign_id
    and c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
  for update;

  if not found or v_campaign.last_seen_sync_id is null then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'campaign_not_found');
  end if;

  v_configured_status := upper(coalesce(v_campaign.status, ''));
  v_current_status := coalesce(v_campaign.effective_status, v_campaign.status);

  if v_configured_status in ('DELETED', 'ARCHIVED')
    or upper(coalesce(v_campaign.effective_status, '')) in ('DELETED', 'ARCHIVED') then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'campaign_archived');
  end if;
  if v_configured_status = v_status then
    return jsonb_build_object('outcome', 'UNCHANGED', 'reason', 'already_in_status');
  end if;
  if v_status = 'ACTIVE' and v_configured_status <> 'PAUSED' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'campaign_not_paused');
  end if;
  if v_status = 'PAUSED' and v_configured_status <> 'ACTIVE' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'campaign_not_active');
  end if;
  if v_status = 'ACTIVE'
    and v_campaign.stop_time is not null
    and v_campaign.stop_time <= p_planned_at then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'campaign_schedule_ended');
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  if coalesce(v_kill_mode, 'ALLOW') <> 'ALLOW' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'writes_frozen');
  end if;

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.platform_account_id = p_platform_account_id
    and mp.target_type = 'CAMPAIGN'
    and mp.target_key = v_target.target_key
    and mp.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by mp.created_at desc
  limit 1;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'pending_campaign_plan',
      'plan_id', v_existing_plan_id
    );
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'contract', 'meta_campaign_status_v1',
    'operation', 'UPDATE_STATUS',
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'target_key', v_target.target_key,
    'status', v_status,
    'requested_by', lower(p_actor_type),
    'requested_at', p_planned_at,
    'evidence', coalesce(p_evidence, '{}'::jsonb)
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || v_policy.id::text || '|' || p_source_rule_key || '|'
    || v_target.target_key || '|' || v_payload_hash
  );

  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
    source_rule_key, source_rule_version, action_type, target_type, target_key,
    campaign_scope_key, budget_owner_key, automation_target_id, idempotency_key,
    expected_before, intended_after, planned_payload, payload_hash, status,
    priority, safety_action, not_before, max_attempts, created_at, updated_at
  ) values (
    v_plan_id, p_user_id, p_platform_account_id, v_policy.id,
    v_campaign.last_seen_sync_id, p_source_rule_key, 1, v_action,
    'CAMPAIGN', v_target.target_key, v_target.campaign_scope_key,
    v_target.budget_owner_key, v_target.id, v_idempotency_key,
    jsonb_build_object(
      'status', v_current_status,
      'source_marketing_sync_id', v_campaign.last_seen_sync_id
    ),
    jsonb_build_object('status', v_status),
    v_payload, v_payload_hash, 'PENDING',
    case when p_actor_type = 'CUSTOMER' then 20 else 51 end,
    false, p_planned_at, 3, p_planned_at, p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS',
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'status', v_status,
    'mode', 'validate_only'
  );
  v_mutate_request :=
    v_validate_request || jsonb_build_object('mode', 'execute');
  v_read_request := jsonb_build_object(
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'fields', jsonb_build_array(
      'id', 'status', 'effective_status', 'updated_time'
    )
  );
  v_reconcile_request := jsonb_build_object(
    'expected_status', v_status,
    'safety_action', false,
    'requested_by', lower(p_actor_type)
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-' || v_step_prefix, 'VALIDATE', 'CAMPAIGN', null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-' || v_step_prefix, 'UPDATE', 'CAMPAIGN', v_step_validate,
    v_mutate_request, public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('status', v_status),
    case when v_status = 'ACTIVE' then 'PAUSE' else 'NONE' end,
    'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-' || v_step_prefix, 'READ', 'CAMPAIGN', v_step_mutate,
    v_read_request, public.meta_sha256(v_read_request::text),
    jsonb_build_object('status', v_status), 'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-' || v_step_prefix, 'RECONCILE', 'CAMPAIGN', v_step_read,
    v_reconcile_request, public.meta_sha256(v_reconcile_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'), 'NONE', 'PENDING'
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, v_policy.id, v_plan_id,
    null, null, p_actor_type, p_actor_id,
    case
      when p_source_rule_key = 'lead_underperformer_pause_v1'
        then 'LEAD_UNDERPERFORMER_PAUSE_QUEUED'
      else 'CUSTOMER_CAMPAIGN_STATUS_QUEUED'
    end,
    jsonb_build_object('status', v_current_status),
    v_payload, '{}'::jsonb,
    jsonb_build_object('status', v_status, 'plan_status', 'PENDING'),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'reason', p_source_rule_key,
    'plan_id', v_plan_id,
    'action_type', v_action
  );
end;
$$;

revoke all on function public.queue_meta_campaign_status_plan_internal(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) from public, anon, authenticated, service_role;

comment on function public.queue_meta_campaign_status_plan_internal(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) is
  'Queues a non-safety PAUSE/ACTIVATE plan (VALIDATE/UPDATE_STATUS/READ/RECONCILE) for one MANAGED campaign target behind the policy and kill-switch gates.';

-- True when the campaign was created by an Adbot customer launch (never
-- Beitrag-Push, which uses source_rule_key organic-boost).
create or replace function public.meta_campaign_is_adbot_launch(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_platform_campaign_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.remote_object_bindings binding
    join public.mutation_plans launch on launch.id = binding.plan_id
    where binding.platform_account_id = p_platform_account_id
      and binding.user_id = p_user_id
      and binding.object_type = 'CAMPAIGN'
      and binding.remote_object_id = p_platform_campaign_id
      and launch.source_rule_key = 'active-launch-chain'
  );
$$;

revoke all on function public.meta_campaign_is_adbot_launch(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.queue_meta_customer_campaign_status_change(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_platform_campaign_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_id uuid;
begin
  if upper(coalesce(p_status, '')) not in ('PAUSED', 'ACTIVE') then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_status');
  end if;
  if coalesce(p_platform_campaign_id, '') !~ '^[1-9][0-9]{0,39}$' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_campaign_id');
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_account');
  end if;

  if not public.meta_campaign_is_adbot_launch(
    p_user_id, p_platform_account_id, p_platform_campaign_id
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'not_adbot_launch');
  end if;

  select target.id into v_target_id
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'CAMPAIGN'
    and target.platform_object_id = p_platform_campaign_id
    and target.status = 'MANAGED'
  order by target.updated_at desc
  limit 1;

  if v_target_id is null then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'target_not_managed');
  end if;

  return public.queue_meta_campaign_status_plan_internal(
    p_user_id, p_platform_account_id, v_target_id, p_status,
    'customer_status_change', '{}'::jsonb, 'CUSTOMER', p_user_id::text, now()
  );
end;
$$;

revoke all on function public.queue_meta_customer_campaign_status_change(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.queue_meta_customer_campaign_status_change(
  uuid, uuid, text, text
) to service_role;

comment on function public.queue_meta_customer_campaign_status_change(
  uuid, uuid, text, text
) is
  'Queues a customer PAUSE/ACTIVATE plan for an Adbot-launched (active-launch-chain) MANAGED campaign; organic-boost campaigns are excluded.';

-- 7-day spend/leads of the account's running Lead campaigns (ad-level rows
-- summed per campaign).
create or replace function public.meta_lead_campaign_window(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_window_end date,
  p_planned_at timestamptz
)
returns table (
  campaign_id uuid,
  platform_campaign_id text,
  name text,
  spend numeric,
  leads bigint,
  first_day date,
  start_time timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.platform_campaign_id,
    c.name,
    coalesce(sum(pd.spend), 0),
    coalesce(sum(pd.leads), 0)::bigint,
    min(pd.date),
    c.start_time
  from public.campaigns c
  join public.performance_data pd
    on pd.campaign_id = c.id
   and pd.user_id = p_user_id
   and pd.platform_account_id = p_platform_account_id
   and pd.platform = 'meta'
   and pd.date between p_window_end - 6 and p_window_end
  where c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
    and upper(coalesce(c.objective, '')) in ('OUTCOME_LEADS', 'LEAD_GENERATION')
    and upper(coalesce(c.status, '')) = 'ACTIVE'
    and upper(coalesce(c.effective_status, c.status, '')) = 'ACTIVE'
    and (c.stop_time is null or c.stop_time > p_planned_at)
  group by c.id, c.platform_campaign_id, c.name, c.start_time;
$$;

revoke all on function public.meta_lead_campaign_window(uuid, uuid, date, timestamptz)
  from public, anon, authenticated, service_role;

-- Automatic pause of a comparatively weak Adbot Lead campaign (owner decision
-- 2026-10-26, "Vergleich im Konto"):
--   * window: the last 7 insight days of the account
--   * reference: lowest cost per lead among the account's running Lead
--     campaigns with at least 3 leads in the window
--   * candidate: running Adbot Lead campaign (active-launch-chain, MANAGED),
--     at least 7 days old, spend >= 3 x reference CPL, and either 0 leads or
--     CPL > 2 x reference CPL; never the reference campaign itself
--   * at most one automatic pause per account per 24 hours
--   * a customer resume within the last 7 days protects the campaign
create or replace function public.run_meta_lead_underperformer_pause(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_planned_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_end date;
  v_reference record;
  v_candidate record;
  v_result jsonb;
  v_min_leads constant integer := 3;
  v_cpl_factor constant numeric := 2;
  v_spend_factor constant numeric := 3;
begin
  if p_planned_at < now() - interval '5 minutes'
    or p_planned_at > now() + interval '1 minute' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_planner_time');
  end if;

  if not exists (
    select 1
    from public.automation_policies ap
    where ap.user_id = p_user_id
      and ap.platform_account_id = p_platform_account_id
      and ap.is_current
      and ap.status = 'ACTIVE'
      and ap.allow_status_changes
  ) then
    return jsonb_build_object('outcome', 'SKIPPED', 'reason', 'status_changes_not_allowed');
  end if;

  if exists (
    select 1
    from public.mutation_plans mp
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'lead_underperformer_pause_v1'
      and mp.status not in ('CANCELLED', 'PREFLIGHT_FAILED', 'STALE', 'BLOCKED')
      and mp.created_at > p_planned_at - interval '24 hours'
  ) then
    return jsonb_build_object('outcome', 'SKIPPED', 'reason', 'daily_pause_limit');
  end if;

  select max(pd.date) into v_window_end
  from public.performance_data pd
  where pd.user_id = p_user_id
    and pd.platform_account_id = p_platform_account_id
    and pd.platform = 'meta';

  if v_window_end is null then
    return jsonb_build_object('outcome', 'SKIPPED', 'reason', 'no_insights');
  end if;

  select w.*, w.spend / w.leads as cpl into v_reference
  from public.meta_lead_campaign_window(
      p_user_id, p_platform_account_id, v_window_end, p_planned_at
    ) w
  where w.leads >= v_min_leads
    and w.spend > 0
  order by w.spend / w.leads asc, w.leads desc
  limit 1;

  if v_reference.campaign_id is null then
    return jsonb_build_object('outcome', 'SKIPPED', 'reason', 'no_reference_campaign');
  end if;

  for v_candidate in
    select
      w.*,
      target.id as target_id,
      case when w.leads > 0 then w.spend / w.leads else null end as cpl
    from public.meta_lead_campaign_window(
      p_user_id, p_platform_account_id, v_window_end, p_planned_at
    ) w
    join public.automation_targets target
      on target.user_id = p_user_id
     and target.platform_account_id = p_platform_account_id
     and target.target_type = 'CAMPAIGN'
     and target.campaign_id = w.campaign_id
     and target.status = 'MANAGED'
    where w.campaign_id <> v_reference.campaign_id
      and coalesce(w.start_time, w.first_day::timestamptz) <= p_planned_at - interval '7 days'
      and w.spend >= v_spend_factor * v_reference.cpl
      and (w.leads = 0 or w.spend / w.leads > v_cpl_factor * v_reference.cpl)
      and public.meta_campaign_is_adbot_launch(
        p_user_id, p_platform_account_id, w.platform_campaign_id
      )
      and not exists (
        select 1
        from public.mutation_plans resumed
        where resumed.user_id = p_user_id
          and resumed.platform_account_id = p_platform_account_id
          and resumed.target_type = 'CAMPAIGN'
          and resumed.target_key = target.target_key
          and resumed.source_rule_key = 'customer_status_change'
          and resumed.action_type = 'ACTIVATE'
          and resumed.status = 'SUCCEEDED'
          and resumed.created_at > p_planned_at - interval '7 days'
      )
    order by (w.leads = 0) desc,
      case when w.leads > 0 then w.spend / w.leads else w.spend end desc
    limit 1
  loop
    v_result := public.queue_meta_campaign_status_plan_internal(
      p_user_id, p_platform_account_id, v_candidate.target_id, 'PAUSED',
      'lead_underperformer_pause_v1',
      jsonb_build_object(
        'rule', 'lead_cpl_vs_account_best_7d',
        'window_start', v_window_end - 6,
        'window_end', v_window_end,
        'spend', round(v_candidate.spend, 2),
        'leads', v_candidate.leads,
        'cpl', case when v_candidate.cpl is null then null else round(v_candidate.cpl, 2) end,
        'reference_campaign_id', v_reference.platform_campaign_id,
        'reference_campaign_name', v_reference.name,
        'reference_cpl', round(v_reference.cpl, 2),
        'reference_leads', v_reference.leads,
        'cpl_factor', v_cpl_factor,
        'spend_factor', v_spend_factor
      ),
      'SYSTEM', 'meta-lead-underperformer', p_planned_at
    );
    return v_result || jsonb_build_object(
      'campaign_id', v_candidate.platform_campaign_id
    );
  end loop;

  return jsonb_build_object('outcome', 'SKIPPED', 'reason', 'no_underperformer');
end;
$$;

revoke all on function public.run_meta_lead_underperformer_pause(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.run_meta_lead_underperformer_pause(
  uuid, uuid, timestamptz
) to service_role;

comment on function public.run_meta_lead_underperformer_pause(
  uuid, uuid, timestamptz
) is
  'Queues at most one daily PAUSE for an Adbot Lead campaign whose 7-day cost per lead is more than twice the account best (spend >= 3 x best CPL).';

-- Hard-cap day-resume: a later SUCCEEDED PAUSE/ACTIVATE wins over the old
-- hard-cap safety pause. Patched in place like 20260809110000/120000 so the
-- earlier text patches stay intact.
do $patch_resume_later_status$
declare
  v_function regprocedure :=
    'public.queue_meta_hard_cap_resume_internal(uuid,uuid,uuid,uuid,uuid,uuid,date,jsonb,timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if v_definition is null then
    raise exception 'queue_meta_hard_cap_resume_internal not found';
  end if;

  if position('resume_respects_later_status_change' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'(''outcome'', ''BLOCKED'', ''reason'', ''not_prior_hard_cap_safety_pause''\\s+\\);\\s+end if;)',
    E'\\1\n\n'
    || $guard$  -- resume_respects_later_status_change: a customer pause or a manual
  -- pause after an earlier day-resume must not be undone by the planner.
  if not exists (
    select 1
    from public.remote_object_bindings binding
    join public.mutation_plans launch on launch.id = binding.plan_id
    where binding.platform_account_id = p_platform_account_id
      and binding.object_type = 'CAMPAIGN'
      and binding.remote_object_id = v_target.platform_object_id
      and launch.source_rule_key = 'organic-boost'
  )
  and exists (
    select 1
    from public.mutation_plans later
    where later.user_id = p_user_id
      and later.platform_account_id = p_platform_account_id
      and later.target_type = 'CAMPAIGN'
      and later.target_key = v_target.target_key
      and later.action_type in ('PAUSE', 'ACTIVATE')
      and later.status = 'SUCCEEDED'
      and later.created_at > (
        select max(prior.created_at)
        from public.mutation_plans prior
        where prior.user_id = p_user_id
          and prior.platform_account_id = p_platform_account_id
          and prior.target_type = 'CAMPAIGN'
          and prior.target_key = v_target.target_key
          and prior.action_type = 'SAFETY_PAUSE'
          and prior.safety_action
          and prior.status = 'SUCCEEDED'
          and prior.source_rule_key = 'hard_cap_exposure_breach'
      )
  ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'later_status_change_wins'
    );
  end if;$guard$,
    ''
  );

  if position('resume_respects_later_status_change' in v_updated) = 0 then
    raise exception
      'Could not add later-status guard to queue_meta_hard_cap_resume_internal';
  end if;

  execute v_updated;
end;
$patch_resume_later_status$;

revoke all on function public.queue_meta_hard_cap_resume_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, date, jsonb, timestamptz
) from public, anon, authenticated, service_role;

commit;

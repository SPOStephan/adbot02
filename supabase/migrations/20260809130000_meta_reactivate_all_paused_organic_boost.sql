-- Remaining Beitrag-Push campaigns stayed PAUSED because force-resume still
-- required a SUCCEEDED hard_cap SAFETY_PAUSE. Several Meta-paused boosts have
-- no such prior plan (or local status/sync gates blocked them).
--
-- Recovery: ACTIVATE every current, still-scheduled, PAUSED organic-boost
-- campaign — no SAFETY_PAUSE history required.

begin;

create or replace function public.queue_meta_organic_boost_reactivate_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_automation_target_id uuid,
  p_account_day date,
  p_evidence jsonb,
  p_planned_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_campaign public.campaigns%rowtype;
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
begin
  if jsonb_typeof(p_evidence) <> 'object'
    or pg_catalog.pg_column_size(p_evidence) > 65536 then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'invalid_reactivate_evidence'
    );
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = p_policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found or not v_policy.allow_status_changes then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'status_changes_not_allowed'
    );
  end if;

  select target.* into v_target
  from public.automation_targets target
  where target.id = p_automation_target_id
    and target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'CAMPAIGN'
    and target.status = 'MANAGED'
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'invalid_campaign_target'
    );
  end if;

  -- Must be a Beitrag-Push campaign.
  if not exists (
    select 1
    from public.remote_object_bindings binding
    join public.mutation_plans boost_plan
      on boost_plan.id = binding.plan_id
     and boost_plan.user_id = binding.user_id
     and boost_plan.platform_account_id = binding.platform_account_id
    where binding.user_id = p_user_id
      and binding.platform_account_id = p_platform_account_id
      and binding.object_type = 'CAMPAIGN'
      and (
        binding.remote_object_id = v_target.platform_object_id
        or binding.local_campaign_id = v_target.campaign_id
      )
      and boost_plan.source_rule_key = 'organic-boost'
      and boost_plan.action_type = 'LAUNCH_CHAIN'
  ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'not_organic_boost_campaign'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':status-target:' || v_target.target_key,
      0
    )
  );

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_target.campaign_id
    and c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
  for update;

  if not found
    or (
      upper(coalesce(v_campaign.status, '')) <> 'PAUSED'
      and upper(coalesce(v_campaign.effective_status, ''))
        not in ('PAUSED', 'CAMPAIGN_PAUSED')
    ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'campaign_not_paused'
    );
  end if;

  if v_campaign.stop_time is not null
    and v_campaign.stop_time <= p_planned_at then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'campaign_schedule_ended'
    );
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  if coalesce(v_kill_mode, 'ALLOW') <> 'ALLOW' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'kill_switch_blocks_reactivate'
    );
  end if;

  -- Revive terminal ACTIVATE plans for this target so they do not block forever.
  begin
    alter table public.mutation_plans
      disable trigger guard_meta_mutation_plan_update;
    alter table public.mutation_plan_steps
      disable trigger guard_meta_mutation_step_update;

    update public.mutation_plans mp
    set
      status = 'PENDING',
      attempt_count = 0,
      max_attempts = greatest(coalesce(mp.max_attempts, 1), 5),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      error_class = null,
      blocked_reason = null,
      terminal_at = null,
      not_before = least(coalesce(mp.not_before, p_planned_at), p_planned_at),
      updated_at = p_planned_at
    where mp.platform_account_id = p_platform_account_id
      and mp.user_id = p_user_id
      and mp.target_type = 'CAMPAIGN'
      and mp.target_key = v_target.target_key
      and mp.action_type = 'ACTIVATE'
      and mp.source_rule_key in (
        'hard_cap_day_resume', 'organic_boost_reactivate'
      )
      and mp.status in (
        'FAILED', 'STALE', 'BLOCKED', 'CANCELLED', 'PREFLIGHT_FAILED'
      );

    update public.mutation_plan_steps step
    set
      status = 'PENDING',
      dispatch_state = 'NOT_DISPATCHED',
      dispatch_started_at = null,
      error_code = null,
      error_detail = null,
      updated_at = p_planned_at
    where step.platform_account_id = p_platform_account_id
      and step.user_id = p_user_id
      and step.status in ('FAILED', 'RETRYABLE', 'COMPENSATION_REQUIRED')
      and exists (
        select 1
        from public.mutation_plans mp
        where mp.id = step.plan_id
          and mp.target_key = v_target.target_key
          and mp.action_type = 'ACTIVATE'
          and mp.source_rule_key in (
            'hard_cap_day_resume', 'organic_boost_reactivate'
          )
          and mp.status = 'PENDING'
      );

    alter table public.mutation_plan_steps
      enable trigger guard_meta_mutation_step_update;
    alter table public.mutation_plans
      enable trigger guard_meta_mutation_plan_update;
  exception
    when others then
      alter table public.mutation_plan_steps
        enable trigger guard_meta_mutation_step_update;
      alter table public.mutation_plans
        enable trigger guard_meta_mutation_plan_update;
      raise;
  end;

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.platform_account_id = p_platform_account_id
    and mp.target_type = 'CAMPAIGN'
    and mp.target_key = v_target.target_key
    and mp.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by
    case
      when mp.action_type = 'ACTIVATE' then 0
      else 1
    end,
    mp.created_at desc
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
    'operation', 'UPDATE_STATUS',
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'target_key', v_target.target_key,
    'status', 'ACTIVE',
    'safety_reason', 'organic_boost_reactivate',
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'exposure_snapshot_id', p_snapshot_id,
    'account_day', p_account_day,
    'evidence', p_evidence
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  -- Fresh key namespace so old FAILED hard_cap_day_resume rows cannot trap us.
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || p_policy_id::text || '|' || v_policy.policy_hash || '|'
    || p_account_day::text || '|organic-boost-reactivate-v1|'
    || v_target.target_key || '|' || v_payload_hash
  );

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.idempotency_key = v_idempotency_key;

  if v_existing_plan_id is not null then
    -- If prior terminal, revive; else EXISTING.
    if exists (
      select 1
      from public.mutation_plans mp
      where mp.id = v_existing_plan_id
        and mp.status in (
          'FAILED', 'STALE', 'BLOCKED', 'CANCELLED', 'PREFLIGHT_FAILED'
        )
    ) then
      begin
        alter table public.mutation_plans
          disable trigger guard_meta_mutation_plan_update;
        alter table public.mutation_plan_steps
          disable trigger guard_meta_mutation_step_update;

        update public.mutation_plans mp
        set
          status = 'PENDING',
          attempt_count = 0,
          max_attempts = greatest(coalesce(mp.max_attempts, 1), 5),
          lease_token = null,
          lease_owner = null,
          lease_expires_at = null,
          error_class = null,
          blocked_reason = null,
          terminal_at = null,
          not_before = p_planned_at,
          updated_at = p_planned_at
        where mp.id = v_existing_plan_id;

        update public.mutation_plan_steps step
        set
          status = 'PENDING',
          dispatch_state = 'NOT_DISPATCHED',
          dispatch_started_at = null,
          error_code = null,
          error_detail = null,
          updated_at = p_planned_at
        where step.plan_id = v_existing_plan_id
          and step.status in (
            'FAILED', 'RETRYABLE', 'COMPENSATION_REQUIRED', 'PENDING'
          );

        alter table public.mutation_plan_steps
          enable trigger guard_meta_mutation_step_update;
        alter table public.mutation_plans
          enable trigger guard_meta_mutation_plan_update;
      exception
        when others then
          alter table public.mutation_plan_steps
            enable trigger guard_meta_mutation_step_update;
          alter table public.mutation_plans
            enable trigger guard_meta_mutation_plan_update;
          raise;
      end;

      return jsonb_build_object(
        'outcome', 'CREATED',
        'reason', 'organic_boost_reactivate_revived',
        'plan_id', v_existing_plan_id
      );
    end if;

    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'idempotent_replay',
      'plan_id', v_existing_plan_id
    );
  end if;

  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
    source_rule_key, source_rule_version, action_type, target_type, target_key,
    campaign_scope_key, budget_owner_key, automation_target_id, idempotency_key,
    expected_before, intended_after, planned_payload, payload_hash, status,
    priority, safety_action, not_before, max_attempts, created_at, updated_at
  ) values (
    v_plan_id, p_user_id, p_platform_account_id, p_policy_id,
    p_source_marketing_sync_id, 'organic_boost_reactivate', 1, 'ACTIVATE',
    'CAMPAIGN', v_target.target_key, v_target.campaign_scope_key,
    v_target.budget_owner_key, v_target.id, v_idempotency_key,
    jsonb_build_object(
      'status', coalesce(v_campaign.effective_status, v_campaign.status),
      'source_marketing_sync_id', p_source_marketing_sync_id
    ),
    jsonb_build_object('status', 'ACTIVE'),
    v_payload, v_payload_hash, 'PENDING', 85, true, p_planned_at, 10,
    p_planned_at, p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS',
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'status', 'ACTIVE',
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
    'expected_status', 'ACTIVE',
    'exposure_snapshot_id', p_snapshot_id,
    'safety_action', true,
    'resume_reason', 'organic_boost_reactivate'
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-organic-boost-reactivate', 'VALIDATE', 'CAMPAIGN', null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-organic-boost-reactivate', 'UPDATE', 'CAMPAIGN', v_step_validate,
    v_mutate_request, public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-organic-boost-reactivate', 'READ', 'CAMPAIGN', v_step_mutate,
    v_read_request, public.meta_sha256(v_read_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-organic-boost-reactivate', 'RECONCILE', 'CAMPAIGN', v_step_read,
    v_reconcile_request, public.meta_sha256(v_reconcile_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'), 'NONE', 'PENDING'
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, p_policy_id, v_plan_id,
    null, null, 'SYSTEM', 'meta-budget-planner',
    'ORGANIC_BOOST_REACTIVATE_QUEUED',
    jsonb_build_object(
      'status', coalesce(v_campaign.effective_status, v_campaign.status)
    ),
    v_payload, '{}'::jsonb,
    jsonb_build_object('status', 'ACTIVE', 'plan_status', 'PENDING'),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash,
      'account_day', p_account_day
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'organic_boost_reactivate',
    'plan_id', v_plan_id
  );
end;
$$;

revoke all on function public.queue_meta_organic_boost_reactivate_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, date, jsonb, timestamptz
) from public, anon, authenticated, service_role;

comment on function public.queue_meta_organic_boost_reactivate_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, date, jsonb, timestamptz
) is
  'Queues ACTIVATE for a PAUSED Beitrag-Push campaign without requiring prior hard-cap SAFETY_PAUSE history.';

create or replace function public.force_reactivate_paused_meta_organic_boost_campaigns(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_source_marketing_sync_id uuid,
  p_planned_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_account public.platform_accounts%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_account_day date;
  v_candidate record;
  v_result jsonb;
  v_created integer := 0;
  v_existing integer := 0;
  v_blocked integer := 0;
  v_schedule_ended integer := 0;
  v_candidates integer := 0;
begin
  if p_planned_at < now() - interval '5 minutes'
    or p_planned_at > now() + interval '1 minute' then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'invalid_planner_time',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'schedule_ended', 0,
      'candidates', 0
    );
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'account_unavailable',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'schedule_ended', 0,
      'candidates', 0
    );
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found or not v_policy.allow_status_changes then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'status_changes_not_allowed',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'schedule_ended', 0,
      'candidates', 0
    );
  end if;

  if v_account.marketing_timezone_name is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names tz
      where tz.name = v_account.marketing_timezone_name
    ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'timezone_unavailable',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'schedule_ended', 0,
      'candidates', 0
    );
  end if;

  v_account_day :=
    (p_planned_at at time zone v_account.marketing_timezone_name)::date;

  select s.* into v_snapshot
  from public.daily_budget_exposure_snapshots s
  where s.platform_account_id = p_platform_account_id
    and s.user_id = p_user_id
    and s.account_day = v_account_day
    and s.status = 'COMPLETE'
  order by
    case
      when s.source_marketing_sync_id = p_source_marketing_sync_id then 0
      else 1
    end,
    s.completed_at desc nulls last,
    s.created_at desc
  limit 1;

  -- Snapshot optional for queuing; synthesize null uuid only if missing by using
  -- latest complete snapshot any day, else skip exposure link.
  if not found then
    select s.* into v_snapshot
    from public.daily_budget_exposure_snapshots s
    where s.platform_account_id = p_platform_account_id
      and s.user_id = p_user_id
      and s.status = 'COMPLETE'
    order by s.account_day desc, s.completed_at desc nulls last
    limit 1;
  end if;

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'snapshot_unavailable',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'schedule_ended', 0,
      'candidates', 0
    );
  end if;

  for v_candidate in
    select
      target.id as automation_target_id,
      target.campaign_scope_key,
      c.name as campaign_name,
      c.stop_time
    from public.campaigns c
    join public.automation_targets target
      on target.platform_account_id = c.platform_account_id
     and target.target_type = 'CAMPAIGN'
     and target.platform_object_id = c.platform_campaign_id
     and target.status = 'MANAGED'
    where c.user_id = p_user_id
      and c.platform_account_id = p_platform_account_id
      and c.is_current
      and (
        upper(coalesce(c.status, '')) = 'PAUSED'
        or upper(coalesce(c.effective_status, ''))
          in ('PAUSED', 'CAMPAIGN_PAUSED')
      )
      and exists (
        select 1
        from public.remote_object_bindings binding
        join public.mutation_plans boost_plan
          on boost_plan.id = binding.plan_id
         and boost_plan.user_id = binding.user_id
         and boost_plan.platform_account_id = binding.platform_account_id
        where binding.user_id = p_user_id
          and binding.platform_account_id = p_platform_account_id
          and binding.object_type = 'CAMPAIGN'
          and (
            binding.remote_object_id = c.platform_campaign_id
            or binding.local_campaign_id = c.id
          )
          and boost_plan.source_rule_key = 'organic-boost'
          and boost_plan.action_type = 'LAUNCH_CHAIN'
      )
    order by target.campaign_scope_key
  loop
    v_candidates := v_candidates + 1;

    if v_candidate.stop_time is not null
      and v_candidate.stop_time <= p_planned_at then
      v_schedule_ended := v_schedule_ended + 1;
      v_blocked := v_blocked + 1;
      continue;
    end if;

    v_result := public.queue_meta_organic_boost_reactivate_internal(
      p_user_id,
      p_platform_account_id,
      v_policy.id,
      v_snapshot.id,
      p_source_marketing_sync_id,
      v_candidate.automation_target_id,
      v_account_day,
      jsonb_build_object(
        'account_day', v_account_day,
        'resume_reason', 'organic_boost_reactivate',
        'campaign_scope_key', v_candidate.campaign_scope_key,
        'campaign_name', v_candidate.campaign_name
      ),
      p_planned_at
    );

    if v_result->>'outcome' in ('CREATED', 'QUEUED') then
      v_created := v_created + 1;
    elsif v_result->>'outcome' = 'EXISTING' then
      v_existing := v_existing + 1;
    else
      v_blocked := v_blocked + 1;
    end if;
  end loop;

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    v_policy.id,
    null,
    null,
    null,
    'SYSTEM',
    'meta-budget-planner',
    'ORGANIC_BOOST_FORCE_REACTIVATE',
    '{}'::jsonb,
    jsonb_build_object(
      'snapshot_id', v_snapshot.id,
      'account_day', v_account_day,
      'source_marketing_sync_id', p_source_marketing_sync_id
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'created', v_created,
      'existing', v_existing,
      'blocked', v_blocked,
      'schedule_ended', v_schedule_ended,
      'candidates', v_candidates
    ),
    '{}'::jsonb,
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'OK',
    'reason', 'organic_boost_force_reactivate',
    'created', v_created,
    'existing', v_existing,
    'blocked', v_blocked,
    'schedule_ended', v_schedule_ended,
    'candidates', v_candidates,
    'snapshot_id', v_snapshot.id,
    'account_day', v_account_day
  );
end;
$$;

revoke all on function public.force_reactivate_paused_meta_organic_boost_campaigns(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.force_reactivate_paused_meta_organic_boost_campaigns(
  uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.force_reactivate_paused_meta_organic_boost_campaigns(
  uuid, uuid, uuid, timestamptz
) is
  'Queues ACTIVATE for every current PAUSED Beitrag-Push campaign with remaining schedule, without requiring prior hard-cap SAFETY_PAUSE.';

commit;

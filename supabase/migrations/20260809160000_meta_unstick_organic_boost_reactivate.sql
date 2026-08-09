-- One Beitrag-Push campaign stayed PAUSED at Meta after the bulk reactivate.
-- Likely causes:
-- 1) queue_internal treated ANY pending plan on the target as EXISTING
--    (e.g. leftover SAFETY_PAUSE) and never queued ACTIVATE
-- 2) stuck CLAIMED/EXECUTING ACTIVATE plans were not revived
-- 3) resume drain still considered SAFETY_PAUSE / hard_cap_exposure_breach due
--
-- Fix: cancel blocking non-ACTIVATE status plans, revive stuck ACTIVATE, and
-- only treat healthy ACTIVATE as EXISTING.

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
  v_cancelled_blockers integer := 0;
  v_revived_stuck integer := 0;
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

  if not exists (
    select 1
    from public.meta_organic_boost_links link
    join public.remote_object_bindings binding
      on binding.plan_id = link.plan_id
     and binding.user_id = link.user_id
     and binding.platform_account_id = link.platform_account_id
     and binding.object_type = 'CAMPAIGN'
    where link.user_id = p_user_id
      and link.platform_account_id = p_platform_account_id
      and (
        binding.remote_object_id = v_target.platform_object_id
        or binding.local_campaign_id = v_target.campaign_id
      )
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
  where c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
    and c.platform_campaign_id = v_target.platform_object_id
  for update;

  if not found then
    select c.* into v_campaign
    from public.campaigns c
    where c.id = v_target.campaign_id
      and c.user_id = p_user_id
      and c.platform_account_id = p_platform_account_id
      and c.is_current
    for update;
  end if;

  if found and v_target.campaign_id is distinct from v_campaign.id then
    update public.automation_targets
    set
      campaign_id = v_campaign.id,
      row_version = public.automation_targets.row_version + 1,
      updated_at = p_planned_at
    where id = v_target.id;
    v_target.campaign_id := v_campaign.id;
  end if;

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

  begin
    alter table public.mutation_plans
      disable trigger guard_meta_mutation_plan_update;
    alter table public.mutation_plan_steps
      disable trigger guard_meta_mutation_step_update;

    -- Cancel leftover SAFETY_PAUSE / hard-cap pause plans that block ACTIVATE.
    -- Do not touch LAUNCH_CHAIN or unrelated actions.
    with cancelled as (
      update public.mutation_plans mp
      set
        status = 'CANCELLED',
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        blocked_reason = 'superseded_by_organic_boost_reactivate',
        terminal_at = p_planned_at,
        updated_at = p_planned_at
      where mp.platform_account_id = p_platform_account_id
        and mp.user_id = p_user_id
        and mp.target_type = 'CAMPAIGN'
        and mp.target_key = v_target.target_key
        and (
          mp.action_type = 'SAFETY_PAUSE'
          or mp.source_rule_key = 'hard_cap_exposure_breach'
        )
        and mp.status in (
          'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
          'RETRYABLE', 'COMPENSATION_REQUIRED'
        )
      returning mp.id
    )
    select count(*)::integer into v_cancelled_blockers from cancelled;

    -- Revive terminal + stuck in-flight ACTIVATE plans for this target.
    with revived as (
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
        and (
          mp.status in (
            'FAILED', 'STALE', 'BLOCKED', 'CANCELLED', 'PREFLIGHT_FAILED'
          )
          or (
            mp.status in ('CLAIMED', 'EXECUTING', 'RECONCILING')
            and (
              mp.lease_expires_at is null
              or mp.lease_expires_at < p_planned_at
              or mp.updated_at < p_planned_at - interval '10 minutes'
            )
          )
        )
      returning mp.id
    )
    select count(*)::integer into v_revived_stuck from revived;

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
      and step.status in (
        'FAILED', 'RETRYABLE', 'COMPENSATION_REQUIRED',
        'CLAIMED', 'EXECUTING', 'RECONCILING'
      )
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

  -- Only a live ACTIVATE plan counts as EXISTING (not SAFETY_PAUSE etc.).
  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.platform_account_id = p_platform_account_id
    and mp.target_type = 'CAMPAIGN'
    and mp.target_key = v_target.target_key
    and mp.action_type = 'ACTIVATE'
    and mp.source_rule_key in (
      'hard_cap_day_resume', 'organic_boost_reactivate'
    )
    and mp.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by mp.created_at desc
  limit 1;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'pending_activate_plan',
      'plan_id', v_existing_plan_id,
      'cancelled_blockers', v_cancelled_blockers,
      'revived_stuck', v_revived_stuck
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
  -- v3 namespace so a prior failed idempotent row cannot trap this campaign.
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || p_policy_id::text || '|' || v_policy.policy_hash || '|'
    || p_account_day::text || '|organic-boost-reactivate-v3|'
    || v_target.target_key || '|' || v_payload_hash
  );

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.idempotency_key = v_idempotency_key;

  if v_existing_plan_id is not null then
    if exists (
      select 1
      from public.mutation_plans mp
      where mp.id = v_existing_plan_id
        and mp.status in (
          'FAILED', 'STALE', 'BLOCKED', 'CANCELLED', 'PREFLIGHT_FAILED',
          'SUCCEEDED'
        )
    ) then
      -- SUCCEEDED but Meta still PAUSED → revive for another write.
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
        where step.plan_id = v_existing_plan_id;

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
        'plan_id', v_existing_plan_id,
        'cancelled_blockers', v_cancelled_blockers,
        'revived_stuck', v_revived_stuck
      );
    end if;

    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'idempotent_replay',
      'plan_id', v_existing_plan_id,
      'cancelled_blockers', v_cancelled_blockers,
      'revived_stuck', v_revived_stuck
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
    v_payload, v_payload_hash, 'PENDING', 95, true, p_planned_at, 10,
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
      'status', coalesce(v_campaign.effective_status, v_campaign.status),
      'cancelled_blockers', v_cancelled_blockers,
      'revived_stuck', v_revived_stuck
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
    'plan_id', v_plan_id,
    'cancelled_blockers', v_cancelled_blockers,
    'revived_stuck', v_revived_stuck
  );
end;
$$;

revoke all on function public.queue_meta_organic_boost_reactivate_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, date, jsonb, timestamptz
) from public, anon, authenticated, service_role;

comment on function public.queue_meta_organic_boost_reactivate_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, date, jsonb, timestamptz
) is
  'Queues ACTIVATE for a PAUSED Beitrag-Push campaign; cancels blocking SAFETY_PAUSE plans; revives stuck ACTIVATE.';

commit;

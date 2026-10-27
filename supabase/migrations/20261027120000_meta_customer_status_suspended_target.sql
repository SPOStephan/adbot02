-- Customer Pause/Fortsetzen must work for Adbot-launched campaigns whose
-- automation target is SUSPENDED.
--
-- Every launch projects a MANAGED CAMPAIGN target, but the next planner refresh
-- recomputes its status via resolve_meta_automation_scope_status: without
-- active budget autonomy (or with the campaign deselected in Autonomie) the
-- target becomes SUSPENDED. The customer button then failed with
-- target_not_managed before anything was sent to Meta.
--
-- An explicit customer click is its own authorization for exactly this one
-- campaign status write. So customer_status_change PAUSE/ACTIVATE plans accept
-- a SUSPENDED (never RETIRED) CAMPAIGN target, both when queuing and in the
-- executor claim gate. Policy allow_status_changes, kill switch ALLOW and the
-- before-state check stay mandatory. The autonomous lead underperformer rule
-- and every other plan type keep requiring MANAGED targets, and the target's
-- status is not changed (reconcile keeps it SUSPENDED, so budget automation
-- stays off).

begin;

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
    and (
      target.status = 'MANAGED'
      or (target.status = 'SUSPENDED'
          and p_source_rule_key = 'customer_status_change'
          and p_actor_type = 'CUSTOMER')
    )
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
    and target.status in ('MANAGED', 'SUSPENDED')
  order by (target.status = 'MANAGED') desc, target.updated_at desc
  limit 1;

  if v_target_id is null then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'target_not_managed');
  end if;

  return public.queue_meta_campaign_status_plan_internal(
    p_user_id, p_platform_account_id, v_target_id, p_status,
    'customer_status_change', '{}'::jsonb, 'CUSTOMER', p_user_id::text,
    clock_timestamp()
  );
end;
$$;

comment on function public.queue_meta_campaign_status_plan_internal(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) is
  'Queues a non-safety PAUSE/ACTIVATE plan (VALIDATE/UPDATE_STATUS/READ/RECONCILE) for one MANAGED campaign target (customer_status_change also SUSPENDED) behind the policy and kill-switch gates.';

comment on function public.queue_meta_customer_campaign_status_change(
  uuid, uuid, text, text
) is
  'Queues a customer PAUSE/ACTIVATE plan for an Adbot-launched (active-launch-chain) campaign with a MANAGED or SUSPENDED campaign target; organic-boost campaigns are excluded.';

-- Executor claim gate: accept a SUSPENDED campaign target only for customer
-- PAUSE/ACTIVATE plans. Patched in place so the rest of the claim function
-- (launch yield, queue-safe freeze) stays exactly as deployed.
do $patch$
declare
  v_function regprocedure :=
    'public.claim_meta_mutation_execution(text, integer, uuid)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if v_definition is null then
    raise exception 'claim_meta_mutation_execution not found';
  end if;

  if position('customer_status_change_suspended_target' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'(where at\\.id = v_plan\\.automation_target_id\\s+and at\\.user_id = v_plan\\.user_id\\s+and at\\.platform_account_id = v_plan\\.platform_account_id\\s+)and at\\.status = ''MANAGED''',
    E'\\1-- customer_status_change_suspended_target: an explicit customer click\n'
    || E'        -- may pause/resume its Adbot campaign while budget autonomy is off.\n'
    || E'        and (at.status = ''MANAGED''\n'
    || E'          or (at.status = ''SUSPENDED''\n'
    || E'              and at.target_type = ''CAMPAIGN''\n'
    || E'              and v_plan.source_rule_key = ''customer_status_change''\n'
    || E'              and v_plan.action_type in (''PAUSE'', ''ACTIVATE'')))'
  );

  if v_updated = v_definition then
    raise exception 'claim_meta_mutation_execution target gate not found';
  end if;

  execute v_updated;
end;
$patch$;

commit;

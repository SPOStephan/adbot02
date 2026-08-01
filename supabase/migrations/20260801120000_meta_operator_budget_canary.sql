-- Deterministic one-time budget canary materialization without pretending that
-- a performance recommendation exists. The only allowed intent is a 10 percent
-- budget decrease for exactly one explicitly managed budget owner. The resulting
-- plan remains held by the existing exact-fingerprint confirmation gate.

create or replace function public.guard_meta_budget_canary_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.action_type = 'UPDATE_BUDGET'
    and not old.safety_action
    and old.not_before = 'infinity'::timestamptz
    and new.not_before <> 'infinity'::timestamptz then
    if old.created_at + interval '2 hours' <= now() then
      raise exception 'Budget canary plan has expired';
    end if;

    if not exists (
      select 1
      from public.meta_budget_canary_approvals approval
      where approval.plan_id = old.id
        and approval.user_id = old.user_id
        and approval.platform_account_id = old.platform_account_id
        and approval.payload_hash = old.payload_hash
        and approval.expected_before_minor =
          (old.expected_before ->> 'daily_budget_minor')::bigint
        and approval.intended_after_minor =
          (old.intended_after ->> 'daily_budget_minor')::bigint
    ) then
      raise exception 'Exact budget canary approval is required';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_meta_budget_canary_release
  before update of not_before on public.mutation_plans
  for each row execute function public.guard_meta_budget_canary_release();

create or replace function public.materialize_meta_customer_budget_canary_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_read_lease_token uuid,
  p_reason text,
  p_planned_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_target public.automation_targets%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
  v_existing_plan public.mutation_plans%rowtype;
  v_managed_budget_owner_count integer;
  v_kill_mode text;
  v_write_mode text;
  v_campaign_scope_key text;
  v_current_budget bigint;
  v_remote_status text;
  v_object_sync_id uuid;
  v_intended_budget bigint;
  v_baseline_budget bigint;
  v_movement_used bigint;
  v_movement_limit bigint;
  v_candidate_delta bigint;
  v_latest_change timestamptz;
  v_campaign_total bigint;
  v_account_total bigint;
  v_campaign_cap bigint;
  v_payload jsonb;
  v_payload_hash text;
  v_idempotency_key text;
  v_plan_id uuid := gen_random_uuid();
  v_step_validate uuid := gen_random_uuid();
  v_step_mutate uuid := gen_random_uuid();
  v_step_read uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_validate_request jsonb;
  v_mutate_request jsonb;
  v_read_request jsonb;
  v_reconcile_request jsonb;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if p_planned_at is null
    or p_read_lease_token is null
    or char_length(v_reason) not between 12 and 500
    or v_reason ~ '[[:cntrl:]]' then
    raise exception 'Invalid budget canary request';
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
    and pa.marketing_currency = 'EUR'
    and pa.marketing_sync_status = 'success'
    and pa.marketing_sync_id is not null
    and pa.marketing_last_success_at is not null
    and pa.marketing_last_success_at >= p_planned_at - interval '2 hours'
    and pa.marketing_last_success_at <= p_planned_at + interval '1 minute'
    and 'ads_management' = any(pa.meta_scopes)
  for update;

  if not found then
    raise exception 'Fresh write-ready EUR Meta account is required';
  end if;

  if not exists (
    select 1
    from public.meta_account_operation_leases lease
    where lease.platform_account_id = p_platform_account_id
      and lease.user_id = p_user_id
      and lease.lease_kind = 'READ_SYNC'
      and lease.lease_token = p_read_lease_token
      and lease.expires_at > now()
  ) then
    raise exception 'Active READ_SYNC lease is required';
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
    and ap.currency = 'EUR'
    and ap.allow_budget_changes
    and not ap.allow_status_changes
    and not ap.allow_new_launches
    and ap.account_daily_hard_cap_minor is not null
    and ap.default_campaign_daily_hard_cap_minor is not null
    and ap.budget_change_limit_bps >= 1000
    and ap.cooldown_seconds >= 43200
  for update;

  if not found then
    raise exception 'Budget-only canary policy is required';
  end if;

  select effective.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) effective;

  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'ALLOW' then
    raise exception 'Account writes must be explicitly allowed for the canary';
  end if;

  select mode into v_write_mode
  from public.meta_account_write_modes
  where user_id = p_user_id
    and platform_account_id = p_platform_account_id;

  if coalesce(v_write_mode, 'CONFIRM_EACH_BUDGET') <>
      'CONFIRM_EACH_BUDGET' then
    raise exception 'Per-plan budget confirmation mode is required';
  end if;

  select count(*)::integer into v_managed_budget_owner_count
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.status = 'MANAGED'
    and target.budget_owner_key is not null;

  if v_managed_budget_owner_count <> 1 then
    raise exception 'Exactly one managed budget owner is required for the canary';
  end if;

  select target.* into v_target
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.status = 'MANAGED'
    and target.target_type in ('CAMPAIGN', 'AD_SET')
    and target.budget_owner_type = target.target_type
    and target.budget_owner_key = target.target_key
  order by target.created_at, target.id
  limit 1
  for update;

  if not found then
    raise exception 'Managed canary budget owner is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':budget-owner:' || v_target.budget_owner_key,
      0
    )
  );

  if v_target.target_type = 'CAMPAIGN' then
    select
      'campaign:' || campaign.platform_campaign_id,
      campaign.daily_budget_minor,
      coalesce(campaign.effective_status, campaign.status, 'UNKNOWN'),
      campaign.last_seen_sync_id
    into
      v_campaign_scope_key,
      v_current_budget,
      v_remote_status,
      v_object_sync_id
    from public.campaigns campaign
    where campaign.id = v_target.campaign_id
      and campaign.user_id = p_user_id
      and campaign.platform_account_id = p_platform_account_id
      and campaign.is_current;
  else
    select
      'campaign:' || campaign.platform_campaign_id,
      ad_set.daily_budget_minor,
      coalesce(ad_set.effective_status, ad_set.status, 'UNKNOWN'),
      ad_set.last_seen_sync_id
    into
      v_campaign_scope_key,
      v_current_budget,
      v_remote_status,
      v_object_sync_id
    from public.ad_groups ad_set
    join public.campaigns campaign on campaign.id = ad_set.campaign_id
    where ad_set.id = v_target.ad_group_id
      and ad_set.user_id = p_user_id
      and ad_set.platform_account_id = p_platform_account_id
      and ad_set.is_current
      and campaign.is_current;
  end if;

  if v_current_budget is null
    or v_current_budget <= 1
    or v_object_sync_id is distinct from v_account.marketing_sync_id
    or v_remote_status <> 'ACTIVE' then
    raise exception 'Selected budget owner is stale or inactive';
  end if;

  select snapshot.* into v_snapshot
  from public.daily_budget_exposure_snapshots snapshot
  where snapshot.user_id = p_user_id
    and snapshot.platform_account_id = p_platform_account_id
    and snapshot.policy_id = v_policy.id
    and snapshot.source_marketing_sync_id = v_account.marketing_sync_id
    and snapshot.status = 'COMPLETE'
    and snapshot.currency = 'EUR'
  order by snapshot.completed_at desc, snapshot.created_at desc
  limit 1
  for share;

  if not found then
    raise exception 'Complete current exposure snapshot is required';
  end if;

  select exposure.* into v_exposure
  from public.daily_budget_exposures exposure
  where exposure.user_id = p_user_id
    and exposure.platform_account_id = p_platform_account_id
    and exposure.policy_id = v_policy.id
    and exposure.snapshot_id = v_snapshot.id
    and exposure.account_day = v_snapshot.account_day
    and exposure.budget_owner_key = v_target.budget_owner_key
    and exposure.automation_target_id = v_target.id
    and exposure.currency = 'EUR'
    and exposure.source = 'SNAPSHOT'
  for share;

  if not found then
    raise exception 'Current canary exposure is missing';
  end if;

  select coalesce(sum(exposure.reserved_exposure_minor), 0)
    into v_campaign_total
  from public.daily_budget_exposures exposure
  where exposure.platform_account_id = p_platform_account_id
    and exposure.account_day = v_snapshot.account_day
    and exposure.campaign_scope_key = v_campaign_scope_key;

  select coalesce(sum(exposure.reserved_exposure_minor), 0)
    into v_account_total
  from public.daily_budget_exposures exposure
  where exposure.platform_account_id = p_platform_account_id
    and exposure.account_day = v_snapshot.account_day;

  select coalesce(
    campaign_limit.daily_hard_cap_minor,
    v_policy.default_campaign_daily_hard_cap_minor
  ) into v_campaign_cap
  from (select 1) seed
  left join public.campaign_budget_limits campaign_limit
    on campaign_limit.policy_id = v_policy.id
   and campaign_limit.user_id = p_user_id
   and campaign_limit.platform_account_id = p_platform_account_id
   and campaign_limit.campaign_scope_key = v_campaign_scope_key;

  if v_campaign_total > v_campaign_cap
    or v_account_total > v_policy.account_daily_hard_cap_minor then
    raise exception 'Current exposure exceeds a customer hard cap';
  end if;

  select existing.* into v_existing_plan
  from public.mutation_plans existing
  where existing.user_id = p_user_id
    and existing.platform_account_id = p_platform_account_id
    and not existing.safety_action
    and existing.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by existing.created_at desc
  limit 1;

  if found then
    if v_existing_plan.action_type = 'UPDATE_BUDGET'
      and v_existing_plan.automation_target_id = v_target.id then
      return jsonb_build_object(
        'outcome', 'EXISTING',
        'plan_id', v_existing_plan.id,
        'status', v_existing_plan.status
      );
    end if;
    raise exception 'Another non-safety Meta mutation is active';
  end if;

  select
    max(ledger.executed_at),
    coalesce(sum(ledger.absolute_delta_minor), 0)
  into v_latest_change, v_movement_used
  from public.budget_mutation_ledger ledger
  where ledger.platform_account_id = p_platform_account_id
    and ledger.budget_owner_key = v_target.budget_owner_key
    and ledger.executed_at > p_planned_at - interval '24 hours'
    and ledger.executed_at <= p_planned_at;

  if v_target.last_successful_mutation_at is not null
    and (
      v_latest_change is null
      or v_target.last_successful_mutation_at > v_latest_change
    ) then
    v_latest_change := v_target.last_successful_mutation_at;
  end if;

  if v_latest_change is not null
    and v_latest_change + make_interval(secs => v_policy.cooldown_seconds)
      > p_planned_at then
    raise exception 'Budget owner is inside the cooldown window';
  end if;

  select ledger.before_budget_minor into v_baseline_budget
  from public.budget_mutation_ledger ledger
  where ledger.platform_account_id = p_platform_account_id
    and ledger.budget_owner_key = v_target.budget_owner_key
    and ledger.executed_at > p_planned_at - interval '24 hours'
    and ledger.executed_at <= p_planned_at
  order by ledger.executed_at, ledger.created_at
  limit 1;

  v_baseline_budget := coalesce(v_baseline_budget, v_current_budget);
  v_movement_limit :=
    (v_baseline_budget * v_policy.budget_change_limit_bps) / 10000;
  v_intended_budget :=
    (v_current_budget * 9000 + 9999) / 10000;

  if v_intended_budget >= v_current_budget then
    v_intended_budget := v_current_budget - 1;
  end if;

  v_candidate_delta := v_current_budget - v_intended_budget;

  if v_intended_budget <= 0
    or v_movement_limit <= 0
    or v_movement_used + v_candidate_delta > v_movement_limit then
    raise exception 'Budget canary exceeds the rolling 24-hour limit';
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'operation', 'UPDATE_BUDGET',
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'target_key', v_target.target_key,
    'budget_type', 'daily_budget',
    'amount_minor', v_intended_budget,
    'direction', 'DECREASE',
    'change_bps', 1000,
    'rule_key', 'operator_budget_canary_v1',
    'rule_version', 1,
    'source_marketing_sync_id', v_account.marketing_sync_id,
    'exposure_snapshot_id', v_snapshot.id,
    'evidence', jsonb_build_object(
      'source', 'customer_one_time_canary',
      'reason', v_reason,
      'requested_at', p_planned_at
    )
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || v_policy.id::text || '|' || v_policy.policy_hash || '|'
    || v_account.marketing_sync_id::text || '|operator_budget_canary_v1|1|'
    || v_target.target_type || '|' || v_target.target_key || '|'
    || v_current_budget::text || '|' || v_intended_budget::text || '|'
    || v_payload_hash
  );

  select existing.* into v_existing_plan
  from public.mutation_plans existing
  where existing.idempotency_key = v_idempotency_key;

  if found then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'plan_id', v_existing_plan.id,
      'status', v_existing_plan.status
    );
  end if;

  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id,
    source_marketing_sync_id, source_recommendation_id,
    source_rule_key, source_rule_version, action_type, target_type,
    target_key, campaign_scope_key, budget_owner_key,
    automation_target_id, idempotency_key, expected_before,
    intended_after, planned_payload, payload_hash, status, priority,
    safety_action, not_before, max_attempts, created_at, updated_at
  ) values (
    v_plan_id, p_user_id, p_platform_account_id, v_policy.id,
    v_account.marketing_sync_id, null,
    'operator_budget_canary_v1', 1, 'UPDATE_BUDGET', v_target.target_type,
    v_target.target_key, v_campaign_scope_key, v_target.budget_owner_key,
    v_target.id, v_idempotency_key,
    jsonb_build_object(
      'daily_budget_minor', v_current_budget,
      'status', v_remote_status,
      'source_marketing_sync_id', v_account.marketing_sync_id
    ),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    v_payload, v_payload_hash, 'PENDING', 90,
    false, p_planned_at, 1, p_planned_at, p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_BUDGET',
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'budget_type', 'daily_budget',
    'amount_minor', v_intended_budget,
    'mode', 'validate_only'
  );
  v_mutate_request :=
    v_validate_request || jsonb_build_object('mode', 'execute');
  v_read_request := jsonb_build_object(
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'fields', jsonb_build_array(
      'id', 'status', 'effective_status', 'daily_budget', 'updated_time'
    )
  );
  v_reconcile_request := jsonb_build_object(
    'expected_daily_budget_minor', v_intended_budget,
    'budget_owner_key', v_target.budget_owner_key,
    'exposure_snapshot_id', v_snapshot.id
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-budget-update', 'VALIDATE', v_target.target_type, null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-budget-update', 'UPDATE', v_target.target_type,
    v_step_validate, v_mutate_request,
    public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    'PAUSE', 'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-budget-update', 'READ', v_target.target_type,
    v_step_mutate, v_read_request,
    public.meta_sha256(v_read_request::text),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-budget-update', 'RECONCILE', v_target.target_type,
    v_step_read, v_reconcile_request,
    public.meta_sha256(v_reconcile_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'),
    'NONE', 'PENDING'
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    v_policy.id,
    v_plan_id,
    null,
    null,
    'CUSTOMER',
    p_user_id::text,
    'BUDGET_CANARY_PLAN_MATERIALIZED',
    jsonb_build_object(
      'daily_budget_minor', v_current_budget,
      'status', v_remote_status
    ),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object(
      'daily_budget_minor', v_intended_budget,
      'plan_status', 'PENDING',
      'not_before', 'infinity'
    ),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash,
      'remote_write_performed', false
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'plan_id', v_plan_id,
    'status', 'PENDING',
    'before_budget_minor', v_current_budget,
    'after_budget_minor', v_intended_budget,
    'payload_hash', v_payload_hash
  );
end;
$$;

revoke all on function public.guard_meta_budget_canary_release()
  from public, anon, authenticated, service_role;
revoke all on function public.materialize_meta_customer_budget_canary_plan(
  uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.materialize_meta_customer_budget_canary_plan(
  uuid, uuid, uuid, text, timestamptz
) to service_role;

comment on function public.materialize_meta_customer_budget_canary_plan(
  uuid, uuid, uuid, text, timestamptz
) is
  'Materializes one fixed 10 percent budget-decrease canary for exactly one managed active budget owner. It performs no remote mutation and remains held until exact customer approval.';

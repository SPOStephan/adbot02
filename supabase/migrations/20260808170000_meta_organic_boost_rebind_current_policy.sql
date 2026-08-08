-- After hard-cap / policy rotation, organic-boost LAUNCH_CHAIN plans keep the
-- old policy_id + expected_before hash/snapshot. Preflight and claim_next both
-- require policy.is_current → due=1, preflight_ok=0, then idle / policy_inactive.
-- Rebind due AUTO plans to the current policy + COMPLETE snapshot, move their
-- exposure rows, reset non-SUCCEEDED steps, and surface failing preflight checks.
-- SUCCEEDED create-* steps and remote_object_bindings stay intact.

begin;

-- ---------------------------------------------------------------------------
-- 1) Allowlisted intent rebind via transaction-local GUC
-- ---------------------------------------------------------------------------
create or replace function public.guard_meta_mutation_plan_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.meta_organic_rebind', true) = '1'
    and old.source_rule_key = 'organic-boost'
    and old.action_type = 'LAUNCH_CHAIN' then
    if new.user_id is distinct from old.user_id
      or new.platform_account_id is distinct from old.platform_account_id
      or new.source_marketing_sync_id is distinct from old.source_marketing_sync_id
      or new.source_recommendation_id is distinct from old.source_recommendation_id
      or new.source_rule_key is distinct from old.source_rule_key
      or new.source_rule_version is distinct from old.source_rule_version
      or new.action_type is distinct from old.action_type
      or new.target_type is distinct from old.target_type
      or new.target_key is distinct from old.target_key
      or new.campaign_scope_key is distinct from old.campaign_scope_key
      or new.budget_owner_key is distinct from old.budget_owner_key
      or new.automation_target_id is distinct from old.automation_target_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.intended_after is distinct from old.intended_after
      or new.planned_payload is distinct from old.planned_payload
      or new.payload_hash is distinct from old.payload_hash
      or new.safety_action is distinct from old.safety_action
      or new.created_at is distinct from old.created_at then
      raise exception 'Mutation plan intent is immutable';
    end if;
    -- policy_id + expected_before may change under organic rebind.
    return new;
  end if;

  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.policy_id is distinct from old.policy_id
    or new.source_marketing_sync_id is distinct from old.source_marketing_sync_id
    or new.source_recommendation_id is distinct from old.source_recommendation_id
    or new.source_rule_key is distinct from old.source_rule_key
    or new.source_rule_version is distinct from old.source_rule_version
    or new.action_type is distinct from old.action_type
    or new.target_type is distinct from old.target_type
    or new.target_key is distinct from old.target_key
    or new.campaign_scope_key is distinct from old.campaign_scope_key
    or new.budget_owner_key is distinct from old.budget_owner_key
    or new.automation_target_id is distinct from old.automation_target_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.expected_before is distinct from old.expected_before
    or new.intended_after is distinct from old.intended_after
    or new.planned_payload is distinct from old.planned_payload
    or new.payload_hash is distinct from old.payload_hash
    or new.safety_action is distinct from old.safety_action
    or new.created_at is distinct from old.created_at then
    raise exception 'Mutation plan intent is immutable';
  end if;

  return new;
end;
$$;

create or replace function public.guard_meta_exposure_non_decreasing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.meta_organic_rebind', true) = '1' then
    if new.user_id is distinct from old.user_id
      or new.platform_account_id is distinct from old.platform_account_id
      or new.campaign_scope_key is distinct from old.campaign_scope_key
      or new.budget_owner_key is distinct from old.budget_owner_key
      or new.budget_owner_type is distinct from old.budget_owner_type
      or (old.shared_budget_enabled and not new.shared_budget_enabled)
      or new.currency is distinct from old.currency
      or new.max_daily_budget_minor < old.max_daily_budget_minor
      or new.flex_spend_multiplier_bps < old.flex_spend_multiplier_bps
      or new.created_at is distinct from old.created_at then
      raise exception 'Daily budget exposure identity and maxima cannot decrease';
    end if;
    -- policy_id / snapshot_id / account_day may move with organic rebind.
    return new;
  end if;

  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.policy_id is distinct from old.policy_id
    or new.snapshot_id is distinct from old.snapshot_id
    or new.account_day is distinct from old.account_day
    or new.campaign_scope_key is distinct from old.campaign_scope_key
    or new.budget_owner_key is distinct from old.budget_owner_key
    or new.budget_owner_type is distinct from old.budget_owner_type
    or (old.shared_budget_enabled and not new.shared_budget_enabled)
    or new.currency is distinct from old.currency
    or new.max_daily_budget_minor < old.max_daily_budget_minor
    or new.flex_spend_multiplier_bps < old.flex_spend_multiplier_bps
    or new.created_at is distinct from old.created_at then
    raise exception 'Daily budget exposure identity and maxima cannot decrease';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Per-plan preflight diagnosis (owner-facing)
-- ---------------------------------------------------------------------------
create or replace function public.diagnose_meta_organic_boost_plan_preflight(
  p_plan_id uuid
)
returns table (
  check_name text,
  ok boolean,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_policy public.automation_policies%rowtype;
  v_current public.automation_policies%rowtype;
  v_account public.platform_accounts%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_kill text;
  v_failed_steps text;
begin
  select * into v_plan from public.mutation_plans where id = p_plan_id;
  if not found then
    return query select 'plan_exists'::text, false, 'plan not found'::text;
    return;
  end if;

  return query select
    'organic_launch'::text,
    v_plan.source_rule_key = 'organic-boost'
      and v_plan.action_type = 'LAUNCH_CHAIN'
      and not v_plan.safety_action,
    format('source=%s action=%s', v_plan.source_rule_key, v_plan.action_type);

  select * into v_account
  from public.platform_accounts account
  where account.id = v_plan.platform_account_id
    and account.user_id = v_plan.user_id;

  return query select
    'marketing_ready'::text,
    v_account.revoked_at is null
      and v_account.marketing_currency = 'EUR'
      and v_account.marketing_sync_id is not null
      and v_account.marketing_last_success_at is not null
      and v_account.marketing_last_success_at >= now() - interval '48 hours'
      and v_account.marketing_last_success_at <= now() + interval '1 minute'
      and 'ads_management' = any(v_account.meta_scopes)
      and nullif(v_account.marketing_meta_ad_account_id, '') is not null,
    format(
      'last_success=%s sync=%s',
      coalesce(v_account.marketing_last_success_at::text, 'null'),
      coalesce(v_account.marketing_sync_id::text, 'null')
    );

  select * into v_policy
  from public.automation_policies policy
  where policy.id = v_plan.policy_id;

  select * into v_current
  from public.automation_policies policy
  where policy.user_id = v_plan.user_id
    and policy.platform_account_id = v_plan.platform_account_id
    and policy.is_current
    and policy.status = 'ACTIVE'
  order by policy.version desc
  limit 1;

  return query select
    'policy_current'::text,
    v_policy.id is not null
      and v_policy.is_current
      and v_policy.status = 'ACTIVE'
      and v_policy.allow_new_launches
      and v_policy.allow_status_changes,
    format(
      'plan_policy=%s current=%s is_current=%s',
      coalesce(v_plan.policy_id::text, 'null'),
      coalesce(v_current.id::text, 'null'),
      coalesce(v_policy.is_current::text, 'null')
    );

  return query select
    'policy_hash'::text,
    v_policy.policy_hash is not null
      and v_policy.policy_hash = v_plan.expected_before->>'policy_hash',
    format(
      'expected=%s actual=%s',
      coalesce(v_plan.expected_before->>'policy_hash', 'null'),
      coalesce(v_policy.policy_hash, 'null')
    );

  begin
    select * into v_snapshot
    from public.daily_budget_exposure_snapshots snapshot
    where snapshot.id = (v_plan.expected_before->>'exposure_snapshot_id')::uuid;
  exception when others then
    v_snapshot := null;
  end;

  return query select
    'snapshot'::text,
    v_snapshot.id is not null
      and v_snapshot.status = 'COMPLETE'
      and v_snapshot.policy_id = v_plan.policy_id
      and v_snapshot.currency = 'EUR',
    format(
      'snapshot=%s status=%s snapshot_policy=%s',
      coalesce(v_plan.expected_before->>'exposure_snapshot_id', 'null'),
      coalesce(v_snapshot.status, 'missing'),
      coalesce(v_snapshot.policy_id::text, 'null')
    );

  return query select
    'exposure'::text,
    exists (
      select 1
      from public.daily_budget_exposures exposure
      where exposure.plan_id = v_plan.id
        and exposure.user_id = v_plan.user_id
        and exposure.platform_account_id = v_plan.platform_account_id
        and exposure.policy_id = v_plan.policy_id
        and exposure.snapshot_id = v_snapshot.id
        and exposure.source in ('PLAN', 'RECONCILIATION')
    ),
    'plan exposure row must match policy+snapshot';

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    v_plan.user_id, v_plan.platform_account_id, v_plan.id
  ) ks;

  return query select
    'kill_switch'::text,
    coalesce(v_kill, 'FREEZE_WRITES') = 'ALLOW',
    coalesce(v_kill, 'FREEZE_WRITES');

  select string_agg(step.step_key, ',' order by step.step_index)
    into v_failed_steps
  from public.mutation_plan_steps step
  where step.plan_id = v_plan.id
    and (
      public.meta_sha256(step.planned_request::text) <> step.request_hash
      or step.dispatch_state = 'REMOTE_UNKNOWN'
      or step.status in ('COMPENSATION_REQUIRED', 'FAILED')
    );

  return query select
    'steps_ok'::text,
    v_failed_steps is null,
    coalesce(v_failed_steps, 'none');

  return query select
    'preflight_ok'::text,
    public.meta_launch_canary_preflight_ok(v_plan.id),
    'aggregate meta_launch_canary_preflight_ok';
end;
$$;

revoke all on function public.diagnose_meta_organic_boost_plan_preflight(uuid)
  from public, anon, authenticated;
grant execute on function public.diagnose_meta_organic_boost_plan_preflight(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3) Rebind due organic plans onto current policy + snapshot + exposures
-- ---------------------------------------------------------------------------
create or replace function public.rebind_meta_organic_boost_plans_to_current_policy(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_count integer := 0;
  v_sync_id uuid;
begin
  select * into v_account
  from public.platform_accounts account
  where account.id = p_platform_account_id
    and account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null;

  if not found then
    raise exception 'Meta account operation scope is invalid';
  end if;

  select * into v_policy
  from public.automation_policies policy
  where policy.user_id = p_user_id
    and policy.platform_account_id = p_platform_account_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.currency = 'EUR'
    and policy.allow_new_launches
    and policy.allow_status_changes
  order by policy.version desc
  limit 1;

  if not found then
    return 0;
  end if;

  v_sync_id := coalesce(
    v_account.marketing_sync_id,
    (
      select snapshot.source_marketing_sync_id
      from public.daily_budget_exposure_snapshots snapshot
      where snapshot.platform_account_id = p_platform_account_id
        and snapshot.user_id = p_user_id
        and snapshot.source_marketing_sync_id is not null
      order by snapshot.completed_at desc nulls last, snapshot.created_at desc
      limit 1
    )
  );

  if v_sync_id is null then
    return 0;
  end if;

  v_snapshot := public.ensure_meta_organic_boost_exposure_snapshot(
    p_platform_account_id,
    p_user_id,
    v_policy.id,
    v_sync_id,
    null,
    now()
  );

  if v_snapshot.id is null or v_snapshot.status is distinct from 'COMPLETE' then
    return 0;
  end if;

  perform set_config('app.meta_organic_rebind', '1', true);

  for v_plan in
    select mp.*
    from public.mutation_plans mp
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
      and mp.status in (
        'PENDING', 'RETRYABLE', 'FAILED', 'STALE', 'BLOCKED', 'PREFLIGHT_FAILED'
      )
      and (
        mp.policy_id is distinct from v_policy.id
        or coalesce(mp.expected_before->>'policy_hash', '')
             is distinct from v_policy.policy_hash
        or coalesce(mp.expected_before->>'exposure_snapshot_id', '')
             is distinct from v_snapshot.id::text
        or coalesce(mp.blocked_reason, '') in (
          'policy_inactive',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'account_operation_lease_busy',
          'superseded_by_marketing_snapshot'
        )
        or exists (
          select 1
          from public.mutation_plan_steps step
          where step.plan_id = mp.id
            and step.status in (
              'FAILED', 'RETRYABLE', 'CLAIMED', 'RUNNING',
              'COMPENSATION_REQUIRED', 'STALE'
            )
        )
      )
  loop
    update public.mutation_plans mp
    set
      policy_id = v_policy.id,
      expected_before = jsonb_set(
        jsonb_set(
          coalesce(mp.expected_before, '{}'::jsonb),
          '{policy_hash}',
          to_jsonb(v_policy.policy_hash),
          true
        ),
        '{exposure_snapshot_id}',
        to_jsonb(v_snapshot.id::text),
        true
      ),
      status = 'PENDING',
      attempt_count = greatest(
        0,
        coalesce((
          select max(me.attempt_number)
          from public.mutation_executions me
          where me.plan_id = mp.id
        ), 0)
      ),
      max_attempts = greatest(
        coalesce(mp.max_attempts, 1),
        3,
        coalesce((
          select max(me.attempt_number)
          from public.mutation_executions me
          where me.plan_id = mp.id
        ), 0) + 3
      ),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      error_class = null,
      blocked_reason = null,
      terminal_at = null,
      not_before = least(coalesce(mp.not_before, now()), now()),
      updated_at = now()
    where mp.id = v_plan.id;

    update public.daily_budget_exposures exposure
    set
      policy_id = v_policy.id,
      snapshot_id = v_snapshot.id,
      account_day = v_snapshot.account_day,
      updated_at = now()
    where exposure.plan_id = v_plan.id
      and exposure.user_id = p_user_id
      and exposure.platform_account_id = p_platform_account_id;

    update public.mutation_plan_steps mps
    set
      status = 'PENDING',
      dispatch_state = 'NOT_DISPATCHED',
      dispatch_started_at = null,
      remote_applied_at = null,
      remote_request_id = null,
      response_fingerprint = null,
      validation_fingerprint = null,
      validated_at = null,
      started_at = null,
      error_class = null,
      error_code = null,
      error_detail = null,
      attempt_count = 0,
      completed_at = null,
      updated_at = now()
    where mps.plan_id = v_plan.id
      and mps.status in (
        'FAILED', 'RETRYABLE', 'CLAIMED', 'RUNNING',
        'COMPENSATION_REQUIRED', 'STALE'
      );

    v_count := v_count + 1;
  end loop;

  perform set_config('app.meta_organic_rebind', '0', true);
  return v_count;
exception
  when others then
    perform set_config('app.meta_organic_rebind', '0', true);
    raise;
end;
$$;

revoke all on function public.rebind_meta_organic_boost_plans_to_current_policy(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rebind_meta_organic_boost_plans_to_current_policy(uuid, uuid)
  to service_role;

comment on function public.rebind_meta_organic_boost_plans_to_current_policy(uuid, uuid) is
  'Rebinds organic-boost plans to current policy/snapshot/exposures; keeps SUCCEEDED create steps and Meta bindings.';

-- ---------------------------------------------------------------------------
-- 4) Revive: also policy_inactive + RETRYABLE step reset
-- ---------------------------------------------------------------------------
create or replace function public.revive_meta_organic_boost_superseded_plans(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta account operation scope is invalid';
  end if;

  update public.mutation_plans mp
  set
    status = 'PENDING',
    attempt_count = greatest(
      0,
      coalesce((
        select max(me.attempt_number)
        from public.mutation_executions me
        where me.plan_id = mp.id
      ), 0)
    ),
    max_attempts = greatest(
      coalesce(mp.max_attempts, 1),
      3,
      coalesce((
        select max(me.attempt_number)
        from public.mutation_executions me
        where me.plan_id = mp.id
      ), 0) + 3
    ),
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_class = null,
    blocked_reason = null,
    terminal_at = null,
    not_before = least(coalesce(mp.not_before, now()), now()),
    updated_at = now()
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
    and (
      (
        mp.status = 'STALE'
        and coalesce(mp.blocked_reason, '') = 'superseded_by_marketing_snapshot'
      )
      or (
        mp.status in ('PENDING', 'RETRYABLE')
        and coalesce(mp.blocked_reason, '') in (
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_marketing_sync_stale',
          'organic_preflight_not_ready',
          'superseded_by_marketing_snapshot',
          'account_operation_lease_busy'
        )
      )
      or (
        mp.status = 'BLOCKED'
        and coalesce(mp.blocked_reason, '') in (
          'organic_preflight_kill_switch',
          'writes_frozen',
          'policy_inactive'
        )
      )
      or (
        mp.status = 'FAILED'
        and coalesce(mp.error_class, '') in ('META', 'PREFLIGHT', 'POLICY')
      )
    );

  get diagnostics v_count = row_count;

  update public.mutation_plan_steps mps
  set
    status = 'PENDING',
    dispatch_state = 'NOT_DISPATCHED',
    dispatch_started_at = null,
    remote_applied_at = null,
    remote_request_id = null,
    response_fingerprint = null,
    validation_fingerprint = null,
    validated_at = null,
    started_at = null,
    error_class = null,
    error_code = null,
    error_detail = null,
    attempt_count = 0,
    completed_at = null,
    updated_at = now()
  from public.mutation_plans mp
  where mps.plan_id = mp.id
    and mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.status in ('PENDING', 'RETRYABLE')
    and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
    and mps.status in (
      'FAILED', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'COMPENSATION_REQUIRED', 'STALE'
    );

  return v_count;
end;
$$;

revoke all on function public.revive_meta_organic_boost_superseded_plans(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revive_meta_organic_boost_superseded_plans(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5) prepare: rebind + revive before counting preflight
-- OUT columns changed (rebound_plans, preflight_blocker) → DROP first.
-- ---------------------------------------------------------------------------
drop function if exists public.prepare_meta_organic_boost_write_now(uuid, uuid);

create or replace function public.prepare_meta_organic_boost_write_now(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns table (
  due_plans integer,
  lease_user_id uuid,
  account_user_id uuid,
  lease_idle boolean,
  lease_user_matches boolean,
  kill_switch_mode text,
  preflight_ok_count integer,
  rebound_plans integer,
  preflight_blocker text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kill text;
  v_due integer := 0;
  v_preflight_ok integer := 0;
  v_rebound integer := 0;
  v_blocker text := null;
  v_lease_user uuid;
  v_account_user uuid;
  v_expires timestamptz;
  v_plan_id uuid;
begin
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta account operation scope is invalid';
  end if;

  perform public.heal_meta_account_operation_lease(
    p_platform_account_id, p_user_id
  );

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  begin
    v_rebound := public.rebind_meta_organic_boost_plans_to_current_policy(
      p_user_id, p_platform_account_id
    );
  exception
    when others then
      v_rebound := 0;
  end;

  begin
    perform public.revive_meta_organic_boost_superseded_plans(
      p_user_id, p_platform_account_id
    );
  exception
    when others then
      null;
  end;

  if coalesce(v_kill, 'FREEZE_WRITES') = 'ALLOW' then
    update public.mutation_plans mp
    set
      status = 'PENDING',
      not_before = least(coalesce(mp.not_before, now()), now()),
      blocked_reason = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive'
        ) then null
        else mp.blocked_reason
      end,
      error_class = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive'
        ) then null
        else mp.error_class
      end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = null,
      updated_at = now()
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in ('PENDING', 'RETRYABLE');
  end if;

  select count(*)::integer into v_due
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and mp.attempt_count < mp.max_attempts;

  select count(*)::integer into v_preflight_ok
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and public.meta_launch_canary_preflight_ok(mp.id);

  if v_due > 0 and v_preflight_ok < 1 then
    select mp.id into v_plan_id
    from public.mutation_plans mp
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in ('PENDING', 'RETRYABLE')
      and mp.not_before <= now()
    order by mp.created_at asc
    limit 1;

    if v_plan_id is not null then
      select string_agg(d.check_name, ',' order by d.check_name)
        into v_blocker
      from public.diagnose_meta_organic_boost_plan_preflight(v_plan_id) d
      where d.ok is not true
        and d.check_name <> 'preflight_ok';
    end if;
  end if;

  select lease.user_id, lease.expires_at, account.user_id
    into v_lease_user, v_expires, v_account_user
  from public.platform_accounts account
  left join public.meta_account_operation_leases lease
    on lease.platform_account_id = account.id
  where account.id = p_platform_account_id
    and account.user_id = p_user_id;

  return query select
    v_due,
    v_lease_user,
    v_account_user,
    (v_expires is null or v_expires <= now()),
    (v_lease_user is not distinct from v_account_user),
    coalesce(v_kill, 'FREEZE_WRITES'),
    v_preflight_ok,
    v_rebound,
    v_blocker;
end;
$$;

revoke all on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  to service_role;

comment on function public.prepare_meta_organic_boost_write_now(uuid, uuid) is
  'Heals lease, rebinds organic plans to current policy, revives soft blocks, reports preflight blockers.';

-- ---------------------------------------------------------------------------
-- 6) diagnose: include rebound + first preflight blocker
-- ---------------------------------------------------------------------------
create or replace function public.diagnose_meta_organic_boost_write_now(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns table (
  check_name text,
  ok boolean,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prep record;
  v_lease_token uuid;
  v_idle_reclaim boolean;
  v_plan_id uuid;
begin
  select position(
    'and (expires_at is null or expires_at <= now())'
    in pg_get_functiondef(
      'public.claim_meta_account_operation(uuid,uuid,text,text,integer)'::regprocedure
    )
  ) > 0
  and position(
    'and user_id = p_user_id'
    in pg_get_functiondef(
      'public.claim_meta_account_operation(uuid,uuid,text,text,integer)'::regprocedure
    )
  ) = 0
  into v_idle_reclaim;

  return query select
    'idle_lease_reclaim_applied'::text,
    coalesce(v_idle_reclaim, false),
    case
      when coalesce(v_idle_reclaim, false) then 'claim_meta_account_operation reclaimt idle leases'
      else 'ALTE claim_meta_account_operation — Migration nicht angewendet'
    end;

  select * into v_prep
  from public.prepare_meta_organic_boost_write_now(
    p_user_id, p_platform_account_id
  );

  return query select
    'kill_switch'::text,
    v_prep.kill_switch_mode = 'ALLOW',
    v_prep.kill_switch_mode;

  return query select
    'due_plans'::text,
    v_prep.due_plans > 0,
    v_prep.due_plans::text;

  return query select
    'preflight_ok_plans'::text,
    v_prep.preflight_ok_count > 0,
    format('%s of %s due plans pass preflight', v_prep.preflight_ok_count, v_prep.due_plans);

  return query select
    'rebound_plans'::text,
    coalesce(v_prep.rebound_plans, 0) >= 0,
    coalesce(v_prep.rebound_plans, 0)::text;

  if coalesce(v_prep.preflight_blocker, '') <> '' then
    return query select
      'preflight_blocker'::text,
      false,
      v_prep.preflight_blocker;
  end if;

  select mp.id into v_plan_id
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and not public.meta_launch_canary_preflight_ok(mp.id)
  order by mp.created_at asc
  limit 1;

  if v_plan_id is not null then
    return query
    select
      ('plan:' || d.check_name)::text,
      d.ok,
      d.detail
    from public.diagnose_meta_organic_boost_plan_preflight(v_plan_id) d;
  end if;

  return query select
    'lease_idle'::text,
    coalesce(v_prep.lease_idle, false),
    case
      when v_prep.lease_idle then 'lease idle'
      else 'lease held — WRITE blocked until release/expiry'
    end;

  return query select
    'lease_user_matches'::text,
    coalesce(v_prep.lease_user_matches, false),
    format('lease=%s account=%s', v_prep.lease_user_id, v_prep.account_user_id);

  v_lease_token := public.claim_meta_account_operation(
    p_platform_account_id,
    p_user_id,
    'WRITE_EXECUTION',
    'diagnose-organic-boost-write-now',
    120
  );

  return query select
    'lease_claim'::text,
    v_lease_token is not null,
    case
      when v_lease_token is null then 'claim_meta_account_operation returned null — Meta-Write unmöglich'
      else 'WRITE lease ok (sofort wieder freigegeben)'
    end;

  if v_lease_token is not null then
    perform public.release_meta_account_operation(
      p_platform_account_id, p_user_id, v_lease_token
    );
  end if;

  return query select
    'next_step'::text,
    v_prep.due_plans > 0
      and v_prep.preflight_ok_count > 0
      and v_lease_token is not null
      and v_prep.kill_switch_mode = 'ALLOW',
    case
      when v_prep.preflight_ok_count < 1 then
        format(
          'Kein Plan besteht Preflight (%s) — SQL-Migration/Rebind prüfen',
          coalesce(v_prep.preflight_blocker, 'unknown')
        )
      when v_lease_token is null then
        'Lease-Claim fehlgeschlagen — Migration/Lease prüfen'
      when v_prep.kill_switch_mode <> 'ALLOW' then
        'Kill-Switch blockiert'
      when v_prep.due_plans < 1 then
        'Keine fälligen Pläne'
      else
        'SQL-Seite bereit — Node Executor/Drain muss processNextMetaMutation laufen lassen'
    end;
end;
$$;

revoke all on function public.diagnose_meta_organic_boost_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.diagnose_meta_organic_boost_write_now(uuid, uuid)
  to service_role;

-- Policy save should also rebind (best-effort) after versioning.
create or replace function public.put_meta_customer_budget_autonomy_policy(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_account_daily_hard_cap_minor bigint,
  p_default_campaign_daily_hard_cap_minor bigint,
  p_allow_budget_changes boolean,
  p_allow_status_changes boolean,
  p_allow_new_launches boolean,
  p_enable_automation boolean
)
returns table (
  policy_id uuid,
  kill_switch_event_id uuid,
  affected_target_count bigint,
  managed_budget_owner_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy_id uuid;
  v_kill_switch_event_id uuid;
  v_affected_target_count bigint;
  v_managed_budget_owner_count bigint;
  v_latest_mode text;
begin
  v_policy_id := public.put_meta_customer_policy_version(
    p_user_id,
    p_platform_account_id,
    p_account_daily_hard_cap_minor,
    p_default_campaign_daily_hard_cap_minor,
    p_allow_budget_changes,
    p_allow_status_changes,
    p_allow_new_launches,
    p_enable_automation
  );

  select
    autonomy.kill_switch_event_id,
    autonomy.affected_target_count,
    autonomy.managed_budget_owner_count
  into
    v_kill_switch_event_id,
    v_affected_target_count,
    v_managed_budget_owner_count
  from public.set_meta_customer_budget_autonomy(
    p_user_id,
    p_platform_account_id,
    p_enable_automation and p_allow_budget_changes
  ) autonomy;

  if p_enable_automation
    and p_allow_new_launches
    and exists (
      select 1
      from public.platform_accounts pa
      where pa.id = p_platform_account_id
        and pa.user_id = p_user_id
        and pa.platform = 'meta'
        and pa.revoked_at is null
        and 'ads_management' = any(pa.meta_scopes)
    ) then
    select state.mode
    into v_latest_mode
    from public.kill_switch_state state
    where state.scope_type = 'ACCOUNT'
      and state.user_id = p_user_id
      and state.platform_account_id = p_platform_account_id
    order by state.sequence desc
    limit 1;

    if v_latest_mode is distinct from 'ALLOW' then
      v_kill_switch_event_id := public.append_meta_kill_switch_state(
        'ACCOUNT',
        p_user_id,
        p_platform_account_id,
        null,
        'ALLOW',
        'Autonomie mit Launches aktiv — Meta-Schreiben freigegeben',
        'CUSTOMER',
        p_user_id::text
      );
    end if;

    begin
      perform public.rebind_meta_organic_boost_plans_to_current_policy(
        p_user_id,
        p_platform_account_id
      );
    exception
      when others then
        null;
    end;

    begin
      perform public.revive_meta_organic_boost_superseded_plans(
        p_user_id,
        p_platform_account_id
      );
    exception
      when others then
        null;
    end;
  end if;

  return query select
    v_policy_id,
    v_kill_switch_event_id,
    v_affected_target_count,
    v_managed_budget_owner_count;
end;
$$;

comment on function public.put_meta_customer_budget_autonomy_policy(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) is
  'Versions customer policy, syncs budget autonomy, rebinds organic plans best-effort.';

revoke all on function public.put_meta_customer_budget_autonomy_policy(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.put_meta_customer_budget_autonomy_policy(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) to service_role;

commit;

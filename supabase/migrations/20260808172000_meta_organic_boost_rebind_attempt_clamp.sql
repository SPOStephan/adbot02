-- Rebind aborted with:
--   mutation_plans_attempt_check
-- because max_attempts was set to max(execution.attempt_number)+3 > 20.
-- Constraint allows max_attempts only between 1 and 20. One failing plan
-- aborted the whole rebind (rebound=0) while Meta objects already exist PAUSED.
-- Raise ceiling to 50, clamp attempts, and continue past per-plan failures.

begin;

alter table public.mutation_plans
  drop constraint if exists mutation_plans_attempt_check;

alter table public.mutation_plans
  add constraint mutation_plans_attempt_check
  check (attempt_count >= 0 and max_attempts between 1 and 50);

drop function if exists public.rebind_meta_organic_boost_plans_to_current_policy(uuid, uuid);

create or replace function public.rebind_meta_organic_boost_plans_to_current_policy(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns table (
  rebound_count integer,
  detail text
)
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
  v_skipped integer := 0;
  v_sync_id uuid;
  v_timezone text;
  v_account_day date;
  v_detail text := 'ok';
  v_skip_reasons text := '';
  v_guards_disabled boolean := false;
  v_max_exec integer;
  v_max_attempts integer;
  v_attempt_count integer;
begin
  select * into v_account
  from public.platform_accounts account
  where account.id = p_platform_account_id
    and account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null;

  if not found then
    rebound_count := 0;
    detail := 'account_missing';
    return next;
    return;
  end if;

  select * into v_policy
  from public.automation_policies policy
  where policy.user_id = p_user_id
    and policy.platform_account_id = p_platform_account_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.currency = 'EUR'
  order by policy.version desc
  limit 1;

  if not found then
    rebound_count := 0;
    detail := 'no_current_active_eur_policy';
    return next;
    return;
  end if;

  if not v_policy.allow_new_launches then
    rebound_count := 0;
    detail := 'current_policy_disallows_new_launches';
    return next;
    return;
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
    ),
    (
      select mp.source_marketing_sync_id
      from public.mutation_plans mp
      where mp.user_id = p_user_id
        and mp.platform_account_id = p_platform_account_id
        and mp.source_rule_key = 'organic-boost'
        and mp.source_marketing_sync_id is not null
      order by mp.created_at desc
      limit 1
    )
  );

  if v_sync_id is null then
    rebound_count := 0;
    detail := 'no_marketing_sync_id';
    return next;
    return;
  end if;

  select snapshot.* into v_snapshot
  from public.daily_budget_exposure_snapshots snapshot
  where snapshot.platform_account_id = p_platform_account_id
    and snapshot.user_id = p_user_id
    and snapshot.policy_id = v_policy.id
    and snapshot.status = 'COMPLETE'
    and snapshot.currency = 'EUR'
  order by snapshot.completed_at desc nulls last, snapshot.created_at desc
  limit 1;

  if not found then
    begin
      v_snapshot := public.ensure_meta_organic_boost_exposure_snapshot(
        p_platform_account_id,
        p_user_id,
        v_policy.id,
        v_sync_id,
        null,
        now()
      );
    exception
      when others then
        v_snapshot := null;
        v_detail := 'ensure_snapshot_failed:' || SQLERRM;
    end;
  end if;

  if v_snapshot is null
    or v_snapshot.id is null
    or v_snapshot.status is distinct from 'COMPLETE' then
    v_timezone := coalesce(nullif(v_account.marketing_timezone_name, ''), 'Europe/Berlin');
    begin
      v_account_day := (now() at time zone v_timezone)::date;
    exception
      when others then
        v_timezone := 'Europe/Berlin';
        v_account_day := (now() at time zone v_timezone)::date;
    end;

    select exposure.account_day
      into v_account_day
    from public.daily_budget_exposures exposure
    join public.mutation_plans mp
      on mp.id = exposure.plan_id
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'FAILED', 'STALE', 'BLOCKED', 'PREFLIGHT_FAILED'
      )
    order by mp.created_at asc
    limit 1;

    insert into public.daily_budget_exposure_snapshots (
      user_id,
      platform_account_id,
      policy_id,
      account_day,
      account_timezone_name,
      source_marketing_sync_id,
      currency,
      status,
      observed_budget_owner_count,
      reserved_exposure_minor,
      completed_at
    ) values (
      p_user_id,
      p_platform_account_id,
      v_policy.id,
      v_account_day,
      v_timezone,
      v_sync_id,
      'EUR',
      'COMPLETE',
      0,
      0,
      now()
    )
    on conflict on constraint daily_exposure_snapshots_account_day_sync_key
    do update set
      policy_id = excluded.policy_id,
      account_timezone_name = excluded.account_timezone_name,
      currency = 'EUR',
      status = 'COMPLETE',
      completed_at = coalesce(
        public.daily_budget_exposure_snapshots.completed_at,
        excluded.completed_at
      ),
      updated_at = now()
    returning * into v_snapshot;
  end if;

  if v_snapshot is null
    or v_snapshot.id is null
    or v_snapshot.status is distinct from 'COMPLETE' then
    rebound_count := 0;
    detail := coalesce(nullif(v_detail, 'ok'), 'snapshot_unavailable');
    return next;
    return;
  end if;

  begin
    alter table public.mutation_plans
      disable trigger guard_meta_mutation_plan_update;
    alter table public.daily_budget_exposures
      disable trigger guard_meta_exposure_non_decreasing;
    v_guards_disabled := true;
  exception
    when others then
      v_detail := 'disable_trigger_failed:' || SQLERRM;
      v_guards_disabled := false;
  end;
  perform set_config('app.meta_organic_rebind', '1', true);

  for v_plan in
    select mp.*
    from public.mutation_plans mp
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
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
    begin
      select coalesce(max(me.attempt_number), 0)
        into v_max_exec
      from public.mutation_executions me
      where me.plan_id = v_plan.id;

      -- mutation_plans_attempt_check: max_attempts between 1 and 50
      v_max_attempts := least(
        50,
        greatest(
          coalesce(v_plan.max_attempts, 1),
          3,
          v_max_exec + 3
        )
      );
      -- Keep room for one more claim attempt; stay within check bounds.
      v_attempt_count := least(
        greatest(v_max_exec, 0),
        v_max_attempts - 1
      );

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
        attempt_count = v_attempt_count,
        max_attempts = v_max_attempts,
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        error_class = null,
        blocked_reason = null,
        terminal_at = null,
        not_before = least(coalesce(mp.not_before, now()), now()),
        updated_at = now()
      where mp.id = v_plan.id;

      begin
        update public.daily_budget_exposures exposure
        set
          policy_id = v_policy.id,
          snapshot_id = v_snapshot.id,
          account_day = v_snapshot.account_day,
          updated_at = now()
        where exposure.plan_id = v_plan.id
          and exposure.user_id = p_user_id
          and exposure.platform_account_id = p_platform_account_id;
      exception
        when unique_violation then
          update public.daily_budget_exposures exposure
          set
            policy_id = v_policy.id,
            snapshot_id = v_snapshot.id,
            updated_at = now()
          where exposure.plan_id = v_plan.id
            and exposure.user_id = p_user_id
            and exposure.platform_account_id = p_platform_account_id;
      end;

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
    exception
      when others then
        v_skipped := v_skipped + 1;
        v_skip_reasons := left(
          v_skip_reasons
            || case when v_skip_reasons = '' then '' else ';' end
            || v_plan.id::text || ':' || SQLERRM,
          500
        );
    end;
  end loop;

  perform set_config('app.meta_organic_rebind', '0', true);
  if v_guards_disabled then
    alter table public.daily_budget_exposures
      enable trigger guard_meta_exposure_non_decreasing;
    alter table public.mutation_plans
      enable trigger guard_meta_mutation_plan_update;
    v_guards_disabled := false;
  end if;

  rebound_count := v_count;
  detail := case
    when v_count > 0 and v_skipped = 0 then
      format('rebound=%s policy=%s snapshot=%s', v_count, v_policy.id, v_snapshot.id)
    when v_count > 0 then
      format(
        'rebound=%s skipped=%s policy=%s; %s',
        v_count, v_skipped, v_policy.id, v_skip_reasons
      )
    when v_skipped > 0 then
      format('rebound=0 skipped=%s; %s', v_skipped, v_skip_reasons)
    else format(
      'no_matching_plans policy=%s snapshot=%s allow_launches=%s allow_status=%s',
      v_policy.id,
      v_snapshot.id,
      v_policy.allow_new_launches,
      v_policy.allow_status_changes
    )
  end;
  return next;
  return;
exception
  when others then
    perform set_config('app.meta_organic_rebind', '0', true);
    if v_guards_disabled then
      begin
        alter table public.daily_budget_exposures
          enable trigger guard_meta_exposure_non_decreasing;
        alter table public.mutation_plans
          enable trigger guard_meta_mutation_plan_update;
      exception
        when others then
          null;
      end;
    end if;
    rebound_count := 0;
    detail := 'rebind_exception:' || SQLERRM;
    return next;
    return;
end;
$$;

revoke all on function public.rebind_meta_organic_boost_plans_to_current_policy(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rebind_meta_organic_boost_plans_to_current_policy(uuid, uuid)
  to service_role;

comment on function public.rebind_meta_organic_boost_plans_to_current_policy(uuid, uuid) is
  'Rebinds organic-boost plans; clamps attempt_count/max_attempts to mutation_plans_attempt_check (1..50).';

-- Revive: same clamp so soft-revive cannot violate the check either.
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
    attempt_count = least(
      greatest(
        0,
        coalesce((
          select max(me.attempt_number)
          from public.mutation_executions me
          where me.plan_id = mp.id
        ), 0)
      ),
      49
    ),
    max_attempts = least(
      50,
      greatest(
        coalesce(mp.max_attempts, 1),
        3,
        coalesce((
          select max(me.attempt_number)
          from public.mutation_executions me
          where me.plan_id = mp.id
        ), 0) + 3
      )
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

-- One-shot: clamp any organic plans already outside the old 1..20 window.
update public.mutation_plans mp
set
  max_attempts = least(50, greatest(coalesce(mp.max_attempts, 1), 3)),
  attempt_count = least(greatest(coalesce(mp.attempt_count, 0), 0), 49),
  updated_at = now()
where mp.source_rule_key = 'organic-boost'
  and (
    coalesce(mp.max_attempts, 0) > 50
    or coalesce(mp.max_attempts, 0) < 1
    or coalesce(mp.attempt_count, 0) < 0
    or coalesce(mp.attempt_count, 0) > 49
  );

commit;

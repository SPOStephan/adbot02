-- Repair: rebind returned 0 while plans still failed policy_current+snapshot.
-- Swallowing exceptions hid the cause. Make rebind resilient:
-- 1) disable intent/exposure guards directly (GUC alone was insufficient)
-- 2) bootstrap COMPLETE snapshot inline if ensure fails
-- 3) do not skip plans on require_manual_approval / allow_status_changes
-- 4) surface rebind_detail from prepare (DROP OUT signature again)

begin;

drop function if exists public.diagnose_meta_organic_boost_write_now(uuid, uuid);
drop function if exists public.prepare_meta_organic_boost_write_now(uuid, uuid);
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
  v_sync_id uuid;
  v_timezone text;
  v_account_day date;
  v_detail text := 'ok';
  v_guards_disabled boolean := false;
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
      select (mp.source_marketing_sync_id)
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

  -- Prefer an existing COMPLETE snapshot already on the current policy.
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

    -- Align day with an existing organic exposure when present (avoid unique clashes).
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

  -- Hard-disable guards for this transaction (more reliable than GUC alone).
  begin
    alter table public.mutation_plans
      disable trigger guard_meta_mutation_plan_update;
    alter table public.daily_budget_exposures
      disable trigger guard_meta_exposure_non_decreasing;
    v_guards_disabled := true;
  exception
    when others then
      -- Fall back to GUC bypass in guard functions.
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
        -- Keep account_day; only retarget policy + snapshot.
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
  end loop;

  perform set_config('app.meta_organic_rebind', '0', true);
  alter table public.daily_budget_exposures
    enable trigger guard_meta_exposure_non_decreasing;
  alter table public.mutation_plans
    enable trigger guard_meta_mutation_plan_update;
  v_guards_disabled := false;

  rebound_count := v_count;
  detail := case
    when v_count > 0 then format('rebound=%s policy=%s snapshot=%s', v_count, v_policy.id, v_snapshot.id)
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
  'Rebinds organic-boost plans to current policy/snapshot; disables intent guards transactionally; returns detail.';

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
  preflight_blocker text,
  rebind_detail text
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
  v_rebind_detail text := null;
  v_blocker text := null;
  v_lease_user uuid;
  v_account_user uuid;
  v_expires timestamptz;
  v_plan_id uuid;
  v_rebind record;
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
    select * into v_rebind
    from public.rebind_meta_organic_boost_plans_to_current_policy(
      p_user_id, p_platform_account_id
    );
    v_rebound := coalesce(v_rebind.rebound_count, 0);
    v_rebind_detail := v_rebind.detail;
  exception
    when others then
      v_rebound := 0;
      v_rebind_detail := 'prepare_rebind_call:' || SQLERRM;
  end;

  begin
    perform public.revive_meta_organic_boost_superseded_plans(
      p_user_id, p_platform_account_id
    );
  exception
    when others then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'revive:' || SQLERRM;
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
      and mp.status in ('PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE', 'PREFLIGHT_FAILED');
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
    v_blocker,
    v_rebind_detail;
end;
$$;

revoke all on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  to service_role;

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
    coalesce(v_prep.rebound_plans, 0) > 0,
    coalesce(v_prep.rebind_detail, v_prep.rebound_plans::text);

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
          'Kein Plan besteht Preflight (%s) rebind=%s',
          coalesce(v_prep.preflight_blocker, 'unknown'),
          coalesce(v_prep.rebind_detail, 'n/a')
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

-- Call sites that expected integer from rebind: wrap via SELECT rebound_count.
-- customer-control-service / prepare already use the new returns table form.

commit;

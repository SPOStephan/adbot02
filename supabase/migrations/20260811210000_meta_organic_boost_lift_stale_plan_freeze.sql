-- Root cause (Diagnose 2026-08-11):
-- Organic AUTO plans created under ACCOUNT FREEZE were inserted with
-- planned_payload.require_manual_approval=true. The LAUNCH_CHAIN insert
-- trigger then wrote PLAN FREEZE_WRITES
-- ("Aktiv-Launch wartet auf exakte Kundenbestätigung").
-- Payload heal / ACCOUNT ALLOW fixed the payload, but PLAN FREEZE remained.
-- get_effective_meta_kill_switch(plan) therefore stayed FREEZE → soft-skip loop.
--
-- Global rule: when ACCOUNT is ALLOW and current intent is AUTO, lift stale
-- PLAN FREEZE on wire-free organic plans so Meta writes can proceed.

begin;

create or replace function public.lift_meta_organic_boost_stale_plan_freeze(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_kill text;
  v_plan public.mutation_plans%rowtype;
  v_plan_mode text;
  v_count integer := 0;
begin
  if p_user_id is null or p_platform_account_id is null then
    return 0;
  end if;

  -- Account-level must be open; do not fight a real ACCOUNT/SYSTEM freeze.
  select ks.mode into v_account_kill
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  if coalesce(v_account_kill, 'FREEZE_WRITES') <> 'ALLOW' then
    return 0;
  end if;

  for v_plan in
    select mp.*
    from public.mutation_plans mp
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE',
        'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING'
      )
      and public.meta_organic_boost_effective_require_manual(mp.id) = false
      and not exists (
        select 1
        from public.remote_object_bindings binding
        where binding.plan_id = mp.id
      )
      and not exists (
        select 1
        from public.meta_organic_boost_canary_approvals approval
        where approval.plan_id = mp.id
      )
  loop
    select latest.mode into v_plan_mode
    from public.kill_switch_state latest
    where latest.scope_type = 'PLAN'
      and latest.user_id = v_plan.user_id
      and latest.platform_account_id = v_plan.platform_account_id
      and latest.plan_id = v_plan.id
    order by latest.sequence desc
    limit 1;

    if coalesce(v_plan_mode, 'ALLOW') = 'ALLOW' then
      continue;
    end if;

    perform public.append_meta_kill_switch_state(
      'PLAN',
      v_plan.user_id,
      v_plan.platform_account_id,
      v_plan.id,
      'ALLOW',
      'Beitrag-Push AUTO: veraltete PLAN-Freeze (Canary-Gate) aufgehoben',
      'SYSTEM',
      'meta-organic-boost-lift-stale-plan-freeze'
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.lift_meta_organic_boost_stale_plan_freeze(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.lift_meta_organic_boost_stale_plan_freeze(uuid, uuid)
  to service_role;

comment on function public.lift_meta_organic_boost_stale_plan_freeze(uuid, uuid) is
  'Lifts stale PLAN FREEZE on wire-free organic AUTO plans when ACCOUNT ALLOW; REVIEW/LIFETIME canaries untouched.';

-- Wire into the global ALLOW queue sync (called by prepare every drain).
create or replace function public.sync_meta_organic_boost_queue_after_allow(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kill text;
  v_count integer := 0;
  v_lifted integer := 0;
begin
  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  if coalesce(v_kill, 'FREEZE_WRITES') <> 'ALLOW' then
    return 0;
  end if;

  begin
    perform public.heal_meta_organic_boost_freeze_baked_review(
      p_user_id, p_platform_account_id
    );
  exception
    when undefined_function then
      null;
  end;

  begin
    v_lifted := public.lift_meta_organic_boost_stale_plan_freeze(
      p_user_id, p_platform_account_id
    );
  exception
    when others then
      v_lifted := 0;
  end;

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
        'policy_inactive',
        'superseded_by_marketing_snapshot'
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
        'policy_inactive',
        'superseded_by_marketing_snapshot'
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
    and mp.status in (
      'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE',
      'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING'
    )
    and not exists (
      select 1
      from public.remote_object_bindings binding
      where binding.plan_id = mp.id
    )
    and (
      public.meta_organic_boost_effective_require_manual(mp.id) = false
      or mp.blocked_reason in (
        'organic_preflight_kill_switch',
        'writes_frozen',
        'organic_preflight_not_ready',
        'organic_preflight_marketing_sync_stale',
        'account_operation_lease_busy'
      )
      or mp.not_before > now()
    );

  get diagnostics v_count = row_count;
  return v_count + v_lifted;
end;
$$;

revoke all on function public.sync_meta_organic_boost_queue_after_allow(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sync_meta_organic_boost_queue_after_allow(uuid, uuid)
  to service_role;

comment on function public.sync_meta_organic_boost_queue_after_allow(uuid, uuid) is
  'ACCOUNT ALLOW: lift stale organic PLAN FREEZE, heal freeze-bake, requeue wire-free organic plans.';

-- Also on Freigeben.
create or replace function public.set_meta_customer_kill_switch(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_mode text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_event_id uuid;
begin
  if p_mode not in ('ALLOW', 'FREEZE_WRITES', 'PAUSE_MANAGED')
    or char_length(v_reason) < 8
    or char_length(v_reason) > 500 then
    raise exception 'Customer kill-switch input is invalid';
  end if;

  if p_mode = 'ALLOW' and not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and 'ads_management' = any(pa.meta_scopes)
  ) then
    raise exception 'ALLOW requires ads_management';
  end if;

  v_event_id := public.append_meta_kill_switch_state(
    'ACCOUNT',
    p_user_id,
    p_platform_account_id,
    null,
    p_mode,
    v_reason,
    'CUSTOMER',
    p_user_id::text
  );

  if p_mode = 'ALLOW' then
    begin
      perform public.heal_meta_organic_boost_freeze_baked_review(
        p_user_id, p_platform_account_id
      );
    exception
      when undefined_function then
        null;
    end;

    begin
      perform public.lift_meta_organic_boost_stale_plan_freeze(
        p_user_id, p_platform_account_id
      );
    exception
      when undefined_function then
        null;
    end;

    update public.mutation_plans mp
    set
      status = case
        when mp.status in (
          'BLOCKED', 'FAILED', 'STALE', 'PREFLIGHT_FAILED',
          'CLAIMED', 'EXECUTING', 'RECONCILING'
        ) then 'PENDING'
        else mp.status
      end,
      not_before = least(coalesce(mp.not_before, now()), now()),
      blocked_reason = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive',
          'superseded_by_marketing_snapshot'
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
          'policy_inactive',
          'superseded_by_marketing_snapshot'
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
      and mp.status in (
        'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE',
        'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING'
      )
      and not exists (
        select 1
        from public.remote_object_bindings binding
        where binding.plan_id = mp.id
      );

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

  return v_event_id;
end;
$$;

revoke all on function public.set_meta_customer_kill_switch(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.set_meta_customer_kill_switch(
  uuid, uuid, text, text
) to service_role;

-- Immediate lift for currently stranded AUTO queues (all tenants).
do $oneshot$
declare
  v_row record;
  v_lifted integer;
begin
  for v_row in
    select distinct mp.user_id, mp.platform_account_id
    from public.mutation_plans mp
    where mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE', 'PREFLIGHT_FAILED'
      )
      and exists (
        select 1
        from public.kill_switch_state ks
        where ks.scope_type = 'PLAN'
          and ks.plan_id = mp.id
          and ks.mode = 'FREEZE_WRITES'
      )
  loop
    begin
      v_lifted := public.lift_meta_organic_boost_stale_plan_freeze(
        v_row.user_id, v_row.platform_account_id
      );
      if v_lifted > 0 then
        perform public.sync_meta_organic_boost_queue_after_allow(
          v_row.user_id, v_row.platform_account_id
        );
      end if;
    exception
      when others then
        raise notice 'lift_plan_freeze_skip % %: %',
          v_row.user_id, v_row.platform_account_id, SQLERRM;
    end;
  end loop;
end;
$oneshot$;

commit;

-- GLOBAL / DAUERHAFT:
-- Beitrag-Push AUTO darf nicht an eingefrorenen Plan-Flags oder sticky
-- Kill-Soft-Blocks scheitern. Aktuelle Kunden-Settings + ACCOUNT ALLOW gelten.
-- Kein One-shot für einzelne Pläne — Runtime-Regeln für alle Accounts.

begin;

-- ---------------------------------------------------------------------------
-- 1) Effective AUTO intent: current settings win over freeze-baked payload
-- ---------------------------------------------------------------------------
create or replace function public.meta_organic_boost_effective_require_manual(
  p_plan_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_settings public.meta_boost_settings%rowtype;
begin
  select * into v_plan
  from public.mutation_plans
  where id = p_plan_id;

  if not found or v_plan.source_rule_key is distinct from 'organic-boost' then
    return true;
  end if;

  -- Lifetime canaries stay review-gated by contract.
  if coalesce(v_plan.planned_payload->>'budget_mode', 'DAILY') = 'LIFETIME' then
    return true;
  end if;

  select settings.* into v_settings
  from public.meta_boost_settings settings
  where settings.user_id = v_plan.user_id
    and settings.platform_account_id = v_plan.platform_account_id
    and settings.is_current
  order by settings.version desc
  limit 1;

  -- Current AUTO Freigeben intent overrides a freeze-baked payload flag.
  if found
    and v_settings.enabled
    and coalesce(v_settings.boost_mode, 'REVIEW') = 'AUTO'
    and v_settings.auto_boost_new_candidates
    and v_settings.require_manual_approval is not true then
    return false;
  end if;

  return coalesce((v_plan.planned_payload->>'require_manual_approval')::boolean, true);
end;
$$;

revoke all on function public.meta_organic_boost_effective_require_manual(uuid)
  from public, anon, authenticated;
grant execute on function public.meta_organic_boost_effective_require_manual(uuid)
  to service_role;

comment on function public.meta_organic_boost_effective_require_manual(uuid) is
  'AUTO Beitrag-Push: current settings override freeze-baked planned_payload.require_manual_approval; LIFETIME stays review-gated.';

-- ---------------------------------------------------------------------------
-- 2) Preflight uses effective AUTO intent (not baked payload alone)
-- ---------------------------------------------------------------------------
create or replace function public.meta_organic_boost_executor_preflight_ok(
  p_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mutation_plans plan
    join public.platform_accounts account
      on account.id = plan.platform_account_id
     and account.user_id = plan.user_id
     and account.platform = 'meta'
     and account.revoked_at is null
     and account.marketing_currency = 'EUR'
     and account.marketing_sync_id is not null
     and account.marketing_last_success_at is not null
     and account.marketing_last_success_at >= now() - interval '48 hours'
     and account.marketing_last_success_at <= now() + interval '1 minute'
     and 'ads_management' = any(account.meta_scopes)
     and nullif(account.marketing_meta_ad_account_id, '') is not null
    join public.automation_policies policy
      on policy.id = plan.policy_id
     and policy.user_id = plan.user_id
     and policy.platform_account_id = plan.platform_account_id
     and policy.is_current
     and policy.status = 'ACTIVE'
     and policy.currency = 'EUR'
     and policy.allow_new_launches
     and policy.allow_status_changes
     and policy.policy_hash = plan.expected_before->>'policy_hash'
    join public.meta_organic_boost_links link_row
      on link_row.plan_id = plan.id
     and link_row.user_id = plan.user_id
     and link_row.platform_account_id = plan.platform_account_id
    join public.daily_budget_exposure_snapshots snapshot
      on snapshot.id = (plan.expected_before->>'exposure_snapshot_id')::uuid
     and snapshot.user_id = plan.user_id
     and snapshot.platform_account_id = plan.platform_account_id
     and snapshot.policy_id = plan.policy_id
     and snapshot.status = 'COMPLETE'
     and snapshot.currency = 'EUR'
    where plan.id = p_plan_id
      and plan.source_rule_key = 'organic-boost'
      and plan.action_type = 'LAUNCH_CHAIN'
      and not plan.safety_action
      and plan.max_attempts >= 1
      and plan.attempt_count <= plan.max_attempts
      and plan.payload_hash ~ '^[0-9a-f]{64}$'
      and public.meta_sha256(plan.planned_payload::text) = plan.payload_hash
      and plan.planned_payload->>'launch_kind' = 'ORGANIC_BOOST'
      and (plan.planned_payload->>'contract_version')::integer in (2, 3)
      and plan.planned_payload#>>'{campaign,status}' = 'PAUSED'
      and plan.planned_payload#>>'{ad_set,status}' = 'PAUSED'
      and plan.planned_payload#>>'{ad,status}' = 'PAUSED'
      and plan.intended_after->>'status' = 'ACTIVE'
      and plan.not_before <= now()
      and (
        (
          public.meta_organic_boost_effective_require_manual(plan.id) = false
          and (select ks.mode
               from public.get_effective_meta_kill_switch(
                 plan.user_id, plan.platform_account_id, plan.id
               ) ks) = 'ALLOW'
        )
        or (
          public.meta_organic_boost_effective_require_manual(plan.id) = true
          and exists (
            select 1
            from public.meta_organic_boost_canary_approvals approval
            where approval.plan_id = plan.id
              and approval.user_id = plan.user_id
              and approval.platform_account_id = plan.platform_account_id
              and approval.payload_hash = plan.payload_hash
              and approval.object_story_id = plan.planned_payload->>'object_story_id'
              and approval.budget_mode = plan.planned_payload->>'budget_mode'
              and approval.duration_days
                    = (plan.planned_payload->>'duration_days')::integer
              and coalesce(approval.destination_url, '')
                    = coalesce(plan.planned_payload->>'destination_url', '')
              and (
                (
                  approval.budget_mode = 'DAILY'
                  and approval.daily_budget_minor
                        = (plan.planned_payload->>'daily_budget_minor')::bigint
                  and approval.lifetime_budget_minor is null
                )
                or (
                  approval.budget_mode = 'LIFETIME'
                  and approval.lifetime_budget_minor
                        = (plan.planned_payload->>'lifetime_budget_minor')::bigint
                  and approval.daily_budget_minor is null
                )
              )
          )
          and (select ks.mode
               from public.get_effective_meta_kill_switch(
                 plan.user_id, plan.platform_account_id, plan.id
               ) ks) = 'ALLOW'
        )
      )
      and exists (
        select 1
        from public.daily_budget_exposures exposure
        where exposure.plan_id = plan.id
          and exposure.user_id = plan.user_id
          and exposure.platform_account_id = plan.platform_account_id
          and exposure.policy_id = plan.policy_id
          and exposure.snapshot_id = snapshot.id
          and exposure.source in ('PLAN', 'RECONCILIATION')
          and exposure.budget_owner_type
                = plan.planned_payload->>'budget_owner_type'
          and exposure.max_daily_budget_minor = case
            when (plan.planned_payload->>'contract_version')::integer = 2
              then (plan.planned_payload->>'daily_budget_minor')::bigint
            else (plan.planned_payload->>'lifetime_budget_minor')::bigint
          end
      )
      and not exists (
        select 1
        from public.mutation_plan_steps step
        where step.plan_id = plan.id
          and (
            public.meta_sha256(step.planned_request::text) <> step.request_hash
            or step.dispatch_state = 'REMOTE_UNKNOWN'
            or step.status in ('COMPENSATION_REQUIRED', 'FAILED')
          )
      )
  );
$$;

revoke all on function public.meta_organic_boost_executor_preflight_ok(uuid)
  from public, anon, authenticated;
grant execute on function public.meta_organic_boost_executor_preflight_ok(uuid)
  to service_role;

comment on function public.meta_organic_boost_executor_preflight_ok(uuid) is
  'Organic executor preflight: AUTO follows current settings (not freeze-baked payload); last-good marketing sync 48h.';

-- ---------------------------------------------------------------------------
-- 3) Claim kill-gate: under ALLOW clear sticky soft-blocks (every claim)
-- ---------------------------------------------------------------------------
create or replace function public.meta_claim_apply_kill_switch_gate(
  p_plan_id uuid,
  p_kill_mode text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
begin
  if coalesce(p_kill_mode, 'FREEZE_WRITES') = 'ALLOW' then
    update public.mutation_plans
    set
      blocked_reason = case
        when blocked_reason in (
          'organic_preflight_kill_switch',
          'writes_frozen'
        ) then null
        else blocked_reason
      end,
      error_class = case
        when blocked_reason in (
          'organic_preflight_kill_switch',
          'writes_frozen'
        ) then null
        else error_class
      end,
      not_before = least(coalesce(not_before, now()), now()),
      updated_at = now()
    where id = p_plan_id
      and source_rule_key = 'organic-boost'
      and status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'EXECUTING')
      and (
        blocked_reason in ('organic_preflight_kill_switch', 'writes_frozen')
        or not_before > now()
      );
    return 'ok';
  end if;

  select * into v_plan
  from public.mutation_plans
  where id = p_plan_id;

  if not found then
    return 'skip';
  end if;

  if v_plan.source_rule_key = 'organic-boost' then
    update public.mutation_plans
    set
      status = case
        when status in ('CLAIMED', 'RUNNING', 'EXECUTING') then 'PENDING'
        else status
      end,
      blocked_reason = 'organic_preflight_kill_switch',
      error_class = 'KILL_SWITCH',
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = null,
      not_before = greatest(coalesce(not_before, now()), now() + interval '1 minute'),
      updated_at = now()
    where id = p_plan_id
      and status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'EXECUTING');
    return 'skip';
  end if;

  update public.mutation_plans
  set
    status = 'BLOCKED',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_class = 'KILL_SWITCH',
    blocked_reason = 'writes_frozen',
    terminal_at = now(),
    updated_at = now()
  where id = p_plan_id;

  return 'skip';
end;
$$;

revoke all on function public.meta_claim_apply_kill_switch_gate(uuid, text)
  from public, anon, authenticated;
grant execute on function public.meta_claim_apply_kill_switch_gate(uuid, text)
  to service_role;

comment on function public.meta_claim_apply_kill_switch_gate(uuid, text) is
  'Organic soft-skip under FREEZE; under ALLOW clears sticky kill soft-blocks and due-ifies the plan.';

-- ---------------------------------------------------------------------------
-- 4) Freigeben RPC: always self-heal organic AUTO queue (global entrypoint)
-- ---------------------------------------------------------------------------
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

    -- Clear sticky soft-blocks for ALL organic queue plans (AUTO or REVIEW).
    -- Effective AUTO preflight decides executability; sticky kill text must die.
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

comment on function public.set_meta_customer_kill_switch(uuid, uuid, text, text) is
  'Customer kill-switch; ALLOW globally requeues wire-free organic plans and heals freeze-baked AUTO intent.';

-- ---------------------------------------------------------------------------
-- 5) prepare_write_now: also clear soft-blocks for effective-AUTO plans
--     even when payload flag still says require_manual_approval=true
-- ---------------------------------------------------------------------------
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
  return v_count;
end;
$$;

revoke all on function public.sync_meta_organic_boost_queue_after_allow(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sync_meta_organic_boost_queue_after_allow(uuid, uuid)
  to service_role;

comment on function public.sync_meta_organic_boost_queue_after_allow(uuid, uuid) is
  'Whenever ACCOUNT is ALLOW: requeue wire-free organic plans using effective AUTO intent; clears sticky kill soft-blocks.';

-- Wire into prepare so every dashboard/cron drain applies the global rule.
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
  rebind_detail text,
  lease_forced boolean
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
  v_lease_forced boolean := false;
  v_finalized integer := 0;
  v_synced integer := 0;
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

  begin
    v_lease_forced := public.force_release_meta_account_operation_lease(
      p_platform_account_id, p_user_id
    );
  exception
    when others then
      perform public.heal_meta_account_operation_lease(
        p_platform_account_id, p_user_id
      );
      v_lease_forced := false;
      v_rebind_detail := 'lease_force_failed:' || SQLERRM;
  end;

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
    v_rebind_detail := case
      when v_rebind_detail is null then v_rebind.detail
      else v_rebind_detail || ';' || coalesce(v_rebind.detail, '')
    end;
  exception
    when others then
      v_rebound := 0;
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'prepare_rebind_call:' || SQLERRM;
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

  begin
    v_synced := public.sync_meta_organic_boost_queue_after_allow(
      p_user_id, p_platform_account_id
    );
    if v_synced > 0 then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || format('queue_synced=%s', v_synced);
    end if;
  exception
    when others then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'queue_sync:' || SQLERRM;
  end;

  begin
    v_finalized := public.finalize_meta_organic_boost_already_active_plans(
      p_user_id, p_platform_account_id
    );
    if v_finalized > 0 then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || format('finalized_active=%s', v_finalized);
    end if;
  exception
    when others then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'finalize_active:' || SQLERRM;
  end;

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
    v_rebind_detail,
    v_lease_forced;
end;
$$;

revoke all on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  to service_role;

comment on function public.prepare_meta_organic_boost_write_now(uuid, uuid) is
  'Global organic queue sync under ALLOW + rebind/revive/finalize; reports due/preflight for drain.';

commit;

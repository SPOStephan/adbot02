-- Beitrag-Push must keep working on the last good marketing sync when a later
-- Abruf flips marketing_sync_status to error. Autonomie + Freigeben must not
-- depend on the current Abruf finishing successfully.

begin;

-- ---------------------------------------------------------------------------
-- 1) Planner: accept last-good marketing sync (not only status=success)
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_updated text;
  v_old constant text := $old$and account.marketing_currency = 'EUR'
    and account.marketing_sync_status = 'success'
    and 'ads_management' = any(account.meta_scopes);$old$;
  v_new constant text := $new$and account.marketing_currency = 'EUR'
    -- Last good sync is enough: a later Abruf error must not block Autonomie.
    and account.marketing_sync_id is not null
    and account.marketing_last_success_at is not null
    and account.marketing_last_success_at >= now() - interval '48 hours'
    and account.marketing_last_success_at <= now() + interval '1 minute'
    and 'ads_management' = any(account.meta_scopes);$new$;
begin
  select pg_get_functiondef(
    'public.run_meta_organic_boost_planner(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'run_meta_organic_boost_planner not found';
  end if;

  if position(
    'account.marketing_last_success_at >= now() - interval ''48 hours'''
    in v_def
  ) > 0
    and position(
      'and account.marketing_sync_status = ''success'''
      in v_def
    ) = 0 then
    return;
  end if;

  if position(v_old in v_def) = 0 then
    raise exception
      'Failed to locate marketing_sync_status gate in run_meta_organic_boost_planner';
  end if;

  v_updated := replace(v_def, v_old, v_new);

  if position(
    'and account.marketing_sync_status = ''success'''
    in v_updated
  ) > 0 then
    raise exception
      'marketing_sync_status=success gate still present after planner patch';
  end if;

  execute v_updated;
end;
$patch$;

comment on function public.run_meta_organic_boost_planner(uuid, uuid, uuid, uuid, timestamptz) is
  'Materialize organic boost plans using last-good marketing sync (48h). Does not require current marketing_sync_status=success or the Abruf/Executor lease.';

-- ---------------------------------------------------------------------------
-- 2) Executor preflight: same last-good marketing readiness
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
          coalesce((plan.planned_payload->>'require_manual_approval')::boolean, true) = false
          and (select ks.mode
               from public.get_effective_meta_kill_switch(
                 plan.user_id, plan.platform_account_id, plan.id
               ) ks) = 'ALLOW'
        )
        or (
          coalesce((plan.planned_payload->>'require_manual_approval')::boolean, true) = true
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
  'Organic LAUNCH_CHAIN executor preflight: uses last-good marketing sync (48h), not current marketing_sync_status=success.';

-- ---------------------------------------------------------------------------
-- 3) Soft-skip reason: same last-good marketing readiness
-- ---------------------------------------------------------------------------
create or replace function public.meta_launch_chain_preflight_action(
  p_plan_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_kill text;
  v_reason text;
begin
  select * into v_plan
  from public.mutation_plans
  where id = p_plan_id;

  if not found or v_plan.action_type <> 'LAUNCH_CHAIN' then
    return 'ok';
  end if;

  if public.meta_launch_canary_preflight_ok(p_plan_id) then
    update public.mutation_plans
    set
      blocked_reason = null,
      error_class = case when error_class in ('KILL_SWITCH', 'PREFLIGHT') then null else error_class end,
      updated_at = now()
    where id = p_plan_id
      and status in ('PENDING', 'RETRYABLE')
      and blocked_reason in (
        'organic_preflight_kill_switch',
        'organic_preflight_marketing_sync_stale',
        'organic_preflight_not_ready',
        'writes_frozen'
      );
    return 'ok';
  end if;

  if v_plan.source_rule_key is distinct from 'organic-boost' then
    return 'stale';
  end if;

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    v_plan.user_id, v_plan.platform_account_id, v_plan.id
  ) ks;

  if coalesce(v_kill, 'FREEZE_WRITES') <> 'ALLOW' then
    v_reason := 'organic_preflight_kill_switch';
  elsif not exists (
    select 1
    from public.platform_accounts account
    where account.id = v_plan.platform_account_id
      and account.user_id = v_plan.user_id
      and account.marketing_sync_id is not null
      and account.marketing_last_success_at is not null
      and account.marketing_last_success_at >= now() - interval '48 hours'
      and account.marketing_last_success_at <= now() + interval '1 minute'
      and 'ads_management' = any(account.meta_scopes)
      and nullif(account.marketing_meta_ad_account_id, '') is not null
  ) then
    v_reason := 'organic_preflight_marketing_sync_stale';
  else
    v_reason := 'organic_preflight_not_ready';
  end if;

  update public.mutation_plans
  set
    status = case
      when status in ('CLAIMED', 'RUNNING', 'EXECUTING') then 'PENDING'
      else status
    end,
    blocked_reason = v_reason,
    error_class = case
      when v_reason = 'organic_preflight_kill_switch' then 'KILL_SWITCH'
      else 'PREFLIGHT'
    end,
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    terminal_at = null,
    not_before = greatest(coalesce(not_before, now()), now() + interval '1 minute'),
    updated_at = now()
  where id = p_plan_id
    and status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'EXECUTING');

  return 'skip';
end;
$$;

revoke all on function public.meta_launch_chain_preflight_action(uuid)
  from public, anon, authenticated;
grant execute on function public.meta_launch_chain_preflight_action(uuid)
  to service_role;

comment on function public.meta_launch_chain_preflight_action(uuid) is
  'Organic LAUNCH_CHAIN preflight gate: soft-skip with reason. Marketing readiness uses last-good sync (48h).';

-- ---------------------------------------------------------------------------
-- 4) Restore accounts stuck on error despite a recent successful sync
-- ---------------------------------------------------------------------------
update public.platform_accounts
set
  marketing_sync_status = 'success',
  updated_at = now()
where platform = 'meta'
  and revoked_at is null
  and marketing_sync_status = 'error'
  and marketing_sync_id is not null
  and marketing_last_success_at is not null
  and marketing_last_success_at >= now() - interval '48 hours'
  and marketing_last_success_at <= now() + interval '1 minute';

-- ---------------------------------------------------------------------------
-- 5) Re-queue organic plans soft-blocked on stale marketing sync
-- ---------------------------------------------------------------------------
update public.mutation_plans mp
set
  status = 'PENDING',
  lease_token = null,
  lease_owner = null,
  lease_expires_at = null,
  blocked_reason = null,
  error_class = null,
  terminal_at = null,
  not_before = least(coalesce(mp.not_before, now()), now()),
  updated_at = now()
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status in ('PENDING', 'RETRYABLE')
  and coalesce(mp.blocked_reason, '') = 'organic_preflight_marketing_sync_stale'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false;

commit;

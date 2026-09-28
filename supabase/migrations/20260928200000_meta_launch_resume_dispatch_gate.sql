-- Accepted customer launches must be able to continue in a later executor run.
--
-- Evidence (plan fe83a89a…, 2026-09-28 16:49): after the plan was requeued,
-- `activate-ad` failed with TRANSPORT/database_failed and stayed
-- NOT_DISPATCHED. begin_meta_mutation_step_dispatch re-checks
-- meta_launch_canary_preflight_ok before every launch write. That check is the
-- *initial* launch gate: it requires max_attempts = 1, attempt_count <= 1 and
-- the same marketing sync within 2 hours. Any continuation (recovery, yield,
-- a later cron tick) therefore could never dispatch another write. The same
-- failure hit plan a69ff483 at 16:14.
--
-- Fix: a resume gate for accepted customer launches whose campaign already
-- exists at Meta. Payload, approval and step hashes must be intact, no step may
-- be failed or ambiguous, and the current policy must still allow launches.
-- Kill switch, policy and lease checks stay in claim and dispatch unchanged.
--
-- Note: plpgsql bodies avoid the INTO clause form (Supabase SQL editor issue).

begin;

create or replace function public.meta_launch_resume_dispatch_ok(
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
    join public.meta_launch_canary_approvals approval
      on approval.plan_id = plan.id
     and approval.user_id = plan.user_id
     and approval.platform_account_id = plan.platform_account_id
     and approval.payload_hash = plan.payload_hash
    join public.automation_policies policy
      on policy.id = plan.policy_id
     and policy.user_id = plan.user_id
     and policy.platform_account_id = plan.platform_account_id
     and policy.is_current
     and policy.status = 'ACTIVE'
     and policy.allow_new_launches
     and policy.allow_status_changes
    join public.platform_accounts account
      on account.id = plan.platform_account_id
     and account.user_id = plan.user_id
     and account.platform = 'meta'
     and account.revoked_at is null
     and 'ads_management' = any(account.meta_scopes)
    where plan.id = p_plan_id
      and plan.source_rule_key = 'active-launch-chain'
      and plan.action_type = 'LAUNCH_CHAIN'
      and not plan.safety_action
      and plan.intended_after->>'status' = 'ACTIVE'
      and public.meta_sha256(plan.planned_payload::text) = plan.payload_hash
      and exists (
        select 1
        from public.remote_object_bindings binding
        where binding.plan_id = plan.id
          and binding.user_id = plan.user_id
          and binding.platform_account_id = plan.platform_account_id
          and binding.object_type = 'CAMPAIGN'
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

create or replace function public.meta_launch_canary_preflight_ok(
  p_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.meta_organic_boost_executor_preflight_ok(p_plan_id)
    or exists (
      select 1
      from public.mutation_plans plan
      join public.platform_accounts account
        on account.id = plan.platform_account_id
       and account.user_id = plan.user_id
       and account.platform = 'meta'
       and account.revoked_at is null
       and account.marketing_currency = 'EUR'
       and account.marketing_sync_id = plan.source_marketing_sync_id
       and account.marketing_sync_status = 'success'
       and account.marketing_last_success_at >= now() - interval '2 hours'
       and account.marketing_last_success_at <= now() + interval '1 minute'
       and 'ads_management' = any(account.meta_scopes)
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
      join public.meta_launch_canary_approvals approval
        on approval.plan_id = plan.id
       and approval.user_id = plan.user_id
       and approval.platform_account_id = plan.platform_account_id
       and approval.payload_hash = plan.payload_hash
       and approval.objective = plan.planned_payload->>'objective'
       and approval.destination_url is not distinct from plan.planned_payload->>'destination_url'
       and approval.budget_owner_type = plan.planned_payload->>'budget_owner_type'
       and approval.budget_type = coalesce(plan.planned_payload->>'budget_type', 'DAILY')
       and approval.campaign_name = plan.planned_payload#>>'{campaign,name}'
       and approval.ad_set_name = plan.planned_payload#>>'{ad_set,name}'
       and approval.creative_name = plan.planned_payload#>>'{creative,name}'
       and approval.ad_name = plan.planned_payload#>>'{ad,name}'
       and approval.target_status = plan.intended_after->>'status'
       and (
         (
           (plan.planned_payload->>'contract_version')::integer = 2
           and approval.daily_budget_minor
                 = (plan.planned_payload->>'daily_budget_minor')::bigint
           and approval.lifetime_budget_minor is null
           and approval.start_time is null
           and approval.end_time is null
         ) or (
           (plan.planned_payload->>'contract_version')::integer = 3
           and approval.daily_budget_minor is null
           and approval.lifetime_budget_minor
                 = (plan.planned_payload->>'lifetime_budget_minor')::bigint
           and approval.start_time
                 = (plan.planned_payload->>'start_time')::timestamptz
           and approval.end_time
                 = (plan.planned_payload->>'end_time')::timestamptz
         )
       )
      join public.daily_budget_exposure_snapshots snapshot
        on snapshot.id = (plan.expected_before->>'exposure_snapshot_id')::uuid
       and snapshot.user_id = plan.user_id
       and snapshot.platform_account_id = plan.platform_account_id
       and snapshot.policy_id = plan.policy_id
       and snapshot.source_marketing_sync_id = plan.source_marketing_sync_id
       and snapshot.status = 'COMPLETE'
       and snapshot.currency = 'EUR'
      where plan.id = p_plan_id
        and plan.source_rule_key is distinct from 'organic-boost'
        and plan.action_type = 'LAUNCH_CHAIN'
        and not plan.safety_action
        and plan.max_attempts = 1
        and plan.attempt_count <= 1
        and plan.payload_hash ~ '^[0-9a-f]{64}$'
        and public.meta_sha256(plan.planned_payload::text) = plan.payload_hash
        and (plan.planned_payload->>'contract_version')::integer in (2, 3)
        and plan.planned_payload#>>'{campaign,status}' = 'PAUSED'
        and plan.planned_payload#>>'{ad_set,status}' = 'PAUSED'
        and plan.planned_payload#>>'{ad,status}' = 'PAUSED'
        and plan.intended_after->>'status' = 'ACTIVE'
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
        and (select ks.mode
             from public.get_effective_meta_kill_switch(
               plan.user_id, plan.platform_account_id, plan.id
             ) ks) = 'ALLOW'
    )
    or public.meta_launch_resume_dispatch_ok(p_plan_id);
$$;

-- Operator tool: requeue one accepted launch that FAILED only because the old
-- gate rejected a write *before* it was sent (NOT_DISPATCHED, TRANSPORT). It
-- never touches sent or ambiguous steps and never creates new Meta objects.
create or replace function public.resume_failed_meta_customer_launch(
  p_plan_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.mutation_plans plan
    join public.meta_launch_canary_approvals approval
      on approval.plan_id = plan.id
     and approval.user_id = plan.user_id
     and approval.platform_account_id = plan.platform_account_id
    where plan.id = p_plan_id
      and plan.source_rule_key = 'active-launch-chain'
      and plan.action_type = 'LAUNCH_CHAIN'
      and plan.status = 'FAILED'
      and exists (
        select 1 from public.remote_object_bindings binding
        where binding.plan_id = plan.id and binding.object_type = 'CAMPAIGN'
      )
      and exists (
        select 1 from public.mutation_plan_steps step
        where step.plan_id = plan.id and step.status = 'FAILED'
      )
      and not exists (
        select 1 from public.mutation_plan_steps step
        where step.plan_id = plan.id
          and (
            step.status in ('COMPENSATION_REQUIRED', 'CLAIMED', 'RUNNING')
            or step.dispatch_state in ('PRE_DISPATCH', 'REMOTE_UNKNOWN')
            or (
              step.status = 'FAILED'
              and (
                step.dispatch_state <> 'NOT_DISPATCHED'
                or step.error_class is distinct from 'TRANSPORT'
              )
            )
          )
      )
      and not exists (
        select 1 from public.mutation_executions execution
        where execution.plan_id = plan.id
          and execution.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
      )
  ) then
    return 'NOT_ELIGIBLE';
  end if;

  update public.mutation_plan_steps step
  set status = 'PENDING',
      not_before = now(),
      started_at = null,
      completed_at = null,
      error_class = null,
      error_code = null,
      error_detail = null,
      updated_at = now()
  where step.plan_id = p_plan_id
    and step.status = 'FAILED'
    and step.dispatch_state = 'NOT_DISPATCHED';

  update public.mutation_plans plan
  set status = 'PENDING',
      max_attempts = greatest(plan.max_attempts, plan.attempt_count + 1),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      not_before = now(),
      blocked_reason = null,
      error_class = null,
      terminal_at = null,
      updated_at = now()
  where plan.id = p_plan_id
    and plan.status = 'FAILED';

  perform public.meta_resume_approved_launch_write_gate(p_plan_id);

  perform public.append_meta_mutation_audit_event(
    plan.user_id, plan.platform_account_id, plan.policy_id, plan.id,
    null, null, 'SYSTEM', 'resume_failed_meta_customer_launch',
    'CUSTOMER_LAUNCH_RESUMED',
    jsonb_build_object('plan_status', 'FAILED'),
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object('plan_status', 'PENDING'),
    jsonb_build_object('reason', 'pre_dispatch_gate_rejection'),
    null, null, null, null, null, now()
  )
  from public.mutation_plans plan
  where plan.id = p_plan_id;

  return 'RESUMED';
end;
$$;

revoke all on function public.meta_launch_resume_dispatch_ok(uuid)
  from public, anon, authenticated;
revoke all on function public.resume_failed_meta_customer_launch(uuid)
  from public, anon, authenticated, service_role;

comment on function public.meta_launch_resume_dispatch_ok(uuid) is
  'Resume gate for accepted customer launches whose campaign already exists at Meta; used by meta_launch_canary_preflight_ok so later executor runs may dispatch remaining writes.';
comment on function public.resume_failed_meta_customer_launch(uuid) is
  'Operator tool: requeues one accepted launch that failed only on a pre-dispatch gate rejection (NOT_DISPATCHED, TRANSPORT). Never replays sent or ambiguous steps.';

commit;

-- The first recovery version could leave a partially delivered customer launch
-- PENDING with attempt_count = max_attempts. Such a plan is safe to continue only
-- when it is approved, already has remote bindings, has pending work, has no
-- terminal or ambiguously dispatched step and has no live execution.

create or replace function public.recover_interrupted_meta_customer_launches(
  p_user_id uuid default null
)
returns table (
  recovered_plans integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_recovered integer := 0;
begin
  for v_plan in
    select mp.*
    from public.mutation_plans mp
    where (p_user_id is null or mp.user_id = p_user_id)
      and mp.source_rule_key = 'active-launch-chain'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in ('CLAIMED', 'EXECUTING', 'RECONCILING')
      and mp.lease_token is not null
      and mp.lease_expires_at is not null
      and mp.lease_expires_at <= now()
      and exists (
        select 1 from public.meta_launch_canary_approvals approval
        where approval.plan_id = mp.id
          and approval.user_id = mp.user_id
          and approval.platform_account_id = mp.platform_account_id
      )
      and exists (
        select 1 from public.mutation_plan_steps step
        where step.plan_id = mp.id
          and step.status = 'CLAIMED'
          and step.dispatch_state = 'NOT_DISPATCHED'
      )
      and not exists (
        select 1 from public.mutation_plan_steps step
        where step.plan_id = mp.id
          and step.status in ('CLAIMED', 'RUNNING')
          and step.dispatch_state <> 'NOT_DISPATCHED'
      )
      and not exists (
        select 1 from public.mutation_executions execution
        where execution.plan_id = mp.id
          and execution.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
          and execution.last_heartbeat_at > now() - interval '30 seconds'
      )
    order by mp.created_at
    for update skip locked
  loop
    update public.mutation_executions execution
    set status = 'ABANDONED',
        finished_at = coalesce(execution.finished_at, now()),
        error_class = 'PROTOCOL',
        error_code = 'executor_step_limit_recovered'
    where execution.plan_id = v_plan.id
      and execution.lease_token = v_plan.lease_token
      and execution.status in ('CLAIMED', 'RUNNING', 'RECONCILING');

    update public.mutation_plan_steps step
    set status = 'PENDING',
        started_at = null,
        error_class = null,
        error_code = null,
        updated_at = now()
    where step.plan_id = v_plan.id
      and step.status = 'CLAIMED'
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
    where plan.id = v_plan.id
      and plan.lease_token = v_plan.lease_token
      and plan.status in ('CLAIMED', 'EXECUTING', 'RECONCILING');

    if found then
      v_recovered := v_recovered + 1;
    end if;
  end loop;

  -- A previously expired execution may already have reset its claimed step,
  -- after which the old initial preflight marked the partial launch STALE.
  -- Revive only approved customer launches that already have Meta bindings,
  -- still have pending work, have no terminal/ambiguous step and no live worker.
  for v_plan in
    select mp.*
    from public.mutation_plans mp
    where (p_user_id is null or mp.user_id = p_user_id)
      and mp.source_rule_key = 'active-launch-chain'
      and mp.action_type = 'LAUNCH_CHAIN'
      and (
        (
          mp.status = 'STALE'
          and mp.blocked_reason = 'launch_canary_preflight_drift'
        )
        or (
          mp.status = 'PENDING'
          and mp.attempt_count >= mp.max_attempts
        )
      )
      and exists (
        select 1 from public.meta_launch_canary_approvals approval
        where approval.plan_id = mp.id
          and approval.user_id = mp.user_id
          and approval.platform_account_id = mp.platform_account_id
      )
      and exists (
        select 1 from public.remote_object_bindings binding
        where binding.plan_id = mp.id
          and binding.user_id = mp.user_id
          and binding.platform_account_id = mp.platform_account_id
      )
      and exists (
        select 1 from public.mutation_plan_steps step
        where step.plan_id = mp.id
          and step.status in ('PENDING', 'RETRYABLE')
      )
      and not exists (
        select 1 from public.mutation_plan_steps step
        where step.plan_id = mp.id
          and (
            step.status in ('FAILED', 'COMPENSATION_REQUIRED')
            or (
              step.status in ('CLAIMED', 'RUNNING')
              and step.dispatch_state <> 'NOT_DISPATCHED'
            )
          )
      )
      and not exists (
        select 1 from public.mutation_executions execution
        where execution.plan_id = mp.id
          and execution.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
          and execution.last_heartbeat_at > now() - interval '30 seconds'
      )
    order by mp.created_at
    for update skip locked
  loop
    update public.mutation_plan_steps step
    set status = 'PENDING',
        started_at = null,
        error_class = null,
        error_code = null,
        updated_at = now()
    where step.plan_id = v_plan.id
      and step.status = 'CLAIMED'
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
    where plan.id = v_plan.id
      and (
        (
          plan.status = 'STALE'
          and plan.blocked_reason = 'launch_canary_preflight_drift'
        )
        or (
          plan.status = 'PENDING'
          and plan.attempt_count >= plan.max_attempts
        )
      );

    if found then
      v_recovered := v_recovered + 1;
    end if;
  end loop;

  return query select v_recovered;
end;
$$;

revoke all on function public.recover_interrupted_meta_customer_launches(uuid)
  from public, anon, authenticated;
grant execute on function public.recover_interrupted_meta_customer_launches(uuid)
  to service_role;

comment on function public.recover_interrupted_meta_customer_launches(uuid) is
  'Requeues expired NOT_DISPATCHED customer launch steps and safely revives approved partial launches made STALE by initial-preflight drift after remote objects were already bound. Only these proven-safe continuations, including exhausted PENDING partial plans, receive one additional plan attempt.';


-- Immediately unblock proven-safe exhausted partial launches such as Vertrieb02.
select * from public.recover_interrupted_meta_customer_launches(null);

-- Customer launch plans with many images can contain more than 24 steps. The
-- application executor now completes up to 64 steps in one run. This recovery
-- resets only an expired execution whose currently claimed step provably never
-- entered remote dispatch, so the ordinary minute executor can continue the
-- same plan without duplicating a Meta write.

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
        select 1
        from public.meta_launch_canary_approvals approval
        where approval.plan_id = mp.id
          and approval.user_id = mp.user_id
          and approval.platform_account_id = mp.platform_account_id
      )
      and exists (
        select 1
        from public.mutation_plan_steps step
        where step.plan_id = mp.id
          and step.status = 'CLAIMED'
          and step.dispatch_state = 'NOT_DISPATCHED'
      )
      and not exists (
        select 1
        from public.mutation_plan_steps step
        where step.plan_id = mp.id
          and step.status in ('CLAIMED', 'RUNNING')
          and step.dispatch_state <> 'NOT_DISPATCHED'
      )
      and not exists (
        select 1
        from public.mutation_executions execution
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

  return query select v_recovered;
end;
$$;

revoke all on function public.recover_interrupted_meta_customer_launches(uuid)
  from public, anon, authenticated;
grant execute on function public.recover_interrupted_meta_customer_launches(uuid)
  to service_role;

comment on function public.recover_interrupted_meta_customer_launches(uuid) is
  'Safely requeues expired customer launch executions only when their claimed step remained NOT_DISPATCHED; completed remote steps and bindings are retained for idempotent continuation.';

-- Immediately requeue existing safe interrupted customer launches (including
-- the affected Vertrieb02 plan, if it still matches the safety conditions).
select * from public.recover_interrupted_meta_customer_launches(null);

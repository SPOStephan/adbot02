-- A customer launch click must always be accepted. Actual Meta writes remain
-- serialised by claim_meta_account_operation; a busy account therefore queues
-- the newly approved plan instead of rejecting the customer action.

create or replace function public.meta_launch_account_blocks_exclusive_approve(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_excluding_plan_id uuid,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

revoke all on function public.meta_launch_account_blocks_exclusive_approve(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.meta_launch_account_blocks_exclusive_approve(
  uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.meta_launch_account_blocks_exclusive_approve(
  uuid, uuid, uuid, timestamptz
) is
  'Customer launch approval is always accepted; per-account Meta writes are serialised by the executor account-operation lease and remain queued until claimable.';

-- One-time clean restart requested for the current Boncred funnel launches.
-- Only plans that never started locally and have no known remote Meta object are
-- cancelled. Audit rows and plans with any execution/binding remain untouched.
with safe_boncred_plans as materialized (
  select mp.id
  from public.mutation_plans mp
  where mp.source_rule_key = 'active-launch-chain'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.attempt_count = 0
    and mp.lease_token is null
    and coalesce(
      mp.planned_payload->>'destination_url',
      mp.planned_payload#>>'{launch_inputs,destination_url}',
      mp.planned_payload#>>'{canonical_launch_inputs,destination_url}',
      ''
    ) like 'https://jobs.boncred.info/%'
    and not exists (
      select 1
      from public.mutation_executions execution
      where execution.plan_id = mp.id
    )
    and not exists (
      select 1
      from public.remote_object_bindings binding
      where binding.plan_id = mp.id
    )
    and not exists (
      select 1
      from public.mutation_plan_steps step
      where step.plan_id = mp.id
        and (
          step.status <> 'PENDING'
          or step.dispatch_state <> 'NOT_DISPATCHED'
          or step.attempt_count <> 0
        )
    )
), cancelled_boncred_plans as (
  update public.mutation_plans mp
  set
    status = 'CANCELLED',
    blocked_reason = 'customer_requested_clean_restart',
    terminal_at = now(),
    updated_at = now()
  where mp.id in (select id from safe_boncred_plans)
  returning mp.id
)
delete from public.daily_budget_exposures exposure
where exposure.source = 'PLAN'
  and exposure.plan_id in (select id from cancelled_boncred_plans);

-- Periodic hygiene: only abandoned, unapproved HELD plans are maintenance
-- candidates. Accepted queue entries have an approval row and are preserved,
-- as are all plans with an execution, a dispatch attempt or a remote binding.
create or replace function public.cleanup_stale_meta_customer_launches(
  p_user_id uuid default null,
  p_min_age_seconds integer default 7200
)
returns table (
  cancelled_plans integer,
  released_exposures integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_ids uuid[] := array[]::uuid[];
  v_cancelled integer := 0;
  v_released integer := 0;
begin
  if p_min_age_seconds < 300 or p_min_age_seconds > 604800 then
    raise exception 'Launch maintenance age must be between 300 and 604800 seconds';
  end if;

  select coalesce(array_agg(mp.id), array[]::uuid[])
  into v_plan_ids
  from public.mutation_plans mp
  where (p_user_id is null or mp.user_id = p_user_id)
    and mp.source_rule_key = 'active-launch-chain'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.attempt_count = 0
    and mp.lease_token is null
    and mp.created_at <= now() - make_interval(secs => p_min_age_seconds)
    and mp.not_before = 'infinity'::timestamptz
    and not exists (
      select 1
      from public.meta_launch_canary_approvals approval
      where approval.plan_id = mp.id
    )
    and not exists (
      select 1
      from public.mutation_executions execution
      where execution.plan_id = mp.id
    )
    and not exists (
      select 1
      from public.remote_object_bindings binding
      where binding.plan_id = mp.id
    )
    and not exists (
      select 1
      from public.mutation_plan_steps step
      where step.plan_id = mp.id
        and (
          step.status <> 'PENDING'
          or step.dispatch_state <> 'NOT_DISPATCHED'
          or step.attempt_count <> 0
        )
    );

  if cardinality(v_plan_ids) = 0 then
    return query select 0, 0;
    return;
  end if;

  update public.mutation_plans mp
  set
    status = 'CANCELLED',
    blocked_reason = 'stale_unapproved_customer_launch',
    terminal_at = now(),
    updated_at = now()
  where mp.id = any(v_plan_ids)
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.attempt_count = 0
    and mp.lease_token is null;
  get diagnostics v_cancelled = row_count;

  delete from public.daily_budget_exposures exposure
  where exposure.source = 'PLAN'
    and exposure.plan_id = any(v_plan_ids);
  get diagnostics v_released = row_count;

  return query select v_cancelled, v_released;
end;
$$;

revoke all on function public.cleanup_stale_meta_customer_launches(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_meta_customer_launches(uuid, integer)
  to service_role;

comment on function public.cleanup_stale_meta_customer_launches(uuid, integer) is
  'Cancels only stale unapproved HELD customer launches with no execution, dispatch or remote binding; accepted queue entries remain untouched.';

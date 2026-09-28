-- Duplicate protection for customer launches.
--
-- Evidence (2026-09-28, "Boncred Vertrieb Immo01_01 AB"): the first launch
-- (a69ff483, 10:47) got stuck at the step limit. The customer started the same
-- content again at 12:22 (68ec42fc, same URL and budget, newer marketing sync,
-- therefore a new idempotency key and a new tracking suffix). The second launch
-- succeeded. Hours later the stuck first launch was resumed and a second,
-- identical campaign went live.
--
-- 1. meta_launch_content_fingerprint: the launch content without volatile
--    parts (tracking suffix in names, hashes, provisional keys).
-- 2. Approving a launch is refused while an identical accepted launch on the
--    same account is still open or resumable (it is continued instead), or
--    succeeded within the last 24 hours.
-- 3. Recovery and resume_failed_meta_customer_launch never continue a launch
--    that a newer identical launch has already replaced.
--
-- Note: plpgsql bodies avoid the INTO clause form (Supabase SQL editor issue).

begin;

create or replace function public.meta_launch_content_fingerprint(
  p_payload jsonb
)
returns text
language sql
stable
set search_path = ''
as $$
  select public.meta_sha256(
    regexp_replace(
      (
        p_payload - array[
          'blueprint_hash', 'brand_profile_hash',
          'provisional_campaign_scope_key', 'provisional_budget_owner_key'
        ]
      )::text,
      ' \[[0-9a-f]{12}-[a-z0-9]{1,3}\]',
      '',
      'g'
    )
  );
$$;

-- Newer accepted launch with identical content that succeeded or is open.
create or replace function public.meta_launch_superseded_by_newer(
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
    from public.mutation_plans old_plan
    join public.mutation_plans newer
      on newer.user_id = old_plan.user_id
     and newer.platform_account_id = old_plan.platform_account_id
     and newer.id <> old_plan.id
     and newer.created_at > old_plan.created_at
     and newer.action_type = 'LAUNCH_CHAIN'
     and newer.source_rule_key = 'active-launch-chain'
     and newer.status in (
       'SUCCEEDED', 'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING'
     )
    join public.meta_launch_canary_approvals approval
      on approval.plan_id = newer.id
    where old_plan.id = p_plan_id
      and old_plan.action_type = 'LAUNCH_CHAIN'
      and old_plan.source_rule_key = 'active-launch-chain'
      and public.meta_launch_content_fingerprint(newer.planned_payload)
        = public.meta_launch_content_fingerprint(old_plan.planned_payload)
  );
$$;

create or replace function public.guard_meta_launch_duplicate_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_other record;
begin
  for v_plan in
    select mp.* from public.mutation_plans mp where mp.id = new.plan_id
  loop exit; end loop;

  if not found
    or v_plan.action_type <> 'LAUNCH_CHAIN'
    or v_plan.source_rule_key is distinct from 'active-launch-chain' then
    return new;
  end if;

  for v_other in
    select other.id, other.status,
      exists (
        select 1 from public.remote_object_bindings binding
        where binding.plan_id = other.id
      ) as has_bindings,
      other.terminal_at
    from public.mutation_plans other
    join public.meta_launch_canary_approvals approval
      on approval.plan_id = other.id
    where other.user_id = v_plan.user_id
      and other.platform_account_id = v_plan.platform_account_id
      and other.id <> v_plan.id
      and other.action_type = 'LAUNCH_CHAIN'
      and other.source_rule_key = 'active-launch-chain'
      and public.meta_launch_content_fingerprint(other.planned_payload)
        = public.meta_launch_content_fingerprint(v_plan.planned_payload)
      and (
        other.status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING')
        or (
          other.status in ('FAILED', 'BLOCKED', 'STALE')
          and other.terminal_at > now() - interval '7 days'
          and exists (
            select 1 from public.remote_object_bindings binding
            where binding.plan_id = other.id
          )
        )
        or (
          other.status = 'SUCCEEDED'
          and other.terminal_at > now() - interval '24 hours'
        )
      )
    order by other.created_at desc
    limit 1
  loop
    if v_other.status = 'SUCCEEDED' then
      raise exception 'duplicate_customer_launch_succeeded:%', v_other.id;
    end if;
    raise exception 'duplicate_customer_launch_open:%', v_other.id;
  end loop;

  return new;
end;
$$;

drop trigger if exists guard_meta_launch_duplicate_approval
  on public.meta_launch_canary_approvals;
create trigger guard_meta_launch_duplicate_approval
  before insert on public.meta_launch_canary_approvals
  for each row execute function public.guard_meta_launch_duplicate_approval();

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
      and not public.meta_launch_superseded_by_newer(mp.id)
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
      and not public.meta_launch_superseded_by_newer(mp.id)
      and (
        (
          mp.status = 'STALE'
          and mp.blocked_reason = 'launch_canary_preflight_drift'
        )
        or (
          mp.status = 'PENDING'
          and mp.attempt_count >= mp.max_attempts
        )
        or (
          mp.status = 'BLOCKED'
          and mp.blocked_reason = 'writes_frozen'
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
        or (
          plan.status = 'BLOCKED'
          and plan.blocked_reason = 'writes_frozen'
        )
      );

    if found then
      v_recovered := v_recovered + 1;
      perform public.meta_resume_approved_launch_write_gate(v_plan.id);
    end if;
  end loop;

  return query select v_recovered;
end;
$$;

create or replace function public.resume_failed_meta_customer_launch(
  p_plan_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.meta_launch_superseded_by_newer(p_plan_id) then
    return 'SUPERSEDED';
  end if;

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

revoke all on function public.meta_launch_content_fingerprint(jsonb)
  from public, anon, authenticated;
revoke all on function public.meta_launch_superseded_by_newer(uuid)
  from public, anon, authenticated;
revoke all on function public.guard_meta_launch_duplicate_approval()
  from public, anon, authenticated, service_role;
-- The approval route requeues the existing identical launch instead of
-- creating a second one; it runs with the service role.
grant execute on function public.resume_failed_meta_customer_launch(uuid)
  to service_role;

comment on function public.meta_launch_content_fingerprint(jsonb) is
  'Launch content identity without volatile parts (tracking suffix, hashes, provisional keys); identical customer launches share it across marketing syncs.';
comment on function public.meta_launch_superseded_by_newer(uuid) is
  'True when a newer accepted launch with identical content succeeded or is open; recovery and resume must then leave the older launch alone.';

commit;

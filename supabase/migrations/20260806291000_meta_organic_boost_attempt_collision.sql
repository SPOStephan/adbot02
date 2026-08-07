-- claim_next inserts mutation_executions (plan_id, attempt_number) using
-- plan.attempt_count + 1. Payload-repair revives set attempt_count = 0 while
-- old FAILED rows keep attempt_number = 1 → unique violation
-- mutation_executions_plan_attempt_key → database_failed, no Meta HTTP.
--
-- Fix: next attempt is always max(plan.attempt_count, max(execution.attempt_number)) + 1.
-- One-shot: realign organic plan attempt_count / max_attempts to existing executions.

begin;

-- ---------------------------------------------------------------------------
-- 1) Patch claim_next to avoid attempt_number collisions
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_updated text;
  v_old constant text := 'v_attempt := v_plan.attempt_count + 1;';
  v_new constant text := $new$v_attempt := greatest(
      v_plan.attempt_count,
      coalesce((
        select max(me.attempt_number)
        from public.mutation_executions me
        where me.plan_id = v_plan.id
      ), 0)
    ) + 1;$new$;
begin
  select pg_get_functiondef(
    'public.claim_next_meta_mutation_execution(text,integer)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'claim_next_meta_mutation_execution not found';
  end if;

  if position('max(me.attempt_number)' in v_def) > 0 then
    return;
  end if;

  if position(v_old in v_def) = 0 then
    raise exception
      'claim_next_meta_mutation_execution missing attempt_count increment anchor';
  end if;

  v_updated := replace(v_def, v_old, v_new);

  if position('max(me.attempt_number)' in v_updated) = 0 then
    raise exception
      'Failed to patch claim_next_meta_mutation_execution attempt collision guard';
  end if;

  execute v_updated;
end;
$patch$;

-- ---------------------------------------------------------------------------
-- 2) Revive helper: do not rewind attempt_count below existing executions
-- ---------------------------------------------------------------------------
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

  -- Do not touch source_marketing_sync_id / payload: immutable intent.
  update public.mutation_plans mp
  set
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
          'writes_frozen'
        )
      )
      or (
        mp.status = 'FAILED'
        and coalesce(mp.error_class, '') in ('META', 'PREFLIGHT')
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
    and mp.status = 'PENDING'
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

comment on function public.revive_meta_organic_boost_superseded_plans(uuid, uuid) is
  'Revives organic-boost plans; attempt_count never rewinds below existing mutation_executions.';

-- ---------------------------------------------------------------------------
-- 3) One-shot heal: align attempt_count to max execution attempt_number
-- ---------------------------------------------------------------------------
update public.mutation_plans mp
set
  attempt_count = greatest(
    mp.attempt_count,
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
  status = case
    when mp.status in ('FAILED', 'STALE', 'BLOCKED', 'PREFLIGHT_FAILED') then 'PENDING'
    else mp.status
  end,
  lease_token = null,
  lease_owner = null,
  lease_expires_at = null,
  error_class = case
    when mp.status in ('FAILED', 'STALE', 'BLOCKED', 'PREFLIGHT_FAILED') then null
    else mp.error_class
  end,
  blocked_reason = case
    when mp.status in ('FAILED', 'STALE', 'BLOCKED', 'PREFLIGHT_FAILED') then null
    when mp.blocked_reason = 'account_operation_lease_busy' then null
    else mp.blocked_reason
  end,
  terminal_at = case
    when mp.status in ('FAILED', 'STALE', 'BLOCKED', 'PREFLIGHT_FAILED') then null
    else mp.terminal_at
  end,
  not_before = least(coalesce(mp.not_before, now()), now()),
  updated_at = now()
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and mp.status in (
    'PENDING', 'RETRYABLE', 'FAILED', 'STALE', 'BLOCKED', 'PREFLIGHT_FAILED'
  )
  and (
    mp.attempt_count < coalesce((
      select max(me.attempt_number)
      from public.mutation_executions me
      where me.plan_id = mp.id
    ), 0)
    or mp.id = 'f0697871-7f8a-4b9d-9c97-bfe1e41bd928'
  );

commit;

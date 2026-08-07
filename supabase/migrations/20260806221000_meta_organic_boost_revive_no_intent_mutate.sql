-- Repair: revive_meta_organic_boost_superseded_plans must not change immutable
-- intent columns (source_marketing_sync_id). Re-apply heal after the fix.

begin;

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
  -- Do not touch source_marketing_sync_id / payload: guard_meta_mutation_plan_update
  -- treats them as immutable intent. Organic preflight no longer requires sync match.
  update public.mutation_plans mp
  set
    status = 'PENDING',
    attempt_count = 0,
    max_attempts = greatest(coalesce(mp.max_attempts, 1), 3),
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
          'superseded_by_marketing_snapshot'
        )
      )
      or (
        mp.status = 'BLOCKED'
        and coalesce(mp.blocked_reason, '') in (
          'organic_preflight_kill_switch',
          'writes_frozen'
        )
      )
    )
    and not exists (
      select 1
      from public.mutation_executions execution
      where execution.plan_id = mp.id
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
  'Re-queue organic AUTO plans stuck as STALE/superseded or soft-blocked. Does not mutate immutable plan intent.';

do $heal$
declare
  v_row record;
begin
  for v_row in
    select distinct mp.user_id, mp.platform_account_id
    from public.mutation_plans mp
    where mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and (
        (
          mp.status = 'STALE'
          and coalesce(mp.blocked_reason, '') = 'superseded_by_marketing_snapshot'
        )
        or (
          mp.status in ('PENDING', 'RETRYABLE', 'BLOCKED')
          and coalesce(mp.blocked_reason, '') in (
            'organic_preflight_kill_switch',
            'writes_frozen',
            'organic_preflight_marketing_sync_stale',
            'organic_preflight_not_ready',
            'superseded_by_marketing_snapshot'
          )
        )
      )
  loop
    perform public.revive_meta_organic_boost_superseded_plans(
      v_row.user_id,
      v_row.platform_account_id
    );
  end loop;
end;
$heal$;

commit;

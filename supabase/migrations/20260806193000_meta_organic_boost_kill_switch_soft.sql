-- Organic Beitrag-Push must not die permanently when Kill-Switch is not ALLOW.
-- Autonomie path: keep PENDING, surface reason, retry after Freigeben.
-- Also revive plans already stuck as BLOCKED for kill-switch reasons.

begin;

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
    -- Clear stale soft-block hints once the plan is executable again.
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
      and account.marketing_sync_status = 'success'
      and account.marketing_last_success_at >= now() - interval '48 hours'
      and 'ads_management' = any(account.meta_scopes)
      and nullif(account.marketing_meta_ad_account_id, '') is not null
  ) then
    v_reason := 'organic_preflight_marketing_sync_stale';
  else
    v_reason := 'organic_preflight_not_ready';
  end if;

  -- Soft miss only: never terminal-BLOCK organic AUTO/REVIEW plans here.
  -- Claim will skip this tick; after Freigeben / readiness the next tick retries.
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
  'Organic LAUNCH_CHAIN preflight gate: soft-skip with reason (never terminal BLOCK). Non-organic still returns stale.';

-- Soft-skip organic plans in claim kill-switch gate instead of terminal BLOCK.
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

do $patch$
declare
  v_def text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.claim_next_meta_mutation_execution(text,integer)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'claim_next_meta_mutation_execution not found';
  end if;

  if position('meta_claim_apply_kill_switch_gate' in v_def) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_def,
    E'if v_kill_mode <> ''ALLOW'' then\\s+update public\\.mutation_plans\\s+set status = ''BLOCKED'',\\s+lease_token = null,\\s+lease_owner = null,\\s+lease_expires_at = null,\\s+error_class = ''KILL_SWITCH'',\\s+blocked_reason = ''writes_frozen'',\\s+terminal_at = now\\(\\),\\s+updated_at = now\\(\\)\\s+where id = v_plan\\.id;\\s+continue;\\s+end if;',
    $repl$if public.meta_claim_apply_kill_switch_gate(v_plan.id, v_kill_mode) = 'skip' then
      continue;
    end if;$repl$,
    1
  );

  if position('meta_claim_apply_kill_switch_gate' in v_updated) = 0 then
    raise exception 'Failed to patch claim_next_meta_mutation_execution kill-switch gate for organic boost';
  end if;

  execute v_updated;
end;
$patch$;

-- Revive organic plans already killed by the terminal kill-switch path.
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
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status in ('BLOCKED', 'STALE', 'PREFLIGHT_FAILED')
  and coalesce(mp.blocked_reason, '') in (
    'organic_preflight_kill_switch',
    'writes_frozen',
    'launch_canary_preflight_drift'
  )
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false;

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
  and mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status = 'PENDING'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and mps.status in ('FAILED', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'COMPENSATION_REQUIRED');

-- On Freigeben (ALLOW), immediately re-queue organic kill-switch soft/hard blocks.
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
      and (
        (
          mp.status = 'BLOCKED'
          and coalesce(mp.blocked_reason, '') in (
            'organic_preflight_kill_switch',
            'writes_frozen'
          )
        )
        or (
          mp.status in ('PENDING', 'RETRYABLE')
          and coalesce(mp.blocked_reason, '') in (
            'organic_preflight_kill_switch',
            'writes_frozen'
          )
        )
      )
      and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false;

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
      and mps.status in ('FAILED', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'COMPENSATION_REQUIRED');
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

commit;

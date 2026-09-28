-- Meta customer launch: finish every accepted launch without manual help.
--
-- Evidence (plan fe83a89a…, Vertrieb02, 2026-09-28):
-- 1. The customer drain processed exactly 24 steps (then the per-run limit),
--    claimed step 24 `activate-ad`, and threw `step_limit_reached`. The claimed
--    step never reached Meta; the plan kept an exhausted attempt budget
--    (1/1) and could not be claimed again. Campaign and ad set were ACTIVE,
--    the ad stayed PAUSED.
-- 2. After manual recovery the cron claimed an older sibling launch first. Its
--    terminal FAILED status fired the canary refreeze trigger, which froze the
--    whole ACCOUNT. 0.18 s later the claim for Vertrieb02 saw FREEZE_WRITES and
--    marked the approved, half-built launch terminally BLOCKED (writes_frozen).
--
-- Systemic fix:
-- * yield_meta_mutation_execution: a run that reaches its step limit (or has no
--   due step) ends at a clean step boundary and returns the plan to PENDING
--   with a fresh attempt. No recovery special case is needed any more.
-- * Account refreeze (trigger + reconcile) keeps ACCOUNT ALLOW while another
--   accepted customer launch on the same account is still open.
-- * Claim: an accepted customer launch waits for an ACCOUNT FREEZE_WRITES gate
--   instead of becoming terminally BLOCKED; read-back/reconcile-only remainders
--   are not writes and are not blocked by FREEZE_WRITES.
-- * Recovery also resumes accepted partial launches that a sibling refreeze
--   blocked, and lifts only a system refreeze that caused it.

begin;

create or replace function public.meta_plan_is_approved_customer_launch(
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
    from public.mutation_plans mp
    join public.meta_launch_canary_approvals approval
      on approval.plan_id = mp.id
     and approval.user_id = mp.user_id
     and approval.platform_account_id = mp.platform_account_id
    where mp.id = p_plan_id
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.source_rule_key = 'active-launch-chain'
  );
$$;

create or replace function public.meta_plan_has_open_remote_write_step(
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
    from public.mutation_plan_steps step
    where step.plan_id = p_plan_id
      and step.status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'RUNNING')
      and step.operation not in ('READ', 'RECONCILE')
  );
$$;

create or replace function public.meta_account_has_open_approved_launch(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_excluding_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mutation_plans mp
    join public.meta_launch_canary_approvals approval
      on approval.plan_id = mp.id
     and approval.user_id = mp.user_id
     and approval.platform_account_id = mp.platform_account_id
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.id is distinct from p_excluding_plan_id
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.source_rule_key = 'active-launch-chain'
      and mp.status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING')
  );
$$;

create or replace function public.meta_launch_refreeze_keeps_account_allow(
  p_user_id uuid,
  p_platform_account_id uuid,
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
      from public.meta_boost_settings settings
      where settings.user_id = p_user_id
        and settings.platform_account_id = p_platform_account_id
        and settings.is_current
        and settings.enabled
        and settings.boost_mode = 'AUTO'
        and settings.auto_boost_new_candidates
        and settings.require_manual_approval is not true
    )
    or public.meta_account_has_open_approved_launch(
      p_user_id, p_platform_account_id, p_plan_id
    );
$$;

-- Lifts only a *system* refreeze that blocked an accepted customer launch which
-- still has remote writes open. A customer's own FREEZE is never overridden.
create or replace function public.meta_resume_approved_launch_write_gate(
  p_plan_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_latest public.kill_switch_state%rowtype;
begin
  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = p_plan_id;

  if not found
    or not public.meta_plan_is_approved_customer_launch(p_plan_id)
    or not public.meta_plan_has_open_remote_write_step(p_plan_id) then
    return;
  end if;

  select kss.* into v_latest
  from public.kill_switch_state kss
  where kss.scope_type = 'ACCOUNT'
    and kss.user_id = v_plan.user_id
    and kss.platform_account_id = v_plan.platform_account_id
  order by kss.sequence desc
  limit 1;

  if found
    and v_latest.mode = 'FREEZE_WRITES'
    and v_latest.actor_type = 'SYSTEM'
    and v_latest.actor_id in (
      'meta-launch-canary-refreeze', 'meta-launch-canary-reconciler'
    ) then
    perform public.append_meta_kill_switch_state(
      'ACCOUNT', v_plan.user_id, v_plan.platform_account_id, null, 'ALLOW',
      'Freigegebener Aktiv-Launch wird fortgesetzt (System-Refreeze aufgehoben)',
      'SYSTEM', 'meta-launch-queue-resume'
    );
  end if;

  select kss.* into v_latest
  from public.kill_switch_state kss
  where kss.scope_type = 'PLAN'
    and kss.user_id = v_plan.user_id
    and kss.platform_account_id = v_plan.platform_account_id
    and kss.plan_id = v_plan.id
  order by kss.sequence desc
  limit 1;

  if found
    and v_latest.mode = 'FREEZE_WRITES'
    and v_latest.actor_type = 'SYSTEM'
    and v_latest.actor_id in (
      'meta-launch-canary-refreeze', 'meta-launch-canary-reconciler'
    ) then
    perform public.append_meta_kill_switch_state(
      'PLAN', v_plan.user_id, v_plan.platform_account_id, v_plan.id, 'ALLOW',
      'Freigegebener Aktiv-Launch wird fortgesetzt (System-Refreeze aufgehoben)',
      'SYSTEM', 'meta-launch-queue-resume'
    );
  end if;
end;
$$;

create or replace function public.yield_meta_mutation_execution(
  p_execution_id uuid,
  p_lease_token uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_next_not_before timestamptz;
begin
  select me.* into v_execution
  from public.mutation_executions me
  where me.id = p_execution_id
    and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then
    raise exception 'Active Meta execution is required';
  end if;

  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = v_execution.plan_id
    and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
    and mp.status in ('CLAIMED', 'EXECUTING', 'RECONCILING')
  for update;
  if not found then
    raise exception 'Active Meta plan lease is required';
  end if;

  -- Yield only at a clean boundary: nothing claimed, in flight or ambiguous.
  if exists (
    select 1
    from public.mutation_plan_steps step
    where step.plan_id = v_plan.id
      and (
        step.status in ('CLAIMED', 'RUNNING', 'FAILED', 'COMPENSATION_REQUIRED')
        or step.dispatch_state in ('PRE_DISPATCH', 'REMOTE_UNKNOWN')
      )
  ) then
    raise exception 'Meta execution can only yield at a clean step boundary';
  end if;

  select min(step.not_before) into v_next_not_before
  from public.mutation_plan_steps step
  where step.plan_id = v_plan.id
    and step.status in ('PENDING', 'RETRYABLE');

  if v_next_not_before is null then
    return 'NOTHING_OPEN';
  end if;

  update public.mutation_executions
  set status = 'ABANDONED',
      finished_at = now(),
      error_class = 'PROTOCOL',
      error_code = 'executor_yielded',
      last_heartbeat_at = now()
  where id = v_execution.id;

  -- A clean yield is progress, not a failed attempt: grant the next claim.
  update public.mutation_plans
  set status = 'PENDING',
      max_attempts = greatest(max_attempts, attempt_count + 1),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      not_before = greatest(now(), v_next_not_before),
      blocked_reason = null,
      error_class = null,
      terminal_at = null,
      updated_at = now()
  where id = v_plan.id;

  perform public.release_meta_account_operation(
    v_plan.platform_account_id, v_plan.user_id, p_lease_token
  );

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, null, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    'MUTATION_EXECUTION_YIELDED',
    jsonb_build_object('plan_status', v_plan.status),
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('plan_status', 'PENDING'),
    jsonb_build_object(
      'attempt_number', v_execution.attempt_number,
      'next_not_before', greatest(now(), v_next_not_before)
    ),
    null, null, null, null, null, now()
  );

  return 'YIELDED';
end;
$$;

create or replace function public.claim_meta_mutation_execution(
  p_worker_id text,
  p_lease_seconds integer default 300,
  p_plan_id uuid default null
)
returns table (
  execution_id uuid,
  plan_id uuid,
  user_id uuid,
  platform_account_id uuid,
  policy_id uuid,
  lease_token uuid,
  action_type text,
  target_type text,
  target_key text,
  planned_payload jsonb,
  expected_before jsonb,
  intended_after jsonb,
  first_step_id uuid,
  first_step_operation text,
  first_step_object_type text,
  first_step_request jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_execution_id uuid;
  v_lease_token uuid;
  v_attempt integer;
  v_kill_mode text;
  v_kill_scope text;
  v_ad_account_id text;
begin
  if nullif(p_worker_id, '') is null or char_length(p_worker_id) > 255 then
    raise exception 'Invalid Meta executor worker ID';
  end if;

  for v_plan in
    select mp.*
    from public.mutation_plans mp
    where (p_plan_id is null or mp.id = p_plan_id)
      and mp.status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING')
      and mp.not_before <= now()
      and mp.attempt_count < mp.max_attempts
      and (
        mp.status in ('PENDING', 'RETRYABLE')
        or mp.lease_expires_at <= now()
      )
    order by mp.safety_action desc, mp.priority asc, mp.created_at asc
    for update skip locked
  loop
    if v_plan.action_type = 'LAUNCH_CHAIN' then
      case public.meta_launch_execution_preflight_action(v_plan.id)
        when 'ok' then
          null;
        when 'skip' then
          continue;
        else
          update public.mutation_plans
          set status = 'STALE',
              lease_token = null,
              lease_owner = null,
              lease_expires_at = null,
              error_class = 'PREFLIGHT',
              blocked_reason = 'launch_canary_preflight_drift',
              terminal_at = now(),
              updated_at = now()
          where id = v_plan.id;
          continue;
      end case;
    end if;

    select ap.* into v_policy
    from public.automation_policies ap
    where ap.id = v_plan.policy_id
      and ap.user_id = v_plan.user_id
      and ap.platform_account_id = v_plan.platform_account_id
      and ap.is_current
      and ap.status = 'ACTIVE'
    for share;

    if not found then
      update public.mutation_plans
      set status = 'BLOCKED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'POLICY',
          blocked_reason = 'policy_inactive', terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    if (v_plan.action_type = 'UPDATE_BUDGET' and not v_policy.allow_budget_changes)
      or (v_plan.action_type in ('PAUSE', 'ACTIVATE', 'SAFETY_PAUSE')
          and not v_policy.allow_status_changes)
      or (v_plan.action_type in ('LAUNCH_CHAIN', 'LAUNCH_AD')
          and not v_policy.allow_new_launches) then
      update public.mutation_plans
      set status = 'BLOCKED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'POLICY',
          blocked_reason = 'action_not_allowed', terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    select pa.marketing_meta_ad_account_id into v_ad_account_id
    from public.platform_accounts pa
    where pa.id = v_plan.platform_account_id
      and pa.user_id = v_plan.user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and pa.access_token_encrypted is not null
      and pa.token_iv is not null
      and pa.token_auth_tag is not null
      and (pa.expires_at is null or pa.expires_at > now() + interval '5 minutes')
      and (pa.data_access_expires_at is null
           or pa.data_access_expires_at > now() + interval '5 minutes')
      and 'ads_management' = any(pa.meta_scopes)
      and jsonb_typeof(pa.ad_account_ids) = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(pa.ad_account_ids) allowed(value)
        where regexp_replace(allowed.value, '^act_', '')
              = regexp_replace(pa.marketing_meta_ad_account_id, '^act_', '')
      );

    if not found or v_ad_account_id is null then
      update public.mutation_plans
      set status = 'BLOCKED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'CONNECTOR',
          blocked_reason = 'ads_management_reconnect_required',
          terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    select ks.mode, ks.scope_type into v_kill_mode, v_kill_scope
    from public.get_effective_meta_kill_switch(
      v_plan.user_id, v_plan.platform_account_id, v_plan.id
    ) ks;

    if v_kill_mode = 'FREEZE_WRITES'
      and v_plan.action_type = 'LAUNCH_CHAIN'
      and not public.meta_plan_has_open_remote_write_step(v_plan.id) then
      -- Only read-back and reconciliation remain. FREEZE_WRITES blocks Meta
      -- writes, not the confirmation that already applied writes are ACTIVE.
      null;
    elsif v_kill_mode = 'FREEZE_WRITES'
      and v_kill_scope = 'ACCOUNT'
      and public.meta_plan_is_approved_customer_launch(v_plan.id) then
      -- An accepted customer launch waits for the account write gate (e.g. the
      -- short freeze while another launch is prepared) instead of becoming a
      -- terminal BLOCKED plan with half-built, paused Meta objects.
      update public.mutation_plans
      set blocked_reason = 'account_write_gate_waiting', updated_at = now()
      where id = v_plan.id
        and blocked_reason is distinct from 'account_write_gate_waiting';
      continue;
    elsif v_kill_mode <> 'ALLOW' then
      update public.mutation_plans
      set status = 'BLOCKED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'KILL_SWITCH',
          blocked_reason = 'writes_frozen', terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    if v_plan.automation_target_id is not null then
      select at.* into v_target
      from public.automation_targets at
      where at.id = v_plan.automation_target_id
        and at.user_id = v_plan.user_id
        and at.platform_account_id = v_plan.platform_account_id
        and at.status = 'MANAGED'
      for update;

      if not found
        or v_target.target_type <> v_plan.target_type
        or v_target.target_key <> v_plan.target_key
        or v_target.platform_object_id !~ '^[1-9][0-9]{0,39}$'
        or not public.meta_executor_before_matches(v_plan, v_target) then
        update public.mutation_plans
        set status = 'STALE', lease_token = null, lease_owner = null,
            lease_expires_at = null, error_class = 'PREFLIGHT',
            blocked_reason = 'before_state_drift', terminal_at = now(), updated_at = now()
        where id = v_plan.id;
        continue;
      end if;
    elsif v_plan.action_type not in ('LAUNCH_CHAIN', 'LAUNCH_AD') then
      update public.mutation_plans
      set status = 'PREFLIGHT_FAILED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'PREFLIGHT',
          blocked_reason = 'missing_automation_target', terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    v_lease_token := public.claim_meta_account_operation(
      v_plan.platform_account_id,
      v_plan.user_id,
      'WRITE_EXECUTION',
      p_worker_id,
      greatest(60, least(900, p_lease_seconds))
    );

    if v_lease_token is null then
      continue;
    end if;

    select mps.* into v_step
    from public.mutation_plan_steps mps
    where mps.plan_id = v_plan.id
      and mps.status in ('PENDING', 'RETRYABLE')
      and mps.not_before <= now()
      and (
        mps.depends_on_step_id is null
        or exists (
          select 1 from public.mutation_plan_steps dependency
          where dependency.id = mps.depends_on_step_id
            and dependency.plan_id = v_plan.id
            and dependency.status in ('VALIDATED', 'REMOTE_APPLIED', 'RECONCILED', 'SKIPPED')
        )
      )
    order by mps.step_index
    limit 1
    for update;

    if not found then
      perform public.release_meta_account_operation(
        v_plan.platform_account_id, v_plan.user_id, v_lease_token
      );
      continue;
    end if;

    v_attempt := v_plan.attempt_count + 1;
    v_execution_id := gen_random_uuid();

    update public.mutation_plans
    set status = case
          when v_step.operation = 'RECONCILE' then 'RECONCILING'
          else 'CLAIMED'
        end,
        attempt_count = v_attempt,
        lease_token = v_lease_token,
        lease_owner = p_worker_id,
        lease_expires_at = now() + make_interval(
          secs => greatest(60, least(900, p_lease_seconds))
        ),
        blocked_reason = null,
        error_class = null,
        terminal_at = null,
        updated_at = now()
    where id = v_plan.id;

    insert into public.mutation_executions (
      id, plan_id, user_id, platform_account_id, attempt_number, worker_id,
      lease_token, status, started_at, last_heartbeat_at
    ) values (
      v_execution_id, v_plan.id, v_plan.user_id, v_plan.platform_account_id,
      v_attempt, p_worker_id, v_lease_token, 'CLAIMED', now(), now()
    );

    update public.mutation_plan_steps
    set status = 'CLAIMED', attempt_count = attempt_count + 1,
        started_at = coalesce(started_at, now()), error_class = null,
        error_code = null, updated_at = now()
    where id = v_step.id;

    update public.platform_accounts as pa
    set automation_executor_status = 'running',
        automation_executor_error_code = null,
        automation_executor_last_run_at = now(),
        automation_executor_last_plan_id = v_plan.id,
        updated_at = now()
    where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

    perform public.append_meta_mutation_audit_event(
      v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
      v_plan.id, v_step.id, v_execution_id, 'EXECUTOR', p_worker_id,
      'MUTATION_EXECUTION_CLAIMED',
      jsonb_build_object('plan_status', v_plan.status, 'step_status', v_step.status),
      jsonb_build_object('request_hash', v_step.request_hash),
      '{}'::jsonb,
      jsonb_build_object('plan_status', 'CLAIMED', 'step_status', 'CLAIMED'),
      jsonb_build_object('attempt_number', v_attempt),
      null, null, null, null, null, now()
    );

    return query select
      v_execution_id, v_plan.id, v_plan.user_id, v_plan.platform_account_id,
      v_plan.policy_id, v_lease_token, v_plan.action_type, v_plan.target_type,
      v_plan.target_key, v_plan.planned_payload, v_plan.expected_before,
      v_plan.intended_after, v_step.id, v_step.operation, v_step.object_type,
      v_step.planned_request;
    return;
  end loop;
end;
$$;

create or replace function public.reconcile_meta_mutation_plan(
  p_execution_id uuid,p_step_id uuid,p_lease_token uuid)
returns table(outcome text,plan_id uuid,ledger_id uuid,snapshot_id uuid)
language plpgsql security definer set search_path='' as $$
declare
 v_action_type text; v_rule text; v_contract text; v_user uuid; v_account uuid;
 v_plan uuid; v_result record; v_account_mode text; v_plan_mode text;
begin
 select mp.action_type,mp.source_rule_key,mp.planned_payload->>'contract',mp.user_id,
   mp.platform_account_id,mp.id into v_action_type,v_rule,v_contract,v_user,v_account,v_plan
 from public.mutation_executions me join public.mutation_plans mp on mp.id=me.plan_id
 where me.id=p_execution_id and me.lease_token=p_lease_token;
 if v_action_type='LAUNCH_AD' and v_rule='meta_creative_format_optimizer_v1'
    and v_contract='meta_existing_adset_creative_test_v1' then
   return query select * from public.reconcile_meta_creative_format_optimizer_plan(p_execution_id,p_step_id,p_lease_token); return;
 end if;
 if v_action_type='PAUSE' and v_rule='meta_creative_format_optimizer_v1'
    and v_contract='meta_creative_evidence_pause_v1' then
   select result.* into v_result
   from public.reconcile_meta_mutation_plan_base(
     p_execution_id, p_step_id, p_lease_token
   ) result;
   if v_result.outcome = 'SUCCEEDED' then
     update public.meta_creative_optimization_cycles cycle
     set status = 'COMPLETED', completed_at = now(),
       completion_reason = 'operational_traffic_dominance', updated_at = now()
     where cycle.id::text = (
       select mp.planned_payload->>'optimization_cycle_id'
       from public.mutation_plans mp
       where mp.id = v_plan
     )
       and cycle.status = 'PAUSE_PLANNED';
   end if;
   return query select v_result.outcome::text, v_result.plan_id::uuid,
     v_result.ledger_id::uuid, v_result.snapshot_id::uuid;
   return;
 end if;
   if v_action_type in ('LAUNCH_CHAIN','LAUNCH_AD') then
     select result.* into v_result from public.reconcile_meta_launch_mutation_plan(p_execution_id,p_step_id,p_lease_token) result;
     if v_action_type='LAUNCH_CHAIN' and v_rule <> 'organic-boost' then
     select latest.mode into v_account_mode from public.kill_switch_state latest
      where latest.scope_type='ACCOUNT' and latest.user_id=v_user and latest.platform_account_id=v_account
      order by latest.sequence desc limit 1;
     if coalesce(v_account_mode,'FREEZE_WRITES')<>'FREEZE_WRITES'
        and not public.meta_launch_refreeze_keeps_account_allow(v_user,v_account,v_plan) then
       perform public.append_meta_kill_switch_state('ACCOUNT',v_user,v_account,null,'FREEZE_WRITES',
         'Atomarer Aktiv-Launch wurde reconciliert: '||v_result.outcome,'SYSTEM','meta-launch-canary-reconciler');
     end if;
     select latest.mode into v_plan_mode from public.kill_switch_state latest
      where latest.scope_type='PLAN' and latest.user_id=v_user and latest.platform_account_id=v_account
        and latest.plan_id=v_plan order by latest.sequence desc limit 1;
     if coalesce(v_plan_mode,'FREEZE_WRITES')<>'FREEZE_WRITES' then
       perform public.append_meta_kill_switch_state('PLAN',v_user,v_account,v_plan,'FREEZE_WRITES',
         'Atomarer Aktiv-Launch wurde reconciliert: '||v_result.outcome,'SYSTEM','meta-launch-canary-reconciler');
     end if;
   end if;
   return query select v_result.outcome::text,v_result.plan_id::uuid,v_result.ledger_id::uuid,v_result.snapshot_id::uuid; return;
 end if;
 return query select result.outcome,result.plan_id,result.ledger_id,result.snapshot_id
 from public.reconcile_meta_mutation_plan_base(p_execution_id,p_step_id,p_lease_token) result;
end;
$$;

create or replace function public.refreeze_meta_launch_plan_after_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_mode text;
  v_plan_mode text;
  v_keep_account_allow boolean := false;
begin
  if new.action_type <> 'LAUNCH_CHAIN'
    or new.safety_action
    or old.status is not distinct from new.status
    or new.status not in (
      'RECONCILING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STALE',
      'PREFLIGHT_FAILED', 'COMPENSATION_REQUIRED', 'CANCELLED'
    ) then
    return new;
  end if;

  -- Organic AUTO Beitrag-Push keeps account-level Freigeben for further posts.
  if new.source_rule_key = 'organic-boost' then
    return new;
  end if;

  if new.status = 'RECONCILING'
    and exists (
      select 1
      from public.mutation_plan_steps step
      where step.plan_id = new.id
        and step.operation in ('VALIDATE', 'CREATE', 'UPDATE')
        and step.status not in (
          'VALIDATED', 'REMOTE_APPLIED', 'RECONCILED', 'SKIPPED'
        )
    ) then
    return new;
  end if;

  -- Traffic/Lead terminals must not revoke Freigeben while Beitrag-Push AUTO
  -- is the customer's configured default workflow.
  select exists (
    select 1
    from public.meta_boost_settings settings
    where settings.user_id = new.user_id
      and settings.platform_account_id = new.platform_account_id
      and settings.is_current
      and settings.enabled
      and settings.boost_mode = 'AUTO'
      and settings.auto_boost_new_candidates
      and settings.require_manual_approval is not true
  ) into v_keep_account_allow;

  -- Another accepted customer launch on this account still needs the write
  -- gate. Refreezing the ACCOUNT here would terminally strand it.
  v_keep_account_allow := v_keep_account_allow
    or public.meta_account_has_open_approved_launch(
      new.user_id, new.platform_account_id, new.id
    );

  select latest.mode into v_account_mode
  from public.kill_switch_state latest
  where latest.scope_type = 'ACCOUNT'
    and latest.user_id = new.user_id
    and latest.platform_account_id = new.platform_account_id
  order by latest.sequence desc
  limit 1;

  if not v_keep_account_allow
    and coalesce(v_account_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    perform public.append_meta_kill_switch_state(
      'ACCOUNT', new.user_id, new.platform_account_id, null,
      'FREEZE_WRITES',
      case when new.status = 'RECONCILING'
        then 'Atomarer Aktiv-Launch hat alle Remote-Writes beendet'
        else 'Atomarer Aktiv-Launch ist terminal beendet'
      end,
      'SYSTEM', 'meta-launch-canary-refreeze'
    );
  end if;

  select latest.mode into v_plan_mode
  from public.kill_switch_state latest
  where latest.scope_type = 'PLAN'
    and latest.user_id = new.user_id
    and latest.platform_account_id = new.platform_account_id
    and latest.plan_id = new.id
  order by latest.sequence desc
  limit 1;

  if coalesce(v_plan_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    perform public.append_meta_kill_switch_state(
      'PLAN', new.user_id, new.platform_account_id, new.id,
      'FREEZE_WRITES',
      'Atomarer Aktiv-Launch ist nicht mehr remote-schreibbar: ' || new.status,
      'SYSTEM', 'meta-launch-canary-refreeze'
    );
  end if;

  perform public.append_meta_mutation_audit_event(
    new.user_id,
    new.platform_account_id,
    new.policy_id,
    new.id,
    null,
    null,
    'SYSTEM',
    'meta-launch-canary-refreeze',
    'LAUNCH_CANARY_WRITES_REFROZEN',
    jsonb_build_object('plan_status', old.status),
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object(
      'plan_status', new.status,
      'account_kill_switch', case
        when v_keep_account_allow then coalesce(v_account_mode, 'ALLOW')
        else 'FREEZE_WRITES'
      end,
      'plan_kill_switch', 'FREEZE_WRITES',
      'kept_account_allow_for_organic_auto', v_keep_account_allow
    ),
    '{}'::jsonb,
    null, null, null, null, new.error_class, now()
  );

  return new;
end;
$$;

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

revoke all on function public.meta_plan_is_approved_customer_launch(uuid)
  from public, anon, authenticated;
revoke all on function public.meta_plan_has_open_remote_write_step(uuid)
  from public, anon, authenticated;
revoke all on function public.meta_account_has_open_approved_launch(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.meta_launch_refreeze_keeps_account_allow(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.meta_resume_approved_launch_write_gate(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.yield_meta_mutation_execution(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.yield_meta_mutation_execution(uuid, uuid)
  to service_role;

comment on function public.yield_meta_mutation_execution(uuid, uuid) is
  'Ends a Meta execution at a clean step boundary and requeues the same plan with a fresh attempt; never replays applied steps.';
comment on function public.meta_account_has_open_approved_launch(uuid, uuid, uuid) is
  'True while another accepted customer launch on the account still has open work; the canary refreeze must then keep ACCOUNT ALLOW.';

commit;

-- Resume accepted launches that a sibling refreeze or the old step limit left
-- stranded (only with Meta bindings, open steps, no failed/ambiguous step).
select * from public.recover_interrupted_meta_customer_launches(null);

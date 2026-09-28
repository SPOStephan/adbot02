-- Accepted customer launches: a write rejected *before* it reached Meta is
-- retried instead of ending the launch as FAILED.
--
-- Remaining risk after the 2026-09-28 fixes: while one launch is executing,
-- preparing another launch briefly sets the account to FREEZE_WRITES. If the
-- running launch dispatches exactly then, begin_meta_mutation_step_dispatch
-- rejects the write (nothing is sent). fail_meta_mutation_execution only
-- retried while attempt_count < max_attempts, and launch plans start with
-- max_attempts = 1, so the launch ended FAILED with paused Meta objects and
-- needed resume_failed_meta_customer_launch by hand.
--
-- Fix: for accepted customer launches whose campaign already exists at Meta,
-- a NOT_APPLIED TRANSPORT/RATE_LIMIT failure becomes RETRYABLE (bounded by the
-- 20-attempt constraint). Sent or ambiguous writes keep their existing
-- handling. Launches without a Meta campaign yet keep the one-shot canary gate.
--
-- Note: plpgsql bodies avoid the INTO clause form (Supabase SQL editor issue).

begin;

create or replace function public.fail_meta_mutation_execution(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid,
  p_error_class text,
  p_error_code text,
  p_remote_outcome text,
  p_retry_after_seconds integer default 120,
  p_error_detail text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_retryable boolean;
  v_resume_retry boolean;
  v_plan_status text;
  v_step_status text;
  v_execution_status text;
  v_safe_code text;
  v_safe_detail text;
begin
  if p_remote_outcome not in ('NOT_APPLIED', 'UNKNOWN', 'PERMANENT')
    or p_error_class not in ('TRANSPORT', 'RATE_LIMIT', 'AUTH', 'META', 'PROTOCOL', 'PREFLIGHT', 'RECONCILIATION') then
    raise exception 'Invalid Meta execution failure classification';
  end if;

  v_safe_code := public.meta_executor_safe_error_code(p_error_code);
  v_safe_detail := public.meta_executor_safe_error_detail(p_error_detail);

  for v_execution in
  select me.*  from public.mutation_executions me
  where me.id = p_execution_id and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update
  loop exit; end loop;
  if not found then raise exception 'Active Meta execution is required'; end if;

  for v_plan in
  select mp.*  from public.mutation_plans mp
  where mp.id = v_execution.plan_id and mp.lease_token = p_lease_token
  for update
  loop exit; end loop;

  for v_step in
  select mps.*  from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.status in ('CLAIMED', 'RUNNING')
  for update
  loop exit; end loop;
  if not found then raise exception 'Active Meta mutation step is required'; end if;

  -- An accepted customer launch whose campaign already exists at Meta must
  -- not end FAILED (half-built, paused objects) because a write was rejected
  -- *before* it reached Meta, e.g. by the short account freeze while another
  -- launch is being prepared. Retry it, bounded by the attempt constraint.
  v_resume_retry := p_remote_outcome = 'NOT_APPLIED'
    and p_error_class in ('TRANSPORT', 'RATE_LIMIT')
    and v_plan.action_type = 'LAUNCH_CHAIN'
    and v_plan.attempt_count < 20
    and public.meta_plan_is_approved_customer_launch(v_plan.id)
    and exists (
      select 1
      from public.remote_object_bindings binding
      where binding.plan_id = v_plan.id
        and binding.object_type = 'CAMPAIGN'
    );

  v_retryable := p_remote_outcome = 'NOT_APPLIED'
    and p_error_class in ('TRANSPORT', 'RATE_LIMIT')
    and (v_plan.attempt_count < v_plan.max_attempts or v_resume_retry);

  if p_remote_outcome = 'UNKNOWN'
    and v_plan.action_type = 'LAUNCH_CHAIN' then
    v_plan_status := 'COMPENSATION_REQUIRED';
    v_step_status := 'COMPENSATION_REQUIRED';
    v_execution_status := 'COMPENSATION_REQUIRED';
  elsif p_remote_outcome = 'UNKNOWN' then
    v_plan_status := 'RECONCILING';
    v_step_status := 'REMOTE_APPLIED';
    v_execution_status := 'RECONCILING';
  elsif v_retryable then
    v_plan_status := 'RETRYABLE';
    v_step_status := 'RETRYABLE';
    v_execution_status := 'RETRYABLE';
  elsif v_step.compensation_operation = 'PAUSE'
    and p_remote_outcome <> 'NOT_APPLIED' then
    v_plan_status := 'COMPENSATION_REQUIRED';
    v_step_status := 'COMPENSATION_REQUIRED';
    v_execution_status := 'COMPENSATION_REQUIRED';
  else
    v_plan_status := 'FAILED';
    v_step_status := 'FAILED';
    v_execution_status := 'FAILED';
  end if;

  update public.mutation_plan_steps
  set status = v_step_status,
      dispatch_state = case
        when p_remote_outcome = 'UNKNOWN' then 'REMOTE_UNKNOWN'
        when p_remote_outcome = 'NOT_APPLIED' then 'NOT_DISPATCHED'
        else dispatch_state
      end,
      dispatch_started_at = case
        when p_remote_outcome = 'NOT_APPLIED' then null
        else dispatch_started_at
      end,
      not_before = case when v_retryable
        then now() + make_interval(secs => greatest(30, least(86400, p_retry_after_seconds)))
        else not_before end,
      completed_at = case when v_step_status in ('FAILED', 'COMPENSATION_REQUIRED')
        then now() else completed_at end,
      error_class = p_error_class,
      error_code = v_safe_code,
      error_detail = v_safe_detail,
      updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = v_execution_status, finished_at = case
        when v_execution_status in ('RETRYABLE', 'COMPENSATION_REQUIRED', 'FAILED')
          then now() else finished_at end,
      error_class = p_error_class,
      error_code = v_safe_code,
      error_message = v_safe_detail
  where id = v_execution.id;

  update public.mutation_plans
  set status = v_plan_status,
      max_attempts = case
        when v_retryable and attempt_count >= max_attempts
          then least(20, attempt_count + 1)
        else max_attempts
      end,
      not_before = case when v_retryable
        then now() + make_interval(secs => greatest(30, least(86400, p_retry_after_seconds)))
        else not_before end,
      lease_token = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_token
        else null end,
      lease_owner = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_owner
        else null end,
      lease_expires_at = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_expires_at
        else null end,
      terminal_at = case when v_plan_status in ('FAILED', 'COMPENSATION_REQUIRED')
        then now() else terminal_at end,
      error_class = p_error_class, blocked_reason = v_safe_code,
      updated_at = now()
  where id = v_plan.id;

  if p_remote_outcome <> 'UNKNOWN'
    or v_plan.action_type = 'LAUNCH_CHAIN' then
    perform public.release_meta_account_operation(
      v_plan.platform_account_id, v_plan.user_id, p_lease_token
    );
  end if;

  insert into public.automation_alerts (
    user_id, platform_account_id, plan_id, dedup_key, severity, alert_type,
    title, message, details, status, first_seen_at, last_seen_at
  ) values (
    v_plan.user_id, v_plan.platform_account_id, v_plan.id,
    'executor:' || v_plan.id::text || ':' || v_safe_code,
    case when p_remote_outcome = 'UNKNOWN' then 'CRITICAL'
         when v_plan_status = 'FAILED' then 'CRITICAL' else 'WARNING' end,
    case when p_remote_outcome = 'UNKNOWN'
      then 'REMOTE_OUTCOME_AMBIGUOUS' else 'MUTATION_EXECUTION_FAILED' end,
    case when p_remote_outcome = 'UNKNOWN'
      then 'Meta-Ergebnis muss abgeglichen werden'
      else 'Meta-Änderung konnte nicht abgeschlossen werden' end,
    case
      when p_remote_outcome = 'UNKNOWN'
        then 'Ein Remote-Aufruf wurde gesendet, sein Ergebnis ist jedoch unbekannt. Der Executor wiederholt die Mutation nicht blind.'
      when v_safe_detail is not null
        then left('Meta: ' || v_safe_detail, 1000)
      else 'Die geplante Meta-Änderung wurde sicher gestoppt. Weitere Schritte folgen gemäß Retry- und Kompensationsregeln.'
    end,
    jsonb_build_object(
      'error_class', p_error_class,
      'error_code', v_safe_code,
      'remote_outcome', p_remote_outcome,
      'error_detail', coalesce(v_safe_detail, '')
    ),
    'OPEN', now(), now()
  ) on conflict (platform_account_id, dedup_key) do update set
    severity = excluded.severity, alert_type = excluded.alert_type,
    title = excluded.title, message = excluded.message,
    details = excluded.details, status = 'OPEN', last_seen_at = now(),
    resolved_at = null, acknowledged_at = null, updated_at = now();

  update public.platform_accounts as pa
  set automation_executor_status = case
        when p_remote_outcome = 'UNKNOWN' then 'ambiguous'
        when v_retryable then 'retryable'
        else 'error' end,
      automation_executor_error_code = v_safe_code,
      automation_executor_last_run_at = now(),
      automation_executor_last_plan_id = v_plan.id,
      updated_at = now()
  where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    case when p_remote_outcome = 'UNKNOWN'
      then 'MUTATION_REMOTE_OUTCOME_AMBIGUOUS' else 'MUTATION_EXECUTION_FAILED' end,
    jsonb_build_object('plan_status', v_plan.status, 'step_status', v_step.status,
                       'dispatch_state', v_step.dispatch_state),
    jsonb_build_object('request_hash', v_step.request_hash), '{}'::jsonb,
    jsonb_build_object('plan_status', v_plan_status, 'step_status', v_step_status,
                       'remote_outcome', p_remote_outcome),
    jsonb_build_object(
      'retry_after_seconds', p_retry_after_seconds,
      'error_detail', coalesce(v_safe_detail, '')
    ),
    'meta', null, null, null, p_error_class, now()
  );

  return v_plan_status;
end;
$$;

commit;

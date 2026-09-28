-- Make the customer launch click execute its own approved plan instead of an
-- unrelated older plan from the global Meta mutation queue. All existing
-- policy, connector, kill-switch, before-state and account-lease checks remain.

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
    if v_plan.action_type = 'LAUNCH_CHAIN'
      and not public.meta_launch_canary_preflight_ok(v_plan.id) then
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

    select mode into v_kill_mode
    from public.get_effective_meta_kill_switch(
      v_plan.user_id, v_plan.platform_account_id, v_plan.id
    );

    if v_kill_mode <> 'ALLOW' then
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


create or replace function public.claim_next_meta_mutation_execution(
  p_worker_id text,
  p_lease_seconds integer default 300
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
language sql
security definer
set search_path = ''
as $$
  select *
  from public.claim_meta_mutation_execution(
    p_worker_id,
    p_lease_seconds,
    null
  );
$$;

create or replace function public.claim_meta_mutation_execution_for_plan(
  p_plan_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
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
language sql
security definer
set search_path = ''
as $$
  select *
  from public.claim_meta_mutation_execution(
    p_worker_id,
    p_lease_seconds,
    p_plan_id
  );
$$;

revoke all on function public.claim_meta_mutation_execution(text, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_next_meta_mutation_execution(text, integer)
  from public, anon, authenticated;
revoke all on function public.claim_meta_mutation_execution_for_plan(uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.claim_next_meta_mutation_execution(text, integer)
  to service_role;
grant execute on function public.claim_meta_mutation_execution_for_plan(uuid, text, integer)
  to service_role;

comment on function public.claim_meta_mutation_execution_for_plan(uuid, text, integer) is
  'Claims only the approved Meta mutation plan requested by the synchronous customer-launch drain while preserving every executor preflight and account lease.';

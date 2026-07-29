-- Idempotent Meta mutation executor v1.
--
-- PostgreSQL owns queue claims, account serialization, pre-dispatch safety checks,
-- remote-outcome ambiguity, reconciliation and audit. The TypeScript worker may
-- only execute a request returned by these service-role-only RPCs.

begin;

alter table public.platform_accounts
  add column if not exists automation_executor_status text not null default 'idle',
  add column if not exists automation_executor_error_code text,
  add column if not exists automation_executor_last_run_at timestamptz,
  add column if not exists automation_executor_last_success_at timestamptz,
  add column if not exists automation_executor_last_plan_id uuid;

alter table public.platform_accounts
  add constraint platform_accounts_automation_executor_status_check
    check (automation_executor_status in (
      'idle', 'running', 'success', 'retryable', 'blocked', 'ambiguous', 'error'
    ));

alter table public.mutation_plan_steps
  add column if not exists dispatch_state text not null default 'NOT_DISPATCHED',
  add column if not exists dispatch_started_at timestamptz,
  add column if not exists remote_applied_at timestamptz,
  add column if not exists remote_request_id text,
  add column if not exists response_fingerprint text;

alter table public.mutation_plan_steps
  add constraint mutation_plan_steps_dispatch_state_check check (
    dispatch_state in (
      'NOT_DISPATCHED', 'PRE_DISPATCH', 'REMOTE_UNKNOWN', 'REMOTE_APPLIED',
      'READ_BACK', 'RECONCILED'
    )
  ),
  add constraint mutation_plan_steps_dispatch_shape_check check (
    (dispatch_state = 'NOT_DISPATCHED' and dispatch_started_at is null)
    or (dispatch_state <> 'NOT_DISPATCHED' and dispatch_started_at is not null)
  ),
  add constraint mutation_plan_steps_remote_applied_check check (
    dispatch_state not in ('REMOTE_APPLIED', 'READ_BACK', 'RECONCILED')
    or remote_applied_at is not null
  ),
  add constraint mutation_plan_steps_response_fingerprint_check check (
    response_fingerprint is null or response_fingerprint ~ '^[0-9a-f]{64}$'
  );

create table public.meta_mutation_remote_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  policy_id uuid not null references public.automation_policies(id) on delete restrict,
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  step_id uuid not null references public.mutation_plan_steps(id) on delete restrict,
  execution_id uuid not null references public.mutation_executions(id) on delete restrict,
  object_type text not null check (object_type in (
    'ACCOUNT', 'CAMPAIGN', 'AD_SET', 'CREATIVE', 'IMAGE', 'AD'
  )),
  remote_object_id text not null,
  snapshot_kind text not null check (snapshot_kind in (
    'PREFLIGHT', 'READ_AFTER_WRITE', 'AMBIGUITY_PROBE', 'RECONCILIATION'
  )),
  snapshot_payload jsonb not null,
  response_fingerprint text not null,
  remote_request_id text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint meta_mutation_remote_snapshots_execution_step_kind_key
    unique (execution_id, step_id, snapshot_kind),
  constraint meta_mutation_remote_snapshots_payload_check check (
    jsonb_typeof(snapshot_payload) = 'object'
    and pg_catalog.octet_length(snapshot_payload::text) <= 262144
    and not public.meta_jsonb_has_sensitive_key(snapshot_payload)
  ),
  constraint meta_mutation_remote_snapshots_remote_id_check
    check (remote_object_id ~ '^[1-9][0-9]{0,39}$'),
  constraint meta_mutation_remote_snapshots_fingerprint_check
    check (response_fingerprint ~ '^[0-9a-f]{64}$')
);

create index meta_mutation_remote_snapshots_plan_observed_idx
  on public.meta_mutation_remote_snapshots (plan_id, observed_at desc);
create index meta_mutation_remote_snapshots_account_observed_idx
  on public.meta_mutation_remote_snapshots (platform_account_id, observed_at desc);
create index meta_mutation_remote_snapshots_user_idx
  on public.meta_mutation_remote_snapshots (user_id);
create index meta_mutation_remote_snapshots_policy_idx
  on public.meta_mutation_remote_snapshots (policy_id);

create or replace function public.guard_meta_executor_snapshot_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.mutation_executions me
    join public.mutation_plans mp on mp.id = me.plan_id
    join public.mutation_plan_steps mps
      on mps.id = new.step_id and mps.plan_id = mp.id
    where me.id = new.execution_id
      and mp.id = new.plan_id
      and mp.policy_id = new.policy_id
      and mp.user_id = new.user_id
      and mp.platform_account_id = new.platform_account_id
      and me.user_id = new.user_id
      and me.platform_account_id = new.platform_account_id
      and mps.user_id = new.user_id
      and mps.platform_account_id = new.platform_account_id
  ) then
    raise exception 'Executor snapshot scope is invalid';
  end if;

  return new;
end;
$$;

create trigger guard_meta_executor_snapshot_scope
  before insert or update on public.meta_mutation_remote_snapshots
  for each row execute function public.guard_meta_executor_snapshot_scope();

create trigger meta_mutation_remote_snapshots_append_only
  before update or delete on public.meta_mutation_remote_snapshots
  for each row execute function public.guard_meta_append_only();

create or replace function public.meta_executor_safe_error_code(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_value ~ '^[a-z][a-z0-9_]{1,79}$' then p_value
    else 'executor_error'
  end;
$$;

create or replace function public.meta_executor_current_before(
  p_target public.automation_targets
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_target.target_type = 'CAMPAIGN' then
    select jsonb_build_object(
      'object_id', c.platform_campaign_id,
      'daily_budget_minor', c.daily_budget_minor,
      'status', coalesce(c.effective_status, c.status),
      'source_marketing_sync_id', c.last_seen_sync_id,
      'is_current', c.is_current
    ) into v_result
    from public.campaigns c
    where c.id = p_target.campaign_id
      and c.user_id = p_target.user_id
      and c.platform_account_id = p_target.platform_account_id;
  elsif p_target.target_type = 'AD_SET' then
    select jsonb_build_object(
      'object_id', ag.platform_ad_group_id,
      'daily_budget_minor', ag.daily_budget_minor,
      'status', coalesce(ag.effective_status, ag.status),
      'source_marketing_sync_id', ag.last_seen_sync_id,
      'is_current', ag.is_current
    ) into v_result
    from public.ad_groups ag
    where ag.id = p_target.ad_group_id
      and ag.user_id = p_target.user_id
      and ag.platform_account_id = p_target.platform_account_id;
  elsif p_target.target_type = 'AD' then
    select jsonb_build_object(
      'object_id', a.platform_ad_id,
      'status', coalesce(a.effective_status, a.status),
      'source_marketing_sync_id', a.last_seen_sync_id,
      'is_current', a.is_current
    ) into v_result
    from public.ads a
    where a.id = p_target.ad_id
      and a.user_id = p_target.user_id
      and a.platform_account_id = p_target.platform_account_id;
  end if;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.meta_executor_before_matches(
  p_plan public.mutation_plans,
  p_target public.automation_targets
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current jsonb;
begin
  v_current := public.meta_executor_current_before(p_target);

  if v_current = '{}'::jsonb
    or coalesce((v_current->>'is_current')::boolean, false) is not true
    or v_current->>'object_id' is distinct from p_target.platform_object_id
    or (v_current->>'source_marketing_sync_id')::uuid
       is distinct from p_plan.source_marketing_sync_id then
    return false;
  end if;

  if p_plan.expected_before ? 'daily_budget_minor'
    and (v_current->>'daily_budget_minor')::bigint
        is distinct from (p_plan.expected_before->>'daily_budget_minor')::bigint then
    return false;
  end if;

  if p_plan.expected_before ? 'status'
    and v_current->>'status' is distinct from p_plan.expected_before->>'status' then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
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
    where mp.status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING')
      and mp.not_before <= now()
      and mp.attempt_count < mp.max_attempts
      and (
        mp.status in ('PENDING', 'RETRYABLE')
        or mp.lease_expires_at <= now()
      )
    order by mp.safety_action desc, mp.priority asc, mp.created_at asc
    for update skip locked
  loop
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

    select pa.account_id into v_ad_account_id
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
              = regexp_replace(pa.account_id, '^act_', '')
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

create or replace function public.heartbeat_meta_mutation_execution(
  p_execution_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_ok boolean;
begin
  select me.* into v_execution
  from public.mutation_executions me
  where me.id = p_execution_id
    and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;

  if not found then
    return false;
  end if;

  v_ok := public.heartbeat_meta_account_operation(
    v_execution.platform_account_id,
    v_execution.user_id,
    p_lease_token,
    p_lease_seconds
  );

  if not v_ok then
    return false;
  end if;

  update public.mutation_executions
  set last_heartbeat_at = now(),
      status = case when status = 'CLAIMED' then 'RUNNING' else status end
  where id = p_execution_id;

  update public.mutation_plans
  set status = case when status = 'CLAIMED' then 'EXECUTING' else status end,
      lease_expires_at = now() + make_interval(
        secs => greatest(60, least(900, p_lease_seconds))
      ),
      updated_at = now()
  where id = v_execution.plan_id and lease_token = p_lease_token;

  return true;
end;
$$;

create or replace function public.claim_next_meta_mutation_step(
  p_execution_id uuid,
  p_lease_token uuid
)
returns table (
  step_id uuid,
  step_index integer,
  operation text,
  object_type text,
  planned_request jsonb,
  request_hash text,
  dispatch_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
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

  select mps.* into v_step
  from public.mutation_plan_steps mps
  where mps.plan_id = v_plan.id
    and mps.status in ('PENDING', 'RETRYABLE')
    and mps.not_before <= now()
    and (
      mps.depends_on_step_id is null
      or exists (
        select 1
        from public.mutation_plan_steps dependency
        where dependency.id = mps.depends_on_step_id
          and dependency.plan_id = v_plan.id
          and dependency.status in (
            'VALIDATED', 'REMOTE_APPLIED', 'RECONCILED', 'SKIPPED'
          )
      )
    )
  order by mps.step_index
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.mutation_plan_steps
  set status = 'CLAIMED', attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, now()), error_class = null,
      error_code = null, updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = case when v_step.operation = 'RECONCILE'
        then 'RECONCILING' else 'RUNNING' end,
      last_heartbeat_at = now()
  where id = v_execution.id;

  update public.mutation_plans
  set status = case when v_step.operation = 'RECONCILE'
        then 'RECONCILING' else 'EXECUTING' end,
      updated_at = now()
  where id = v_plan.id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    'MUTATION_STEP_CLAIMED',
    jsonb_build_object('step_status', v_step.status),
    jsonb_build_object('request_hash', v_step.request_hash), '{}'::jsonb,
    jsonb_build_object('step_status', 'CLAIMED'),
    jsonb_build_object('step_index', v_step.step_index,
                       'operation', v_step.operation),
    null, null, null, null, null, now()
  );

  return query select v_step.id, v_step.step_index, v_step.operation,
    v_step.object_type, v_step.planned_request, v_step.request_hash,
    v_step.dispatch_state;
end;
$$;

create or replace function public.get_meta_mutation_remote_bindings(
  p_execution_id uuid,
  p_lease_token uuid
)
returns table (
  step_id uuid,
  object_type text,
  remote_object_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
begin
  select me.* into v_execution
  from public.mutation_executions me
  where me.id = p_execution_id
    and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for share;

  if not found then
    raise exception 'Active Meta execution is required';
  end if;

  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = v_execution.plan_id
    and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
  for share;

  if not found then
    raise exception 'Active Meta plan lease is required';
  end if;

  return query
  select rob.step_id, rob.object_type, rob.remote_object_id
  from public.remote_object_bindings rob
  where rob.plan_id = v_plan.id
    and rob.user_id = v_plan.user_id
    and rob.platform_account_id = v_plan.platform_account_id
  order by rob.bound_at, rob.created_at;
end;
$$;

create or replace function public.begin_meta_mutation_step_dispatch(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid
)
returns table (
  plan_id uuid,
  operation text,
  object_type text,
  planned_request jsonb,
  request_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_asset public.brand_assets%rowtype;
  v_kill_mode text;
  v_latest_change timestamptz;
  v_baseline_budget bigint;
  v_movement_used bigint;
  v_movement_limit bigint;
  v_before_budget bigint;
  v_after_budget bigint;
begin
  select me.* into v_execution
  from public.mutation_executions me
  where me.id = p_execution_id
    and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING')
  for update;

  if not found then
    raise exception 'Active Meta execution lease is required';
  end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id
    and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
    and mp.status in ('CLAIMED', 'EXECUTING')
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id
    and mps.plan_id = v_plan.id
    and mps.status = 'CLAIMED'
  for update;

  if not found or v_step.operation not in ('VALIDATE', 'CREATE', 'UPDATE', 'COMPENSATE') then
    raise exception 'Claimed remote mutation step is required';
  end if;

  if v_step.dispatch_state <> 'NOT_DISPATCHED' then
    raise exception 'Mutation step was already dispatched';
  end if;

  if public.meta_sha256(v_step.planned_request::text) <> v_step.request_hash then
    raise exception 'Mutation step request hash mismatch';
  end if;

  select ap.* into v_policy from public.automation_policies ap
  where ap.id = v_plan.policy_id and ap.user_id = v_plan.user_id
    and ap.platform_account_id = v_plan.platform_account_id
    and ap.is_current and ap.status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'Active current automation policy is required';
  end if;

  select mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    v_plan.user_id, v_plan.platform_account_id, v_plan.id
  );
  if v_kill_mode <> 'ALLOW' then
    raise exception 'Meta writes are blocked by kill switch';
  end if;

  if v_plan.automation_target_id is not null then
    select at.* into v_target from public.automation_targets at
    where at.id = v_plan.automation_target_id and at.status = 'MANAGED'
    for update;
    if not found or not public.meta_executor_before_matches(v_plan, v_target) then
      raise exception 'Meta target before-state drifted';
    end if;
  end if;

  if v_step.object_type = 'IMAGE' then
    if v_step.operation <> 'CREATE'
      or v_step.planned_request->>'operation' <> 'UPLOAD_IMAGE'
      or coalesce(v_step.planned_request->>'brand_asset_id', '')
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_step.planned_request->>'asset_sha256', '')
           !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid Brand Asset upload request';
    end if;

    select ba.* into v_asset
    from public.brand_assets ba
    where ba.id = (v_step.planned_request->>'brand_asset_id')::uuid
      and ba.user_id = v_plan.user_id
      and ba.platform_account_id = v_plan.platform_account_id
      and ba.status = 'READY'
      and ba.moderation_status = 'APPROVED'
      and ba.sha256 = v_step.planned_request->>'asset_sha256'
      and ba.storage_bucket is not null
      and ba.storage_path is not null
      and ba.mime_type in ('image/png', 'image/jpeg')
      and ba.byte_size between 1 and 31457280
    for share;

    if not found then
      raise exception 'Matching ready Brand Asset upload is required';
    end if;

    if v_asset.meta_image_hash is not null then
      raise exception 'Brand Asset is already uploaded to Meta';
    end if;
  end if;

  if v_plan.action_type = 'UPDATE_BUDGET' and v_step.operation = 'UPDATE' then
    v_before_budget := (v_plan.expected_before->>'daily_budget_minor')::bigint;
    v_after_budget := (v_plan.intended_after->>'daily_budget_minor')::bigint;

    select
      max(bml.executed_at), coalesce(sum(bml.absolute_delta_minor), 0)
    into v_latest_change, v_movement_used
    from public.budget_mutation_ledger bml
    where bml.platform_account_id = v_plan.platform_account_id
      and bml.budget_owner_key = v_plan.budget_owner_key
      and bml.executed_at > now() - interval '24 hours'
      and bml.executed_at <= now();

    if v_target.last_successful_mutation_at is not null
      and (v_latest_change is null
           or v_target.last_successful_mutation_at > v_latest_change) then
      v_latest_change := v_target.last_successful_mutation_at;
    end if;

    if v_latest_change is not null
      and v_latest_change + make_interval(secs => v_policy.cooldown_seconds) > now() then
      raise exception 'Budget mutation cooldown is active';
    end if;

    select bml.before_budget_minor into v_baseline_budget
    from public.budget_mutation_ledger bml
    where bml.platform_account_id = v_plan.platform_account_id
      and bml.budget_owner_key = v_plan.budget_owner_key
      and bml.executed_at > now() - interval '24 hours'
      and bml.executed_at <= now()
    order by bml.executed_at asc, bml.created_at asc
    limit 1;

    v_baseline_budget := coalesce(v_baseline_budget, v_before_budget);
    v_movement_limit :=
      (v_baseline_budget * v_policy.budget_change_limit_bps) / 10000;

    if v_movement_limit <= 0
      or v_movement_used + abs(v_after_budget - v_before_budget) > v_movement_limit then
      raise exception 'Rolling 24-hour budget movement limit exceeded';
    end if;

    select dbe.* into v_exposure
    from public.daily_budget_exposures dbe
    join public.daily_budget_exposure_snapshots s on s.id = dbe.snapshot_id
    where dbe.user_id = v_plan.user_id
      and dbe.platform_account_id = v_plan.platform_account_id
      and dbe.policy_id = v_plan.policy_id
      and dbe.automation_target_id = v_plan.automation_target_id
      and dbe.budget_owner_key = v_plan.budget_owner_key
      and s.id = (v_plan.planned_payload->>'exposure_snapshot_id')::uuid
      and s.user_id = v_plan.user_id
      and s.platform_account_id = v_plan.platform_account_id
      and s.policy_id = v_plan.policy_id
      and s.source_marketing_sync_id = v_plan.source_marketing_sync_id
      and s.status = 'COMPLETE'
    order by dbe.updated_at desc
    limit 1
    for update of dbe;

    if not found then
      raise exception 'Matching budget exposure reservation is required';
    end if;

    select s.* into strict v_snapshot
    from public.daily_budget_exposure_snapshots s
    where s.id = v_exposure.snapshot_id
      and s.user_id = v_plan.user_id
      and s.platform_account_id = v_plan.platform_account_id
      and s.status = 'COMPLETE'
    for share;

    perform public.reserve_meta_daily_budget_exposure(
      v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
      v_snapshot.id, v_plan.id, v_plan.automation_target_id,
      v_snapshot.account_day, v_plan.campaign_scope_key,
      v_plan.budget_owner_key, v_target.budget_owner_type,
      v_exposure.shared_budget_enabled, 'EUR', v_after_budget,
      greatest(
        v_exposure.flex_spend_multiplier_bps,
        case when v_exposure.shared_budget_enabled
          then v_policy.shared_budget_flex_spend_multiplier_bps
          else v_policy.standard_flex_spend_multiplier_bps end
      ),
      'PLAN'
    );
  end if;

  update public.mutation_plan_steps
  set status = 'RUNNING', dispatch_state = 'PRE_DISPATCH',
      dispatch_started_at = now(), updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = 'RUNNING', last_heartbeat_at = now()
  where id = v_execution.id;

  update public.mutation_plans
  set status = 'EXECUTING', updated_at = now()
  where id = v_plan.id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    'MUTATION_STEP_PRE_DISPATCH',
    jsonb_build_object('step_status', 'CLAIMED', 'dispatch_state', 'NOT_DISPATCHED'),
    jsonb_build_object('request_hash', v_step.request_hash), '{}'::jsonb,
    jsonb_build_object('step_status', 'RUNNING', 'dispatch_state', 'PRE_DISPATCH'),
    jsonb_build_object('operation', v_step.operation, 'object_type', v_step.object_type),
    null, null, null, null, null, now()
  );

  return query select v_plan.id, v_step.operation, v_step.object_type,
    v_step.planned_request, v_step.request_hash;
end;
$$;

create or replace function public.complete_meta_mutation_remote_step(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid,
  p_request_fingerprint text,
  p_response_fingerprint text,
  p_remote_object_id text default null,
  p_remote_request_id text default null,
  p_validated boolean default false,
  p_usage_snapshot jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_next_step uuid;
  v_terminal_status text;
begin
  if p_request_fingerprint !~ '^[0-9a-f]{64}$'
    or p_response_fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_usage_snapshot, '{}'::jsonb)) <> 'object'
    or pg_catalog.octet_length(coalesce(p_usage_snapshot, '{}'::jsonb)::text) > 32768
    or public.meta_jsonb_has_sensitive_key(coalesce(p_usage_snapshot, '{}'::jsonb)) then
    raise exception 'Invalid Meta remote completion metadata';
  end if;

  select me.* into v_execution from public.mutation_executions me
  where me.id = p_execution_id and me.lease_token = p_lease_token
    and me.status in ('RUNNING', 'CLAIMED')
  for update;
  if not found then raise exception 'Active Meta execution is required'; end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.status = 'RUNNING' and mps.dispatch_state = 'PRE_DISPATCH'
  for update;
  if not found then raise exception 'Pre-dispatch Meta step is required'; end if;

  if p_remote_object_id is not null and (
    (v_step.object_type = 'IMAGE'
      and p_remote_object_id !~ '^[A-Fa-f0-9]{16,128}$')
    or (v_step.object_type <> 'IMAGE'
      and p_remote_object_id !~ '^[1-9][0-9]{0,39}$')
  ) then
    raise exception 'Invalid Meta remote object ID';
  end if;

  v_terminal_status := case
    when v_step.operation = 'VALIDATE' or p_validated then 'VALIDATED'
    else 'REMOTE_APPLIED'
  end;

  if v_step.operation in ('CREATE', 'UPDATE') and v_terminal_status = 'VALIDATED' then
    raise exception 'Executed mutation cannot complete as validation-only';
  end if;

  update public.mutation_plan_steps
  set status = v_terminal_status,
      validation_fingerprint = case
        when v_terminal_status = 'VALIDATED' then p_response_fingerprint
        else validation_fingerprint
      end,
      validated_at = case
        when v_terminal_status = 'VALIDATED' then now()
        else validated_at
      end,
      dispatch_state = 'REMOTE_APPLIED',
      remote_applied_at = now(),
      remote_request_id = p_remote_request_id,
      response_fingerprint = p_response_fingerprint,
      completed_at = now(), updated_at = now()
  where id = v_step.id;

  if p_remote_object_id is not null and v_step.operation in ('CREATE', 'COMPENSATE') then
    insert into public.remote_object_bindings (
      plan_id, step_id, execution_id, user_id, platform_account_id,
      object_type, remote_object_id, deterministic_name,
      request_fingerprint, remote_fingerprint
    ) values (
      v_plan.id, v_step.id, v_execution.id, v_plan.user_id,
      v_plan.platform_account_id, v_step.object_type, p_remote_object_id,
      null, p_request_fingerprint, p_response_fingerprint
    ) on conflict (plan_id, step_id) do nothing;

    if v_step.object_type = 'IMAGE' then
      update public.brand_assets as ba
      set meta_image_hash = p_remote_object_id,
          updated_at = now()
      where ba.id = (v_step.planned_request->>'brand_asset_id')::uuid
        and ba.user_id = v_plan.user_id
        and ba.platform_account_id = v_plan.platform_account_id
        and ba.status = 'READY'
        and ba.moderation_status = 'APPROVED'
        and ba.sha256 = v_step.planned_request->>'asset_sha256';

      if not found then
        raise exception 'Matching ready Brand Asset is required for image binding';
      end if;
    end if;
  end if;

  update public.mutation_executions
  set status = 'RUNNING', last_heartbeat_at = now(),
      usage_snapshot = coalesce(p_usage_snapshot, '{}'::jsonb)
  where id = v_execution.id;

  select mps.id into v_next_step
  from public.mutation_plan_steps mps
  where mps.plan_id = v_plan.id and mps.status in ('PENDING', 'RETRYABLE')
    and (mps.depends_on_step_id is null or mps.depends_on_step_id = v_step.id)
  order by mps.step_index limit 1;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    case when v_terminal_status = 'VALIDATED'
      then 'MUTATION_STEP_VALIDATED' else 'MUTATION_STEP_REMOTE_APPLIED' end,
    jsonb_build_object('step_status', 'RUNNING', 'dispatch_state', 'PRE_DISPATCH'),
    jsonb_build_object('request_hash', v_step.request_hash,
                       'request_fingerprint', p_request_fingerprint),
    jsonb_build_object('response_fingerprint', p_response_fingerprint),
    jsonb_build_object('step_status', v_terminal_status,
                       'dispatch_state', 'REMOTE_APPLIED'),
    jsonb_build_object('next_step_id', v_next_step),
    'meta', null, null, p_remote_request_id, null, now()
  );

  return true;
end;
$$;

create or replace function public.record_meta_mutation_remote_snapshot(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid,
  p_snapshot_kind text,
  p_remote_object_id text,
  p_snapshot_payload jsonb,
  p_response_fingerprint text,
  p_remote_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_id uuid := gen_random_uuid();
begin
  if p_snapshot_kind not in ('PREFLIGHT', 'READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
    or p_remote_object_id !~ '^[1-9][0-9]{0,39}$'
    or p_response_fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_snapshot_payload) <> 'object'
    or pg_catalog.octet_length(p_snapshot_payload::text) > 262144
    or public.meta_jsonb_has_sensitive_key(p_snapshot_payload)
    or p_snapshot_payload->>'id' is distinct from p_remote_object_id then
    raise exception 'Invalid Meta remote snapshot';
  end if;

  select me.* into v_execution from public.mutation_executions me
  where me.id = p_execution_id and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then raise exception 'Active Meta execution is required'; end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.operation = 'READ' and mps.status in ('CLAIMED', 'RUNNING', 'RETRYABLE')
  for update;
  if not found then raise exception 'Claimed Meta read step is required'; end if;

  insert into public.meta_mutation_remote_snapshots (
    id, user_id, platform_account_id, policy_id, plan_id, step_id,
    execution_id, object_type, remote_object_id, snapshot_kind,
    snapshot_payload, response_fingerprint, remote_request_id
  ) values (
    v_id, v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, v_step.object_type,
    p_remote_object_id, p_snapshot_kind, p_snapshot_payload,
    p_response_fingerprint, p_remote_request_id
  ) on conflict (execution_id, step_id, snapshot_kind) do nothing
  returning id into v_id;

  if v_id is null then
    select s.id into v_id from public.meta_mutation_remote_snapshots s
    where s.execution_id = p_execution_id and s.step_id = p_step_id
      and s.snapshot_kind = p_snapshot_kind
      and s.remote_object_id = p_remote_object_id
      and s.response_fingerprint = p_response_fingerprint;
    if not found then raise exception 'Remote snapshot replay drift detected'; end if;
  end if;

  update public.mutation_plan_steps
  set status = 'RECONCILED', dispatch_state = 'READ_BACK',
      dispatch_started_at = coalesce(dispatch_started_at, now()),
      remote_applied_at = coalesce(remote_applied_at, now()),
      response_fingerprint = p_response_fingerprint,
      remote_request_id = p_remote_request_id,
      completed_at = now(), updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = 'RECONCILING', last_heartbeat_at = now()
  where id = v_execution.id;
  update public.mutation_plans
  set status = 'RECONCILING', updated_at = now()
  where id = v_plan.id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'RECONCILER',
    v_execution.worker_id, 'MUTATION_REMOTE_SNAPSHOT_RECORDED',
    jsonb_build_object('step_status', v_step.status),
    jsonb_build_object('snapshot_kind', p_snapshot_kind),
    jsonb_build_object('response_fingerprint', p_response_fingerprint),
    jsonb_build_object('step_status', 'RECONCILED', 'snapshot_id', v_id),
    '{}'::jsonb, 'meta', null, null, p_remote_request_id, null, now()
  );

  return v_id;
end;
$$;

create or replace function public.reconcile_meta_mutation_plan(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid
)
returns table (
  outcome text,
  plan_id uuid,
  ledger_id uuid,
  snapshot_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_target public.automation_targets%rowtype;
  v_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_mutate_step public.mutation_plan_steps%rowtype;
  v_ledger_id uuid;
  v_matches boolean := false;
  v_observed_budget bigint;
  v_expected_budget bigint;
  v_observed_status text;
  v_expected_status text;
begin
  select me.* into v_execution from public.mutation_executions me
  where me.id = p_execution_id and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then raise exception 'Active Meta execution is required'; end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.operation = 'RECONCILE' and mps.status in ('CLAIMED', 'RUNNING', 'RETRYABLE')
  for update;
  if not found then raise exception 'Claimed reconciliation step is required'; end if;

  select at.* into v_target from public.automation_targets at
  where at.id = v_plan.automation_target_id
    and at.user_id = v_plan.user_id
    and at.platform_account_id = v_plan.platform_account_id
  for update;

  select s.* into v_snapshot
  from public.meta_mutation_remote_snapshots s
  where s.plan_id = v_plan.id
    and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
  order by s.observed_at desc, s.created_at desc
  limit 1;
  if not found then raise exception 'Read-after-write snapshot is required'; end if;

  if v_plan.action_type = 'UPDATE_BUDGET' then
    v_expected_budget := (v_plan.intended_after->>'daily_budget_minor')::bigint;
    if coalesce(v_snapshot.snapshot_payload->>'daily_budget', '') ~ '^[0-9]+$' then
      v_observed_budget := (v_snapshot.snapshot_payload->>'daily_budget')::bigint;
    elsif coalesce(v_snapshot.snapshot_payload->>'daily_budget_minor', '') ~ '^[0-9]+$' then
      v_observed_budget := (v_snapshot.snapshot_payload->>'daily_budget_minor')::bigint;
    end if;
    v_matches := v_observed_budget is not null and v_observed_budget = v_expected_budget;
  elsif v_plan.action_type in ('PAUSE', 'ACTIVATE', 'SAFETY_PAUSE') then
    v_expected_status := v_plan.intended_after->>'status';
    v_observed_status := coalesce(
      v_snapshot.snapshot_payload->>'status',
      v_snapshot.snapshot_payload->>'effective_status'
    );
    v_matches := v_expected_status in ('ACTIVE', 'PAUSED')
      and v_observed_status = v_expected_status;
  else
    v_matches := v_snapshot.remote_object_id is not null;
  end if;

  if not v_matches then
    update public.mutation_plan_steps
    set status = case when attempt_count < 5 then 'RETRYABLE'
                      else 'COMPENSATION_REQUIRED' end,
        dispatch_state = 'READ_BACK', dispatch_started_at = coalesce(dispatch_started_at, now()),
        remote_applied_at = coalesce(remote_applied_at, now()),
        error_class = 'RECONCILIATION', error_code = 'remote_state_mismatch',
        not_before = now() + interval '2 minutes', updated_at = now()
    where id = v_step.id;

    update public.mutation_executions
    set status = case when v_plan.attempt_count < v_plan.max_attempts
                      then 'RETRYABLE' else 'COMPENSATION_REQUIRED' end,
        finished_at = now(), error_class = 'RECONCILIATION',
        error_code = 'remote_state_mismatch'
    where id = v_execution.id;

    update public.mutation_plans
    set status = case when attempt_count < max_attempts
                      then 'RETRYABLE' else 'COMPENSATION_REQUIRED' end,
        not_before = now() + interval '2 minutes', lease_token = null,
        lease_owner = null, lease_expires_at = null,
        error_class = 'RECONCILIATION', blocked_reason = 'remote_state_mismatch',
        updated_at = now()
    where id = v_plan.id;

    perform public.release_meta_account_operation(
      v_plan.platform_account_id, v_plan.user_id, p_lease_token
    );

    update public.platform_accounts as pa
    set automation_executor_status = case when v_plan.attempt_count < v_plan.max_attempts
          then 'retryable' else 'error' end,
        automation_executor_error_code = 'remote_state_mismatch',
        automation_executor_last_run_at = now(), updated_at = now()
    where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

    return query select 'MISMATCH'::text, v_plan.id, null::uuid, v_snapshot.id;
    return;
  end if;

  select mps.* into v_mutate_step
  from public.mutation_plan_steps mps
  where mps.plan_id = v_plan.id
    and mps.operation in ('CREATE', 'UPDATE', 'COMPENSATE')
    and mps.status in ('REMOTE_APPLIED', 'RECONCILED')
  order by mps.step_index desc
  limit 1;

  if v_plan.action_type = 'UPDATE_BUDGET' then
    insert into public.budget_mutation_ledger (
      user_id, platform_account_id, policy_id, plan_id, step_id,
      execution_id, automation_target_id, budget_owner_key, currency,
      before_budget_minor, after_budget_minor, remote_request_id,
      executed_at, reconciled_at
    ) values (
      v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
      v_plan.id, v_mutate_step.id, v_execution.id, v_plan.automation_target_id,
      v_plan.budget_owner_key, 'EUR',
      (v_plan.expected_before->>'daily_budget_minor')::bigint,
      (v_plan.intended_after->>'daily_budget_minor')::bigint,
      v_mutate_step.remote_request_id,
      coalesce(v_mutate_step.remote_applied_at, now()), now()
    ) on conflict on constraint budget_mutation_ledger_plan_step_key do nothing
    returning id into v_ledger_id;

    if v_target.target_type = 'CAMPAIGN' then
      update public.campaigns as c set daily_budget_minor = v_expected_budget,
        last_seen_at = now(), updated_at = now()
      where c.id = v_target.campaign_id and c.user_id = v_plan.user_id;
    elsif v_target.target_type = 'AD_SET' then
      update public.ad_groups as ag set daily_budget_minor = v_expected_budget,
        last_seen_at = now(), updated_at = now()
      where ag.id = v_target.ad_group_id and ag.user_id = v_plan.user_id;
    end if;
  elsif v_plan.action_type in ('PAUSE', 'ACTIVATE', 'SAFETY_PAUSE') then
    if v_target.target_type = 'CAMPAIGN' then
      update public.campaigns as c set status = v_expected_status,
        effective_status = v_expected_status, last_seen_at = now(), updated_at = now()
      where c.id = v_target.campaign_id and c.user_id = v_plan.user_id;
    elsif v_target.target_type = 'AD_SET' then
      update public.ad_groups as ag set status = v_expected_status,
        effective_status = v_expected_status, last_seen_at = now(), updated_at = now()
      where ag.id = v_target.ad_group_id and ag.user_id = v_plan.user_id;
    elsif v_target.target_type = 'AD' then
      update public.ads as ad_row set status = v_expected_status,
        effective_status = v_expected_status, last_seen_at = now(), updated_at = now()
      where ad_row.id = v_target.ad_id and ad_row.user_id = v_plan.user_id;
    end if;
  end if;

  if v_target.id is not null then
    update public.automation_targets
    set last_successful_mutation_at = now(), last_reconciled_at = now(),
        row_version = row_version + 1, updated_at = now()
    where id = v_target.id;
  end if;

  update public.mutation_plan_steps
  set status = 'RECONCILED', dispatch_state = 'RECONCILED',
      dispatch_started_at = coalesce(dispatch_started_at, now()),
      remote_applied_at = coalesce(remote_applied_at, now()),
      completed_at = now(), error_class = null, error_code = null,
      updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = 'SUCCEEDED', finished_at = now(), last_heartbeat_at = now(),
      error_class = null, error_code = null
  where id = v_execution.id;

  update public.mutation_plans
  set status = 'SUCCEEDED', lease_token = null, lease_owner = null,
      lease_expires_at = null, terminal_at = now(), blocked_reason = null,
      error_class = null, updated_at = now()
  where id = v_plan.id;

  perform public.release_meta_account_operation(
    v_plan.platform_account_id, v_plan.user_id, p_lease_token
  );

  update public.platform_accounts as pa
  set automation_executor_status = 'success',
      automation_executor_error_code = null,
      automation_executor_last_run_at = now(),
      automation_executor_last_success_at = now(),
      automation_executor_last_plan_id = v_plan.id,
      updated_at = now()
  where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'RECONCILER',
    v_execution.worker_id, 'MUTATION_PLAN_RECONCILED',
    jsonb_build_object('plan_status', 'RECONCILING'),
    jsonb_build_object('expected_result', v_step.expected_result),
    jsonb_build_object('snapshot_id', v_snapshot.id,
                       'response_fingerprint', v_snapshot.response_fingerprint),
    jsonb_build_object('plan_status', 'SUCCEEDED', 'ledger_id', v_ledger_id),
    '{}'::jsonb, 'meta', null, null, v_mutate_step.remote_request_id,
    null, now()
  );

  return query select 'SUCCEEDED'::text, v_plan.id, v_ledger_id, v_snapshot.id;
end;
$$;

create or replace function public.fail_meta_mutation_execution(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid,
  p_error_class text,
  p_error_code text,
  p_remote_outcome text,
  p_retry_after_seconds integer default 120
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
  v_plan_status text;
  v_step_status text;
  v_execution_status text;
  v_safe_code text;
begin
  if p_remote_outcome not in ('NOT_APPLIED', 'UNKNOWN', 'PERMANENT')
    or p_error_class not in ('TRANSPORT', 'RATE_LIMIT', 'AUTH', 'META', 'PROTOCOL', 'PREFLIGHT', 'RECONCILIATION') then
    raise exception 'Invalid Meta execution failure classification';
  end if;

  v_safe_code := public.meta_executor_safe_error_code(p_error_code);

  select me.* into v_execution from public.mutation_executions me
  where me.id = p_execution_id and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then raise exception 'Active Meta execution is required'; end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id and mp.lease_token = p_lease_token
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.status in ('CLAIMED', 'RUNNING')
  for update;
  if not found then raise exception 'Active Meta mutation step is required'; end if;

  v_retryable := p_remote_outcome = 'NOT_APPLIED'
    and p_error_class in ('TRANSPORT', 'RATE_LIMIT')
    and v_plan.attempt_count < v_plan.max_attempts;

  if p_remote_outcome = 'UNKNOWN' then
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
      error_class = p_error_class, error_code = v_safe_code, updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = v_execution_status, finished_at = case
        when v_execution_status in ('RETRYABLE', 'COMPENSATION_REQUIRED', 'FAILED')
          then now() else finished_at end,
      error_class = p_error_class, error_code = v_safe_code
  where id = v_execution.id;

  update public.mutation_plans
  set status = v_plan_status,
      not_before = case when v_retryable
        then now() + make_interval(secs => greatest(30, least(86400, p_retry_after_seconds)))
        else not_before end,
      lease_token = case when p_remote_outcome = 'UNKNOWN' then lease_token else null end,
      lease_owner = case when p_remote_outcome = 'UNKNOWN' then lease_owner else null end,
      lease_expires_at = case when p_remote_outcome = 'UNKNOWN' then lease_expires_at else null end,
      terminal_at = case when v_plan_status in ('FAILED', 'COMPENSATION_REQUIRED')
        then now() else terminal_at end,
      error_class = p_error_class, blocked_reason = v_safe_code,
      updated_at = now()
  where id = v_plan.id;

  if p_remote_outcome <> 'UNKNOWN' then
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
    case when p_remote_outcome = 'UNKNOWN'
      then 'Ein Remote-Aufruf wurde gesendet, sein Ergebnis ist jedoch unbekannt. Der Executor wiederholt die Mutation nicht blind.'
      else 'Die geplante Meta-Änderung wurde sicher gestoppt. Weitere Schritte folgen gemäß Retry- und Kompensationsregeln.' end,
    jsonb_build_object('error_class', p_error_class, 'error_code', v_safe_code,
                       'remote_outcome', p_remote_outcome),
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
    jsonb_build_object('retry_after_seconds', p_retry_after_seconds),
    'meta', null, null, null, p_error_class, now()
  );

  return v_plan_status;
end;
$$;

alter table public.meta_mutation_remote_snapshots enable row level security;

revoke all on table public.meta_mutation_remote_snapshots
  from public, anon, authenticated;
grant select on table public.meta_mutation_remote_snapshots to service_role;
grant select (
  id, user_id, platform_account_id, policy_id, plan_id, step_id,
  object_type, remote_object_id, snapshot_kind, response_fingerprint,
  observed_at, created_at
) on table public.meta_mutation_remote_snapshots to authenticated;

create policy meta_mutation_remote_snapshots_select_own
on public.meta_mutation_remote_snapshots
for select
to authenticated
using ((select auth.uid()) = user_id);

grant select (
  automation_executor_status,
  automation_executor_error_code,
  automation_executor_last_run_at,
  automation_executor_last_success_at,
  automation_executor_last_plan_id
) on table public.platform_accounts to authenticated;

grant select (
  dispatch_state, dispatch_started_at, remote_applied_at, remote_request_id,
  response_fingerprint
) on table public.mutation_plan_steps to authenticated;

revoke all on function public.guard_meta_executor_snapshot_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.meta_executor_safe_error_code(text)
  from public, anon, authenticated, service_role;
revoke all on function public.meta_executor_current_before(public.automation_targets)
  from public, anon, authenticated, service_role;
revoke all on function public.meta_executor_before_matches(
  public.mutation_plans, public.automation_targets
) from public, anon, authenticated, service_role;

revoke all on function public.claim_next_meta_mutation_execution(text, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_meta_mutation_execution(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.claim_next_meta_mutation_step(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_meta_mutation_remote_bindings(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.begin_meta_mutation_step_dispatch(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_meta_mutation_remote_step(
  uuid, uuid, uuid, text, text, text, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.record_meta_mutation_remote_snapshot(
  uuid, uuid, uuid, text, text, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.reconcile_meta_mutation_plan(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_meta_mutation_execution(
  uuid, uuid, uuid, text, text, text, integer
) from public, anon, authenticated;

grant execute on function public.claim_next_meta_mutation_execution(text, integer)
  to service_role;
grant execute on function public.heartbeat_meta_mutation_execution(uuid, uuid, integer)
  to service_role;
grant execute on function public.claim_next_meta_mutation_step(uuid, uuid)
  to service_role;
grant execute on function public.get_meta_mutation_remote_bindings(uuid, uuid)
  to service_role;
grant execute on function public.begin_meta_mutation_step_dispatch(uuid, uuid, uuid)
  to service_role;
grant execute on function public.complete_meta_mutation_remote_step(
  uuid, uuid, uuid, text, text, text, text, boolean, jsonb
) to service_role;
grant execute on function public.record_meta_mutation_remote_snapshot(
  uuid, uuid, uuid, text, text, jsonb, text, text
) to service_role;
grant execute on function public.reconcile_meta_mutation_plan(uuid, uuid, uuid)
  to service_role;
grant execute on function public.fail_meta_mutation_execution(
  uuid, uuid, uuid, text, text, text, integer
) to service_role;

comment on table public.meta_mutation_remote_snapshots is
  'Append-only, secret-sanitized Meta read-after-write snapshots used for deterministic reconciliation and ambiguity recovery.';
comment on function public.claim_next_meta_mutation_execution(text, integer) is
  'Claims one eligible immutable Meta plan with SKIP LOCKED, repeats connector/policy/kill-switch/before-state gates and acquires the shared WRITE_EXECUTION account lease.';
comment on function public.begin_meta_mutation_step_dispatch(uuid, uuid, uuid) is
  'Persists PRE_DISPATCH before any remote POST and atomically repeats Hard-Cap, 12-hour cooldown and rolling 24-hour 20-percent checks.';
comment on function public.fail_meta_mutation_execution(
  uuid, uuid, uuid, text, text, text, integer
) is
  'Classifies not-applied, unknown and permanent outcomes. Unknown remote outcomes are never blindly retried.';

commit;

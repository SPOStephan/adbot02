-- Regression for accepted customer launches (Vertrieb02 incident, 2026-09-28):
-- step-limit yield, sibling refreeze, account write gate and safe resume.
begin;

insert into auth.users (id, email)
values ('13000000-0000-4000-8000-000000000001', 'launch-queue@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_id, account_name,
  access_token, access_token_encrypted, token_iv, token_auth_tag,
  ad_account_ids, instagram_account_ids, meta_scopes, expires_at, data_access_expires_at,
  marketing_meta_ad_account_id, marketing_currency, marketing_timezone_name,
  marketing_sync_status, marketing_sync_id, marketing_last_success_at,
  marketing_campaign_count, marketing_ad_set_count, marketing_ad_count,
  marketing_creative_count, marketing_insight_count,
  marketing_recommendation_count, marketing_insights_since,
  marketing_insights_until
) values (
  '23000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  'meta', 'launch-queue', '900000000031', 'Launch Queue Meta',
  null, 'ciphertext', 'iv', 'auth-tag',
  '["act_313131313131"]'::jsonb, '[]'::jsonb,
  array['ads_read','ads_management']::text[],
  now() + interval '30 days', now() + interval '30 days',
  '313131313131', 'EUR', 'Europe/Berlin', 'success',
  '33000000-0000-4000-8000-000000000001', now(),
  0, 0, 0, 0, 0, 0, current_date - 13, current_date
);

insert into public.automation_policies (
  id, user_id, platform_account_id, version, status, currency,
  account_daily_hard_cap_minor, default_campaign_daily_hard_cap_minor,
  budget_change_limit_bps, cooldown_seconds,
  standard_flex_spend_multiplier_bps,
  shared_budget_flex_spend_multiplier_bps,
  allow_budget_changes, allow_status_changes, allow_new_launches,
  require_verified_domain, policy_payload, policy_hash, is_current,
  customer_confirmed_at, customer_confirmed_by, activated_at
) values (
  '83000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  1, 'ACTIVE', 'EUR', 10000, 6000, 2000, 43200, 17500, 21000,
  true, true, true, true,
  '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
  repeat('c', 64), true, now(),
  '13000000-0000-4000-8000-000000000001', now()
);

select public.append_meta_kill_switch_state(
  'ACCOUNT', '13000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001', null,
  'ALLOW', 'Launch queue regression fixture', 'OPERATOR', 'test'
);

-- Seeds an accepted, partially delivered customer launch: campaign created and
-- bound, then `activate-ad` (optional), `read-ad-active`, reconcile.
create function pg_temp.seed_launch(
  p_plan_id uuid,
  p_seed integer,
  p_with_write_step boolean,
  p_content text default null,
  p_created_at timestamptz default now()
)
returns void
language plpgsql
as $$
declare
  v_user uuid := '13000000-0000-4000-8000-000000000001';
  v_account uuid := '23000000-0000-4000-8000-000000000001';
  v_create uuid := gen_random_uuid();
  v_activate uuid := gen_random_uuid();
  v_read uuid := gen_random_uuid();
  v_reconcile uuid := gen_random_uuid();
  v_previous uuid;
  v_payload jsonb := jsonb_build_object(
    'campaign', jsonb_build_object(
      'name', coalesce(p_content, 'Queue campaign ' || p_seed)
        || ' [' || substr(md5('suffix' || p_seed), 1, 12) || '-c]'
    )
  );
begin
  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
    source_rule_key, source_rule_version, action_type, target_type, target_key,
    idempotency_key, expected_before, intended_after, planned_payload,
    payload_hash, status, priority, created_at
  ) values (
    p_plan_id, v_user, v_account, '83000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000001', 'active-launch-chain', 1,
    'LAUNCH_CHAIN', 'CHAIN', 'chain:queue-' || p_seed,
    md5('idem' || p_seed) || md5('key' || p_seed), '{}'::jsonb,
    '{"status":"ACTIVE"}'::jsonb, v_payload,
    public.meta_sha256(v_payload::text), 'PENDING', 60, p_created_at
  );

  insert into public.meta_launch_canary_approvals (
    user_id, platform_account_id, plan_id, payload_hash, objective,
    destination_url, budget_owner_type, daily_budget_minor, campaign_name,
    ad_set_name, creative_name, ad_name, target_status, reason, approved_by
  ) values (
    v_user, v_account, p_plan_id,
    public.meta_sha256(v_payload::text), 'OUTCOME_LEADS',
    'https://jobs.example.test/f/queue', 'CAMPAIGN', 5000, 'Queue campaign',
    'Queue ad set', 'Queue creative', 'Queue ad', 'ACTIVE',
    'Launch queue regression approval', v_user
  );

  perform public.append_meta_kill_switch_state(
    'PLAN', v_user, v_account, p_plan_id, 'ALLOW',
    'Exakter Aktiv-Launch-Fingerprint kundenseitig bestätigt', 'CUSTOMER', v_user::text
  );

  update public.mutation_plans set not_before = now() where id = p_plan_id;

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, planned_request, request_hash, status,
    attempt_count, dispatch_state, dispatch_started_at, remote_applied_at,
    started_at, completed_at
  ) values (
    v_create, p_plan_id, v_user, v_account, 0, 'create-campaign-paused',
    'CREATE', 'CAMPAIGN', '{"operation":"CREATE_CAMPAIGN"}'::jsonb,
    public.meta_sha256('{"operation":"CREATE_CAMPAIGN"}'::jsonb::text), 'REMOTE_APPLIED', 1, 'REMOTE_APPLIED', now(), now(),
    now(), now()
  );

  insert into public.remote_object_bindings (
    plan_id, step_id, user_id, platform_account_id, object_type,
    remote_object_id, request_fingerprint
  ) values (
    p_plan_id, v_create, v_user, v_account, 'CAMPAIGN',
    (120247770000000000 + p_seed)::text, repeat('e', 64)
  );

  v_previous := v_create;
  if p_with_write_step then
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request, request_hash
    ) values (
      v_activate, p_plan_id, v_user, v_account, 1, 'activate-ad', 'UPDATE',
      'AD', v_previous,
      jsonb_build_object('operation', 'UPDATE_STATUS', 'mode', 'execute',
        'status', 'ACTIVE', 'object_id',
        jsonb_build_object('$binding_step_id', v_create)),
      public.meta_sha256(jsonb_build_object('operation', 'UPDATE_STATUS',
        'mode', 'execute', 'status', 'ACTIVE', 'object_id',
        jsonb_build_object('$binding_step_id', v_create))::text)
    );
    v_previous := v_activate;
  end if;

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request, request_hash
  ) values
    (v_read, p_plan_id, v_user, v_account, 2, 'read-ad-active', 'READ', 'AD',
     v_previous, '{"operation":"READ"}'::jsonb,
     public.meta_sha256('{"operation":"READ"}'::jsonb::text)),
    (v_reconcile, p_plan_id, v_user, v_account, 3, 'reconcile-launch-chain',
     'RECONCILE', 'AD', v_read, '{"operation":"RECONCILE"}'::jsonb,
     public.meta_sha256('{"operation":"RECONCILE"}'::jsonb::text));
end;
$$;

select pg_temp.seed_launch('93000000-0000-4000-8000-00000000000a', 1, true);
select pg_temp.seed_launch('93000000-0000-4000-8000-00000000000b', 2, true);

-- 1) A run that stops at its step limit yields cleanly and stays claimable,
--    although launch plans start with max_attempts = 1.
create temporary table queue_claim on commit drop as
select * from public.claim_meta_mutation_execution_for_plan(
  '93000000-0000-4000-8000-00000000000a', 'queue-worker-1', 600
);

do $$
declare
  v_claim record;
  v_plan public.mutation_plans%rowtype;
  v_result text;
begin
  select * into v_claim from queue_claim;
  if v_claim.execution_id is null or v_claim.first_step_operation <> 'UPDATE' then
    raise exception 'Accepted partial launch was not claimable';
  end if;

  select * into v_plan from public.mutation_plans
  where id = '93000000-0000-4000-8000-00000000000a';
  if v_plan.attempt_count <> v_plan.max_attempts then
    raise exception 'Fixture must start with an exhausted attempt budget (%/%)',
      v_plan.attempt_count, v_plan.max_attempts;
  end if;

  -- A step that is still claimed must never be yielded away.
  begin
    perform public.yield_meta_mutation_execution(
      v_claim.execution_id, v_claim.lease_token
    );
    raise exception 'yield accepted a claimed step';
  exception when others then
    if sqlerrm not like '%clean step boundary%' then
      raise;
    end if;
  end;

  -- Simulate the executor finishing `activate-ad` and hitting its step limit.
  update public.mutation_plan_steps
  set status = 'REMOTE_APPLIED', dispatch_state = 'REMOTE_APPLIED',
      dispatch_started_at = now(), remote_applied_at = now(), completed_at = now()
  where id = v_claim.first_step_id;

  v_result := public.yield_meta_mutation_execution(
    v_claim.execution_id, v_claim.lease_token
  );
  if v_result <> 'YIELDED' then
    raise exception 'Expected YIELDED, got %', v_result;
  end if;

  select * into v_plan from public.mutation_plans
  where id = '93000000-0000-4000-8000-00000000000a';
  if v_plan.status <> 'PENDING'
    or v_plan.lease_token is not null
    or v_plan.attempt_count >= v_plan.max_attempts
    or v_plan.not_before > now() then
    raise exception 'Yielded plan is not claimable: % %/% %',
      v_plan.status, v_plan.attempt_count, v_plan.max_attempts, v_plan.not_before;
  end if;

  if exists (
    select 1 from public.meta_account_operation_leases lease
    where lease.platform_account_id = '23000000-0000-4000-8000-000000000001'
      and lease.lease_token = v_claim.lease_token
      and lease.expires_at > now()
  ) then
    raise exception 'Yield must release the account write lease';
  end if;

  if not exists (
    select 1 from public.mutation_executions me
    where me.id = v_claim.execution_id
      and me.status = 'ABANDONED'
      and me.error_code = 'executor_yielded'
  ) then
    raise exception 'Yield must close the execution';
  end if;
end;
$$;

-- The next run continues with the read-back; the applied step is not replayed.
create temporary table queue_claim_2 on commit drop as
select * from public.claim_meta_mutation_execution_for_plan(
  '93000000-0000-4000-8000-00000000000a', 'queue-worker-2', 600
);

do $$
declare
  v_claim record;
begin
  select * into v_claim from queue_claim_2;
  if v_claim.execution_id is null or v_claim.first_step_operation <> 'READ' then
    raise exception 'Continuation must resume at the read-back step';
  end if;
end;
$$;

-- 2) A sibling launch reaching a terminal state must not refreeze the ACCOUNT
--    while plan B (accepted, still open) waits in the queue.
update public.mutation_plans
set status = 'FAILED', lease_token = null, lease_owner = null,
    lease_expires_at = null, error_class = 'TRANSPORT',
    blocked_reason = 'database_failed', terminal_at = now()
where id = '93000000-0000-4000-8000-00000000000a';

select public.release_meta_account_operation(
  '23000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  (select lease_token from queue_claim_2)
);

do $$
declare
  v_mode text;
begin
  select ks.mode into v_mode
  from public.get_effective_meta_kill_switch(
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-00000000000b'
  ) ks;
  if v_mode <> 'ALLOW' then
    raise exception 'Sibling terminal refroze the account for an open launch: %', v_mode;
  end if;
end;
$$;

-- 3) A (transient) ACCOUNT freeze makes an accepted launch wait, not BLOCKED.
select public.append_meta_kill_switch_state(
  'ACCOUNT', '13000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001', null,
  'FREEZE_WRITES', 'Automatische Freeze-Phase für Kampagnen-Vorbereitung',
  'CUSTOMER', '13000000-0000-4000-8000-000000000001'
);

do $$
declare
  v_claimed uuid;
  v_plan public.mutation_plans%rowtype;
begin
  select execution_id into v_claimed
  from public.claim_meta_mutation_execution_for_plan(
    '93000000-0000-4000-8000-00000000000b', 'queue-worker-3', 600
  );
  if v_claimed is not null then
    raise exception 'Remote write was claimed under ACCOUNT FREEZE_WRITES';
  end if;
  select * into v_plan from public.mutation_plans
  where id = '93000000-0000-4000-8000-00000000000b';
  if v_plan.status <> 'PENDING'
    or v_plan.blocked_reason is distinct from 'account_write_gate_waiting' then
    raise exception 'Accepted launch must wait for the write gate: % %',
      v_plan.status, v_plan.blocked_reason;
  end if;
end;
$$;

-- 4) Read-back/reconcile-only remainders are not writes: FREEZE does not block.
select pg_temp.seed_launch('93000000-0000-4000-8000-00000000000c', 3, false);

do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_meta_mutation_execution_for_plan(
    '93000000-0000-4000-8000-00000000000c', 'queue-worker-4', 600
  );
  if v_claim.execution_id is null or v_claim.first_step_operation <> 'READ' then
    raise exception 'Read-back remainder was blocked by FREEZE_WRITES';
  end if;
  perform public.release_meta_account_operation(
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    v_claim.lease_token
  );
end;
$$;

-- Once the gate opens again, the waiting launch continues on its own.
select public.append_meta_kill_switch_state(
  'ACCOUNT', '13000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001', null,
  'ALLOW', 'Exakt bestätigter atomarer Aktiv-Launch',
  'CUSTOMER', '13000000-0000-4000-8000-000000000001'
);

do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_meta_mutation_execution_for_plan(
    '93000000-0000-4000-8000-00000000000b', 'queue-worker-5', 600
  );
  if v_claim.execution_id is null or v_claim.first_step_operation <> 'UPDATE' then
    raise exception 'Waiting launch did not continue after the gate opened';
  end if;
  -- The continued run must be allowed to send its remaining write to Meta
  -- (fe83a89a failed here: the initial launch gate rejected the dispatch).
  perform public.begin_meta_mutation_step_dispatch(
    v_claim.execution_id, v_claim.first_step_id, v_claim.lease_token
  );
  update public.mutation_plans
  set status = 'PENDING', lease_token = null, lease_owner = null,
      lease_expires_at = null
  where id = '93000000-0000-4000-8000-00000000000b';
  update public.mutation_plan_steps
  set status = 'PENDING', started_at = null,
      dispatch_state = 'NOT_DISPATCHED', dispatch_started_at = null
  where id = v_claim.first_step_id;
  update public.mutation_executions
  set status = 'ABANDONED', finished_at = now()
  where id = v_claim.execution_id;
  perform public.release_meta_account_operation(
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    v_claim.lease_token
  );
end;
$$;

-- 5) Recovery resumes a launch that the old code BLOCKED after a sibling's
--    system refreeze, and lifts only that system refreeze.
update public.mutation_plans
set status = 'BLOCKED', error_class = 'KILL_SWITCH',
    blocked_reason = 'writes_frozen', terminal_at = now()
where id = '93000000-0000-4000-8000-00000000000b';

select public.append_meta_kill_switch_state(
  'ACCOUNT', '13000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001', null,
  'FREEZE_WRITES', 'Atomarer Aktiv-Launch ist terminal beendet',
  'SYSTEM', 'meta-launch-canary-refreeze'
);

do $$
declare
  v_recovered integer;
  v_plan public.mutation_plans%rowtype;
  v_mode text;
begin
  select recovered_plans into v_recovered
  from public.recover_interrupted_meta_customer_launches(
    '13000000-0000-4000-8000-000000000001'
  );
  if v_recovered < 1 then
    raise exception 'Blocked accepted launch was not recovered';
  end if;
  select * into v_plan from public.mutation_plans
  where id = '93000000-0000-4000-8000-00000000000b';
  if v_plan.status <> 'PENDING' or v_plan.attempt_count >= v_plan.max_attempts then
    raise exception 'Recovered launch is not claimable: % %/%',
      v_plan.status, v_plan.attempt_count, v_plan.max_attempts;
  end if;
  select ks.mode into v_mode
  from public.get_effective_meta_kill_switch(
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-00000000000b'
  ) ks;
  if v_mode <> 'ALLOW' then
    raise exception 'System refreeze was not lifted for the resumed launch: %', v_mode;
  end if;
end;
$$;

-- A customer's own freeze is never overridden by recovery.
select public.append_meta_kill_switch_state(
  'ACCOUNT', '13000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001', null,
  'FREEZE_WRITES', 'Kunde pausiert Meta-Schreiben',
  'CUSTOMER', '13000000-0000-4000-8000-000000000001'
);
update public.mutation_plans
set status = 'BLOCKED', error_class = 'KILL_SWITCH',
    blocked_reason = 'writes_frozen', terminal_at = now()
where id = '93000000-0000-4000-8000-00000000000b';

do $$
declare
  v_mode text;
  v_actor text;
begin
  perform public.recover_interrupted_meta_customer_launches(
    '13000000-0000-4000-8000-000000000001'
  );
  select kss.mode, kss.actor_id into v_mode, v_actor
  from public.kill_switch_state kss
  where kss.scope_type = 'ACCOUNT'
    and kss.platform_account_id = '23000000-0000-4000-8000-000000000001'
  order by kss.sequence desc
  limit 1;
  if v_mode <> 'FREEZE_WRITES' or v_actor <> '13000000-0000-4000-8000-000000000001' then
    raise exception 'Recovery overrode a customer freeze: % by %', v_mode, v_actor;
  end if;
end;
$$;

-- 6) Operator requeue of a launch that failed only on a pre-dispatch rejection.
select pg_temp.seed_launch('93000000-0000-4000-8000-00000000000d', 4, true);
select pg_temp.seed_launch('93000000-0000-4000-8000-00000000000e', 5, true);

update public.mutation_plan_steps
set status = 'FAILED', error_class = 'TRANSPORT', error_code = 'database_failed',
    completed_at = now()
where plan_id in ('93000000-0000-4000-8000-00000000000d',
                  '93000000-0000-4000-8000-00000000000e')
  and step_key = 'activate-ad';
update public.mutation_plan_steps
set dispatch_state = 'REMOTE_UNKNOWN', dispatch_started_at = now()
where plan_id = '93000000-0000-4000-8000-00000000000e'
  and step_key = 'activate-ad';
update public.mutation_plans
set status = 'FAILED', error_class = 'TRANSPORT',
    blocked_reason = 'database_failed', terminal_at = now()
where id in ('93000000-0000-4000-8000-00000000000d',
             '93000000-0000-4000-8000-00000000000e');

do $$
declare
  v_plan public.mutation_plans%rowtype;
begin
  if public.resume_failed_meta_customer_launch(
    '93000000-0000-4000-8000-00000000000e'
  ) <> 'NOT_ELIGIBLE' then
    raise exception 'An ambiguous (possibly sent) step must never be requeued';
  end if;
  if public.resume_failed_meta_customer_launch(
    '93000000-0000-4000-8000-00000000000d'
  ) <> 'RESUMED' then
    raise exception 'Pre-dispatch rejection was not requeued';
  end if;
  for v_plan in
    select * from public.mutation_plans
    where id = '93000000-0000-4000-8000-00000000000d'
  loop exit; end loop;
  if v_plan.status <> 'PENDING' or v_plan.attempt_count >= v_plan.max_attempts then
    raise exception 'Requeued launch is not claimable';
  end if;
  if exists (
    select 1 from public.mutation_plan_steps
    where plan_id = '93000000-0000-4000-8000-00000000000d'
      and status = 'FAILED'
  ) then
    raise exception 'Failed pre-dispatch step was not reset';
  end if;
end;
$$;

-- 7) A write rejected before it reached Meta (e.g. the short freeze while
--    another launch is prepared) is retried, never left FAILED.
select public.append_meta_kill_switch_state(
  'ACCOUNT', '13000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001', null,
  'ALLOW', 'Exakt bestätigter atomarer Aktiv-Launch',
  'CUSTOMER', '13000000-0000-4000-8000-000000000001'
);
select pg_temp.seed_launch('93000000-0000-4000-8000-00000000000f', 6, true);
select pg_temp.seed_launch('93000000-0000-4000-8000-000000000010', 7, true);

do $$
declare
  v_claim record;
  v_result text;
  v_plan public.mutation_plans%rowtype;
begin
  for v_claim in
    select * from public.claim_meta_mutation_execution_for_plan(
      '93000000-0000-4000-8000-00000000000f', 'queue-worker-7', 600
    )
  loop exit; end loop;
  if v_claim.execution_id is null then
    raise exception 'Retry fixture was not claimable';
  end if;

  v_result := public.fail_meta_mutation_execution(
    v_claim.execution_id, v_claim.first_step_id, v_claim.lease_token,
    'TRANSPORT', 'database_failed', 'NOT_APPLIED', 30, null
  );
  if v_result <> 'RETRYABLE' then
    raise exception 'Pre-dispatch rejection ended as % instead of RETRYABLE', v_result;
  end if;

  for v_plan in
    select * from public.mutation_plans
    where id = '93000000-0000-4000-8000-00000000000f'
  loop exit; end loop;
  if v_plan.attempt_count >= v_plan.max_attempts or v_plan.terminal_at is not null then
    raise exception 'Retryable launch is not claimable again: %/%',
      v_plan.attempt_count, v_plan.max_attempts;
  end if;

  update public.mutation_plans set not_before = now()
  where id = '93000000-0000-4000-8000-00000000000f';
  update public.mutation_plan_steps set not_before = now()
  where plan_id = '93000000-0000-4000-8000-00000000000f';

  for v_claim in
    select * from public.claim_meta_mutation_execution_for_plan(
      '93000000-0000-4000-8000-00000000000f', 'queue-worker-8', 600
    )
  loop exit; end loop;
  if v_claim.execution_id is null or v_claim.first_step_operation <> 'UPDATE' then
    raise exception 'Retried launch did not resume at the rejected write';
  end if;
  perform public.release_meta_account_operation(
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    v_claim.lease_token
  );

  -- A possibly sent (ambiguous) write is never retried blindly.
  for v_claim in
    select * from public.claim_meta_mutation_execution_for_plan(
      '93000000-0000-4000-8000-000000000010', 'queue-worker-9', 600
    )
  loop exit; end loop;
  perform public.begin_meta_mutation_step_dispatch(
    v_claim.execution_id, v_claim.first_step_id, v_claim.lease_token
  );
  v_result := public.fail_meta_mutation_execution(
    v_claim.execution_id, v_claim.first_step_id, v_claim.lease_token,
    'TRANSPORT', 'meta_transport_timeout', 'UNKNOWN', 30, null
  );
  if v_result = 'RETRYABLE' then
    raise exception 'Ambiguous write must not be retried';
  end if;
end;
$$;

-- 8) Duplicate protection: an identical launch is never approved twice.
select pg_temp.seed_launch(
  '93000000-0000-4000-8000-000000000011', 11, true, 'Immo01_01 AB',
  now() - interval '2 hours'
);

do $$
begin
  begin
    perform pg_temp.seed_launch(
      '93000000-0000-4000-8000-000000000012', 12, true, 'Immo01_01 AB'
    );
    raise exception 'Identical open launch was approved twice';
  exception when others then
    if sqlerrm not like 'duplicate_customer_launch_open:93000000-0000-4000-8000-000000000011%' then
      raise;
    end if;
  end;

  update public.mutation_plans
  set status = 'SUCCEEDED', terminal_at = now()
  where id = '93000000-0000-4000-8000-000000000011';

  begin
    perform pg_temp.seed_launch(
      '93000000-0000-4000-8000-000000000013', 13, true, 'Immo01_01 AB'
    );
    raise exception 'Identical launch was approved again within 24 hours';
  exception when others then
    if sqlerrm not like 'duplicate_customer_launch_succeeded:%' then
      raise;
    end if;
  end;

  -- A different campaign name stays possible.
  perform pg_temp.seed_launch(
    '93000000-0000-4000-8000-000000000014', 14, true, 'Immo01_02 AB'
  );
end;
$$;

-- 9) A stuck older launch replaced by a newer identical one is never resumed
--    (a69ff483 vs 68ec42fc on 2026-09-28). The pair predates the approval
--    guard, so the guard is bypassed only to build that history.
alter table public.meta_launch_canary_approvals
  disable trigger guard_meta_launch_duplicate_approval;
select pg_temp.seed_launch(
  '93000000-0000-4000-8000-000000000015', 15, true, 'Immo02 Recruiting',
  now() - interval '3 hours'
);
select pg_temp.seed_launch(
  '93000000-0000-4000-8000-000000000016', 16, true, 'Immo02 Recruiting',
  now() - interval '1 hour'
);
alter table public.meta_launch_canary_approvals
  enable trigger guard_meta_launch_duplicate_approval;

update public.mutation_plans
set status = 'SUCCEEDED', terminal_at = now()
where id = '93000000-0000-4000-8000-000000000016';
update public.mutation_plan_steps
set status = 'FAILED', error_class = 'TRANSPORT', error_code = 'database_failed',
    completed_at = now()
where plan_id = '93000000-0000-4000-8000-000000000015'
  and step_key = 'activate-ad';
update public.mutation_plans
set status = 'FAILED', error_class = 'TRANSPORT',
    blocked_reason = 'database_failed', terminal_at = now()
where id = '93000000-0000-4000-8000-000000000015';

do $$
begin
  if public.resume_failed_meta_customer_launch(
    '93000000-0000-4000-8000-000000000015'
  ) <> 'SUPERSEDED' then
    raise exception 'A replaced launch must not be resumed';
  end if;
  if (select status from public.mutation_plans
      where id = '93000000-0000-4000-8000-000000000015') <> 'FAILED' then
    raise exception 'Replaced launch was changed';
  end if;
end;
$$;

select 'Meta launch queue resume checks passed' as result;

rollback;

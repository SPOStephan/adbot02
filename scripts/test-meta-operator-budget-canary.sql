\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values ('15000000-0000-4000-8000-000000000001', 'operator-canary@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_id, account_name,
  access_token, access_token_encrypted, token_iv, token_auth_tag,
  ad_account_ids, meta_scopes, expires_at, data_access_expires_at,
  marketing_meta_ad_account_id, marketing_currency, marketing_timezone_name,
  marketing_sync_status, marketing_sync_id, marketing_last_success_at,
  marketing_campaign_count, marketing_ad_set_count, marketing_ad_count,
  marketing_creative_count, marketing_insight_count,
  marketing_recommendation_count, marketing_insights_since,
  marketing_insights_until
) values (
  '25000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  'meta', 'operator-canary', '777777777777', 'Operator Canary Meta',
  null, 'ciphertext', 'iv', 'auth-tag',
  '["act_777777777777"]'::jsonb,
  array['ads_read','ads_management']::text[],
  now() + interval '30 days', now() + interval '30 days',
  '777777777777', 'EUR', 'Europe/Berlin', 'success',
  '35000000-0000-4000-8000-000000000001', now(),
  1, 0, 0, 0, 0, 0, current_date - 13, current_date
);

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, last_seen_sync_id,
  last_seen_at, is_current
) values (
  '45000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '777777777777', 'Operator Canary Campaign', 'ACTIVE', 'ACTIVE',
  'OUTCOME_TRAFFIC', 2000,
  '35000000-0000-4000-8000-000000000001', now(), true
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
  '85000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  1, 'ACTIVE', 'EUR', 10000, 5000, 2000, 43200, 17500, 21000,
  true, false, false, true,
  '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
  repeat('b', 64), true, now(),
  '15000000-0000-4000-8000-000000000001', now()
);

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_reconciled_at
) values (
  '55000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  'CAMPAIGN', 'campaign:777777777777', '777777777777',
  'campaign:777777777777', 'CAMPAIGN', 'campaign:777777777777',
  '45000000-0000-4000-8000-000000000001', 'MANAGED', now()
);

select * from public.set_meta_customer_automation_scope(
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  'CAMPAIGN',
  '45000000-0000-4000-8000-000000000001',
  'MANAGED',
  'Operator budget canary regression campaign selection'
);

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  null,
  'ALLOW',
  'Operator budget canary regression fixture',
  'OPERATOR',
  'test'
);

insert into public.daily_budget_exposure_snapshots (
  id, user_id, platform_account_id, policy_id, account_day,
  account_timezone_name, source_marketing_sync_id, currency, status,
  observed_budget_owner_count, reserved_exposure_minor, completed_at
) values (
  '65000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  current_date, 'Europe/Berlin',
  '35000000-0000-4000-8000-000000000001',
  'EUR', 'COMPLETE', 1, 3500, now()
);

insert into public.daily_budget_exposures (
  id, user_id, platform_account_id, policy_id, snapshot_id,
  automation_target_id, account_day, campaign_scope_key,
  budget_owner_key, budget_owner_type, shared_budget_enabled,
  currency, max_daily_budget_minor, flex_spend_multiplier_bps, source
) values (
  '75000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',
  current_date, 'campaign:777777777777', 'campaign:777777777777',
  'CAMPAIGN', false, 'EUR', 2000, 17500, 'SNAPSHOT'
);

insert into public.meta_account_operation_leases (
  platform_account_id, user_id, lease_kind, lease_token, owner_id,
  acquired_at, expires_at
) values (
  '25000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  'READ_SYNC', '95000000-0000-4000-8000-000000000001',
  'operator-canary-regression', now(), now() + interval '5 minutes'
);

-- A fabricated or stale read lease can never materialize a plan.
do $$
begin
  begin
    perform public.materialize_meta_customer_budget_canary_plan(
      '15000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000099',
      'Regression must reject a fabricated read lease',
      now()
    );
    raise exception 'Fabricated read lease was accepted';
  exception
    when others then
      if sqlerrm = 'Fabricated read lease was accepted' then raise; end if;
      if sqlerrm <> 'Active READ_SYNC lease is required' then raise; end if;
  end;
end;
$$;

create temporary table operator_canary_materialization on commit drop as
select public.materialize_meta_customer_budget_canary_plan(
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  'Controlled one-time canary without a performance recommendation',
  now()
) as result;

do $$
declare
  v_result jsonb;
  v_plan public.mutation_plans%rowtype;
  v_effective record;
  v_claim_count integer;
begin
  select result into v_result from operator_canary_materialization;
  if v_result ->> 'outcome' <> 'CREATED'
    or v_result ->> 'status' <> 'PENDING'
    or (v_result ->> 'before_budget_minor')::bigint <> 2000
    or (v_result ->> 'after_budget_minor')::bigint <> 1800
    or coalesce(v_result ->> 'payload_hash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Operator canary materialization result is invalid';
  end if;

  select plan.* into v_plan
  from public.mutation_plans plan
  where plan.id = (v_result ->> 'plan_id')::uuid;

  if not found
    or v_plan.source_recommendation_id is not null
    or v_plan.source_rule_key <> 'operator_budget_canary_v1'
    or v_plan.action_type <> 'UPDATE_BUDGET'
    or v_plan.target_type <> 'CAMPAIGN'
    or v_plan.expected_before ->> 'daily_budget_minor' <> '2000'
    or v_plan.intended_after ->> 'daily_budget_minor' <> '1800'
    or v_plan.planned_payload ->> 'direction' <> 'DECREASE'
    or v_plan.planned_payload ->> 'change_bps' <> '1000'
    or v_plan.priority <> 90
    or v_plan.max_attempts <> 1
    or v_plan.not_before <> 'infinity'::timestamptz then
    raise exception 'Operator canary plan does not match the fixed safe contract';
  end if;

  if (select count(*) from public.mutation_plan_steps step
      where step.plan_id = v_plan.id) <> 4
    or (select string_agg(step.operation, ',' order by step.step_index)
        from public.mutation_plan_steps step
        where step.plan_id = v_plan.id) <> 'VALIDATE,UPDATE,READ,RECONCILE' then
    raise exception 'Operator canary did not receive the standard four-step saga';
  end if;

  select * into v_effective
  from public.get_effective_meta_kill_switch(
    v_plan.user_id, v_plan.platform_account_id, v_plan.id
  );
  if v_effective.mode <> 'FREEZE_WRITES'
    or v_effective.scope_type <> 'PLAN' then
    raise exception 'Materialized operator canary is not held at plan scope';
  end if;

  select count(*) into v_claim_count
  from public.claim_next_meta_mutation_execution(
    'operator-canary-worker-before-approval', 300
  );
  if v_claim_count <> 0 then
    raise exception 'Unapproved operator canary became claimable';
  end if;

  if (select count(*) from public.meta_budget_canary_approvals approval
      where approval.plan_id = v_plan.id) <> 0
    or (select count(*) from public.mutation_audit_events audit
        where audit.plan_id = v_plan.id
          and audit.event_type = 'BUDGET_CANARY_CONFIRMATION_REQUIRED') <> 1
    or (select count(*) from public.mutation_audit_events audit
        where audit.plan_id = v_plan.id
          and audit.event_type = 'BUDGET_CANARY_PLAN_MATERIALIZED') <> 1 then
    raise exception 'Operator canary hold or audit evidence is invalid';
  end if;

  -- Even a service-role bug cannot release not_before without the exact
  -- approval row; the database itself rejects the bypass.
  begin
    update public.mutation_plans
    set not_before = now(), updated_at = now()
    where id = v_plan.id;
    raise exception 'Direct canary release bypass was accepted';
  exception
    when others then
      if sqlerrm = 'Direct canary release bypass was accepted' then raise; end if;
      if sqlerrm <> 'Exact budget canary approval is required' then raise; end if;
  end;
end;
$$;

-- Repeating the exact request is idempotent and returns the held plan.
do $$
declare
  v_result jsonb;
  v_existing jsonb;
begin
  select result into v_result from operator_canary_materialization;
  select public.materialize_meta_customer_budget_canary_plan(
    '15000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',
    'Controlled one-time canary without a performance recommendation',
    now()
  ) into v_existing;

  if v_existing ->> 'outcome' <> 'EXISTING'
    or v_existing ->> 'plan_id' <> v_result ->> 'plan_id'
    or (select count(*) from public.mutation_plans
        where source_rule_key = 'operator_budget_canary_v1') <> 1 then
    raise exception 'Operator canary materialization is not idempotent';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '15000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(*) from public.list_meta_budget_canary_plans(
      '25000000-0000-4000-8000-000000000001')) <> 1 then
    raise exception 'Tenant did not receive exactly one sanitized operator canary';
  end if;
end;
$$;

reset role;

-- Selecting a second budget owner blocks further materialization even when an
-- older held plan exists; the one-owner gate is checked first.
insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, last_seen_sync_id,
  last_seen_at, is_current
) values (
  '45000000-0000-4000-8000-000000000002',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '777777777778', 'Second Operator Campaign', 'ACTIVE', 'ACTIVE',
  'OUTCOME_TRAFFIC', 3000,
  '35000000-0000-4000-8000-000000000001', now(), true
);

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_reconciled_at
) values (
  '55000000-0000-4000-8000-000000000002',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  'CAMPAIGN', 'campaign:777777777778', '777777777778',
  'campaign:777777777778', 'CAMPAIGN', 'campaign:777777777778',
  '45000000-0000-4000-8000-000000000002', 'MANAGED', now()
);

select * from public.set_meta_customer_automation_scope(
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  'CAMPAIGN',
  '45000000-0000-4000-8000-000000000002',
  'MANAGED',
  'Second owner must block a one-time budget canary'
);

do $$
begin
  begin
    perform public.materialize_meta_customer_budget_canary_plan(
      '15000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      'Second managed owner must block materialization',
      now()
    );
    raise exception 'Second managed budget owner was accepted';
  exception
    when others then
      if sqlerrm = 'Second managed budget owner was accepted' then raise; end if;
      if sqlerrm <> 'Exactly one managed budget owner is required for the canary' then raise; end if;
  end;

  if has_function_privilege(
      'authenticated',
      'public.materialize_meta_customer_budget_canary_plan(uuid,uuid,uuid,text,timestamptz)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.materialize_meta_customer_budget_canary_plan(uuid,uuid,uuid,text,timestamptz)',
      'EXECUTE'
    ) then
    raise exception 'Operator canary materializer RPC privileges are incorrect';
  end if;
end;
$$;

rollback;

select 'Meta operator budget canary checks passed' as result;

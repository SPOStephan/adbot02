begin;

insert into auth.users (id, email)
values ('16000000-0000-4000-8000-000000000001', 'lifetime-budget-canary@example.test');

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
  '26000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  'meta', 'lifetime-budget-canary', '888888888888',
  'Lifetime Budget Canary Meta', null, 'ciphertext', 'iv', 'auth-tag',
  '["act_888888888888"]'::jsonb,
  array['ads_read','ads_management']::text[],
  now() + interval '30 days', now() + interval '30 days',
  '888888888888', 'EUR', 'Europe/Berlin', 'success',
  '36000000-0000-4000-8000-000000000001', now(),
  1, 0, 0, 0, 0, 0, current_date - 13, current_date
);

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, lifetime_budget_minor,
  last_seen_sync_id, last_seen_at, is_current
) values (
  '46000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  '888888888801', 'Lifetime Budget Canary Campaign', 'ACTIVE', 'ACTIVE',
  'OUTCOME_TRAFFIC', null, 1500,
  '36000000-0000-4000-8000-000000000001', now(), true
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
  '86000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  1, 'ACTIVE', 'EUR', 532700, 500000, 2000, 43200, 17500, 21000,
  true, false, false, true,
  '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
  repeat('c', 64), true, now(),
  '16000000-0000-4000-8000-000000000001', now()
);

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_reconciled_at
) values (
  '56000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  'CAMPAIGN', 'campaign:888888888801', '888888888801',
  'campaign:888888888801', 'CAMPAIGN', 'campaign:888888888801',
  '46000000-0000-4000-8000-000000000001', 'MANAGED', now()
);

select * from public.set_meta_customer_automation_scope(
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  'CAMPAIGN',
  '46000000-0000-4000-8000-000000000001',
  'MANAGED',
  'Lifetime budget canary regression campaign selection'
);

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  null,
  'FREEZE_WRITES',
  'Lifetime budget canary preparation remains account-wide frozen',
  'OPERATOR',
  'lifetime-budget-regression'
);

create temporary table lifetime_budget_read_lease on commit drop as
select public.claim_meta_account_operation(
  '26000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  'READ_SYNC',
  'lifetime-budget-regression-read',
  300
) as lease_token;

do $$
begin
  if (select lease_token from lifetime_budget_read_lease) is null then
    raise exception 'Lifetime budget fixture did not obtain a READ_SYNC lease';
  end if;

  begin
    perform public.materialize_meta_customer_lifetime_budget_canary_plan(
      '16000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000001',
      '46000000-0000-4000-8000-000000000001',
      (select lease_token from lifetime_budget_read_lease),
      1500, 1801,
      'Movement above the confirmed twenty percent limit must fail',
      now()
    );
    raise exception 'Lifetime movement above 20 percent was accepted';
  exception
    when others then
      if sqlerrm = 'Lifetime movement above 20 percent was accepted' then raise; end if;
      if sqlerrm <> 'Lifetime budget canary exceeds the rolling 24-hour limit' then raise; end if;
  end;

  begin
    perform public.materialize_meta_customer_lifetime_budget_canary_plan(
      '16000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000001',
      '46000000-0000-4000-8000-000000000001',
      (select lease_token from lifetime_budget_read_lease),
      1499, 1800,
      'A stale expected Lifetime budget must fail closed',
      now()
    );
    raise exception 'Lifetime campaign drift was accepted';
  exception
    when others then
      if sqlerrm = 'Lifetime campaign drift was accepted' then raise; end if;
      if sqlerrm <> 'Selected lifetime campaign is stale, inactive or drifted' then raise; end if;
  end;
end;
$$;

create temporary table lifetime_budget_materialization on commit drop as
select public.materialize_meta_customer_lifetime_budget_canary_plan(
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000001',
  (select lease_token from lifetime_budget_read_lease),
  1500, 1800,
  'Customer-confirmed Lifetime budget increase from fifteen to eighteen euro',
  now()
) as result;

do $$
declare
  v_result jsonb;
  v_plan public.mutation_plans%rowtype;
  v_existing jsonb;
  v_claim_count integer;
begin
  select result into v_result from lifetime_budget_materialization;
  if v_result->>'outcome' <> 'CREATED'
    or v_result->>'status' <> 'PENDING'
    or v_result->>'budget_type' <> 'LIFETIME'
    or (v_result->>'before_budget_minor')::bigint <> 1500
    or (v_result->>'after_budget_minor')::bigint <> 1800
    or coalesce(v_result->>'payload_hash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Lifetime budget materialization result is invalid';
  end if;

  select plan.* into v_plan
  from public.mutation_plans plan
  where plan.id = (v_result->>'plan_id')::uuid;

  if not found
    or v_plan.source_rule_key <> 'operator_lifetime_budget_canary_v2'
    or v_plan.source_rule_version <> 2
    or v_plan.action_type <> 'UPDATE_BUDGET'
    or v_plan.target_type <> 'CAMPAIGN'
    or (v_plan.expected_before->>'lifetime_budget_minor')::bigint <> 1500
    or v_plan.expected_before ? 'daily_budget_minor'
    or v_plan.expected_before->>'status' <> 'ACTIVE'
    or (v_plan.expected_before->>'source_marketing_sync_id')::uuid
      is distinct from '36000000-0000-4000-8000-000000000001'::uuid
    or v_plan.intended_after <> '{"lifetime_budget_minor":1800}'::jsonb
    or v_plan.planned_payload->>'budget_type' <> 'lifetime_budget'
    or v_plan.planned_payload->>'direction' <> 'INCREASE'
    or v_plan.planned_payload->>'change_bps' <> '2000'
    or v_plan.priority <> 95
    or v_plan.max_attempts <> 1
    or v_plan.not_before <> 'infinity'::timestamptz then
    raise exception 'Lifetime budget plan does not match the fixed contract';
  end if;

  if (select count(*) from public.mutation_plan_steps step
      where step.plan_id = v_plan.id) <> 4
    or (select string_agg(step.operation, ',' order by step.step_index)
        from public.mutation_plan_steps step
        where step.plan_id = v_plan.id) <> 'VALIDATE,UPDATE,READ,RECONCILE'
    or exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and (
          step.planned_request ? 'daily_budget'
          or step.planned_request ? 'daily_budget_minor'
          or (
            step.operation = 'UPDATE'
            and step.planned_request->>'budget_type' is distinct from 'lifetime_budget'
          )
        )
    )
    or not exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.operation = 'UPDATE'
        and step.planned_request->>'budget_type' = 'lifetime_budget'
        and step.planned_request->>'amount_minor' = '1800'
    ) then
    raise exception 'Lifetime budget plan steps are mixed or incomplete';
  end if;

  if exists (
    select 1 from public.daily_budget_exposures exposure
    where exposure.automation_target_id = v_plan.automation_target_id
  ) then
    raise exception 'Lifetime budget plan entered daily exposure accounting';
  end if;

  select count(*) into v_claim_count
  from public.claim_next_meta_mutation_execution(
    'lifetime-budget-worker-before-approval', 300
  );
  if v_claim_count <> 0 then
    raise exception 'Unapproved Lifetime budget plan became claimable';
  end if;

  select public.materialize_meta_customer_lifetime_budget_canary_plan(
    '16000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '46000000-0000-4000-8000-000000000001',
    (select lease_token from lifetime_budget_read_lease),
    1500, 1800,
    'Customer-confirmed Lifetime budget increase from fifteen to eighteen euro',
    now()
  ) into v_existing;

  if v_existing->>'outcome' <> 'EXISTING'
    or v_existing->>'plan_id' <> v_result->>'plan_id'
    or (select count(*) from public.mutation_plans plan
        where plan.id = (v_result->>'plan_id')::uuid) <> 1 then
    raise exception 'Lifetime budget materialization is not idempotent';
  end if;
end;
$$;

select public.release_meta_account_operation(
  '26000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  (select lease_token from lifetime_budget_read_lease)
);

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  null,
  'ALLOW',
  'Exact Lifetime budget canary approval window',
  'CUSTOMER',
  'lifetime-budget-regression'
);

do $$
declare
  v_result jsonb := (select result from lifetime_budget_materialization);
begin
  begin
    perform public.approve_meta_budget_canary_plan(
      '16000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000001',
      (v_result->>'plan_id')::uuid,
      v_result->>'payload_hash',
      1500, 1799,
      'Mismatched Lifetime approval fingerprint must fail'
    );
    raise exception 'Mismatched Lifetime approval was accepted';
  exception
    when others then
      if sqlerrm = 'Mismatched Lifetime approval was accepted' then raise; end if;
      if sqlerrm <> 'Budget canary confirmation fingerprint mismatch' then raise; end if;
  end;
end;
$$;

create temporary table lifetime_budget_approval on commit drop as
select * from public.approve_meta_budget_canary_plan(
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  ((select result from lifetime_budget_materialization)->>'plan_id')::uuid,
  (select result->>'payload_hash' from lifetime_budget_materialization),
  1500, 1800,
  'Customer confirmed the exact fifteen to eighteen euro Lifetime change'
);

create temporary table lifetime_budget_claim on commit drop as
select * from public.claim_next_meta_mutation_execution(
  'lifetime-budget-executor-worker', 600
);

create temporary table lifetime_budget_steps (
  phase text primary key,
  step_id uuid not null,
  operation text not null,
  object_type text not null
) on commit drop;

insert into lifetime_budget_steps
select 'validate', first_step_id, first_step_operation, first_step_object_type
from lifetime_budget_claim;

select * from public.begin_meta_mutation_step_dispatch(
  (select execution_id from lifetime_budget_claim),
  (select step_id from lifetime_budget_steps where phase = 'validate'),
  (select lease_token from lifetime_budget_claim)
);

select public.complete_meta_mutation_remote_step(
  (select execution_id from lifetime_budget_claim),
  (select step_id from lifetime_budget_steps where phase = 'validate'),
  (select lease_token from lifetime_budget_claim),
  repeat('1', 64), repeat('2', 64), null,
  'lifetime-budget-validate-1', true,
  '{"account_util_pct":1}'::jsonb
);

insert into lifetime_budget_steps
select 'update', step_id, operation, object_type
from public.claim_next_meta_mutation_step(
  (select execution_id from lifetime_budget_claim),
  (select lease_token from lifetime_budget_claim)
);

select * from public.begin_meta_mutation_step_dispatch(
  (select execution_id from lifetime_budget_claim),
  (select step_id from lifetime_budget_steps where phase = 'update'),
  (select lease_token from lifetime_budget_claim)
);

select public.complete_meta_mutation_remote_step(
  (select execution_id from lifetime_budget_claim),
  (select step_id from lifetime_budget_steps where phase = 'update'),
  (select lease_token from lifetime_budget_claim),
  repeat('3', 64), repeat('4', 64), null,
  'lifetime-budget-update-1', false,
  '{"account_util_pct":1}'::jsonb
);

insert into lifetime_budget_steps
select 'read', step_id, operation, object_type
from public.claim_next_meta_mutation_step(
  (select execution_id from lifetime_budget_claim),
  (select lease_token from lifetime_budget_claim)
);

select public.record_meta_mutation_remote_snapshot(
  (select execution_id from lifetime_budget_claim),
  (select step_id from lifetime_budget_steps where phase = 'read'),
  (select lease_token from lifetime_budget_claim),
  'READ_AFTER_WRITE', '888888888801',
  '{"id":"888888888801","account_id":"888888888888","lifetime_budget":"1800","status":"ACTIVE","effective_status":"ACTIVE"}'::jsonb,
  repeat('5', 64),
  'lifetime-budget-read-1'
);

insert into lifetime_budget_steps
select 'reconcile', step_id, operation, object_type
from public.claim_next_meta_mutation_step(
  (select execution_id from lifetime_budget_claim),
  (select lease_token from lifetime_budget_claim)
);

create temporary table lifetime_budget_reconcile on commit drop as
select * from public.reconcile_meta_mutation_plan(
  (select execution_id from lifetime_budget_claim),
  (select step_id from lifetime_budget_steps where phase = 'reconcile'),
  (select lease_token from lifetime_budget_claim)
);

do $$
declare
  v_plan public.mutation_plans%rowtype;
begin
  if (select count(*) from lifetime_budget_claim) <> 1
    or (select plan_id from lifetime_budget_claim)
      is distinct from ((select result from lifetime_budget_materialization)->>'plan_id')::uuid
    or (select outcome from lifetime_budget_reconcile) <> 'SUCCEEDED' then
    raise exception 'Lifetime budget executor happy path did not complete';
  end if;

  select plan.* into v_plan
  from public.mutation_plans plan
  where plan.id = (select plan_id from lifetime_budget_claim);

  if v_plan.status <> 'SUCCEEDED'
    or v_plan.attempt_count <> 1
    or v_plan.terminal_at is null
    or v_plan.lease_token is not null
    or (select daily_budget_minor from public.campaigns
        where id = '46000000-0000-4000-8000-000000000001') is not null
    or (select lifetime_budget_minor from public.campaigns
        where id = '46000000-0000-4000-8000-000000000001') <> 1800
    or (select count(*) from public.budget_mutation_ledger ledger
        where ledger.plan_id = v_plan.id) <> 1
    or (select before_budget_minor from public.budget_mutation_ledger ledger
        where ledger.plan_id = v_plan.id) <> 1500
    or (select after_budget_minor from public.budget_mutation_ledger ledger
        where ledger.plan_id = v_plan.id) <> 1800
    or (select count(*) from public.meta_mutation_remote_snapshots snapshot
        where snapshot.plan_id = v_plan.id
          and snapshot.snapshot_kind = 'READ_AFTER_WRITE') <> 1
    or exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.status not in ('VALIDATED','REMOTE_APPLIED','RECONCILED')
    )
    or exists (
      select 1 from public.daily_budget_exposures exposure
      where exposure.automation_target_id = v_plan.automation_target_id
    ) then
    raise exception 'Lifetime budget reconciliation state is incorrect';
  end if;

  if (select count(*) from public.meta_budget_canary_approvals approval
      where approval.plan_id = v_plan.id
        and approval.expected_before_minor = 1500
        and approval.intended_after_minor = 1800) <> 1
    or (select count(*) from public.mutation_audit_events audit
        where audit.plan_id = v_plan.id
          and audit.event_type = 'BUDGET_CANARY_PLAN_APPROVED') <> 1 then
    raise exception 'Lifetime budget approval evidence is incomplete';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.materialize_meta_customer_lifetime_budget_canary_plan(uuid,uuid,uuid,uuid,bigint,bigint,text,timestamptz)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.materialize_meta_customer_lifetime_budget_canary_plan(uuid,uuid,uuid,uuid,bigint,bigint,text,timestamptz)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.meta_budget_plan_type(public.mutation_plans)',
      'EXECUTE'
    ) then
    raise exception 'Lifetime budget canary RPC privileges are incorrect';
  end if;
end;
$$;

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '16000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  null,
  'FREEZE_WRITES',
  'Lifetime budget canary regression completed',
  'SYSTEM',
  'lifetime-budget-regression'
);

rollback;

select 'Meta Lifetime budget canary checks passed' as result;

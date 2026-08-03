begin;

insert into auth.users (id, email)
values
  ('12000000-0000-4000-8000-000000000001', 'executor-owner@example.test'),
  ('12000000-0000-4000-8000-000000000002', 'executor-other@example.test');

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
) values
  (
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'meta', 'executor-owner', '900000000001', 'Executor Owner Meta',
    null, 'ciphertext', 'iv', 'auth-tag',
    '["act_111111111111"]'::jsonb,
    array['ads_read','ads_management']::text[],
    now() + interval '30 days', now() + interval '30 days',
    '111111111111', 'EUR', 'Europe/Berlin', 'success',
    '32000000-0000-4000-8000-000000000001', now(),
    1, 0, 0, 0, 0, 1, current_date - 13, current_date
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000002',
    'meta', 'executor-other', '900000000002', 'Executor Other Meta',
    null, 'ciphertext-2', 'iv-2', 'auth-tag-2',
    '["act_222222222222"]'::jsonb,
    array['ads_read','ads_management']::text[],
    now() + interval '30 days', now() + interval '30 days',
    '222222222222', 'EUR', 'Europe/Berlin', 'success',
    '32000000-0000-4000-8000-000000000002', now(),
    1, 0, 0, 0, 0, 0, current_date - 13, current_date
  );

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, last_seen_sync_id,
  last_seen_at, is_current
) values
  (
    '42000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '111111111111', 'Executor Owner Campaign', 'ACTIVE', 'ACTIVE',
    'OUTCOME_SALES', 2000,
    '32000000-0000-4000-8000-000000000001', now(), true
  ),
  (
    '42000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    '222222222222', 'Executor Other Campaign', 'ACTIVE', 'ACTIVE',
    'OUTCOME_TRAFFIC', 2000,
    '32000000-0000-4000-8000-000000000002', now(), true
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
) values
  (
    '82000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    1, 'ACTIVE', 'EUR', 10000, 6000, 2000, 43200, 17500, 21000,
    true, true, true, true,
    '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
    repeat('a', 64), true, now(),
    '12000000-0000-4000-8000-000000000001', now()
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    1, 'ACTIVE', 'EUR', 10000, 6000, 2000, 43200, 17500, 21000,
    true, true, true, true,
    '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
    repeat('b', 64), true, now(),
    '12000000-0000-4000-8000-000000000002', now()
  );

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  null,
  'ALLOW', 'Mutation executor regression fixture', 'OPERATOR', 'test'
);

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '12000000-0000-4000-8000-000000000002',
  '22000000-0000-4000-8000-000000000002',
  null,
  'ALLOW', 'Mutation executor regression fixture', 'OPERATOR', 'test'
);

-- This legacy executor fixture deliberately bypasses the customer-confirmed
-- canary gate so it can remain focused on execution and reconciliation.
insert into public.meta_account_write_modes (
  user_id, platform_account_id, mode,
  customer_confirmed_at, customer_confirmed_by
) values
  (
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'AUTONOMOUS', now(), '12000000-0000-4000-8000-000000000001'
  ),
  (
    '12000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    'AUTONOMOUS', now(), '12000000-0000-4000-8000-000000000002'
  );

select * from public.set_meta_customer_automation_scope(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'CAMPAIGN',
  '42000000-0000-4000-8000-000000000001',
  'MANAGED',
  'Mutation executor regression campaign selection'
);

insert into public.campaign_recommendations (
  id, user_id, platform_account_id, campaign_id, rule_key, rule_version,
  severity, priority, title, summary, evidence, evidence_hash,
  window_start, window_end, status, generated_at, expires_at
) values (
  '62000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  'spend_without_results_14d', 1, 'warning', 75,
  'Ausgaben ohne Ergebnis', 'Executor regression recommendation',
  '{"rule":"spend_without_results_14d","spend":100,"results":0,"currency":"EUR"}'::jsonb,
  md5('{"rule":"spend_without_results_14d","spend":100,"results":0,"currency":"EUR"}'),
  current_date - 13, current_date, 'active', now(), now() + interval '2 hours'
);

create temporary table executor_read_lease (
  lease_token uuid not null
) on commit drop;

insert into executor_read_lease
select public.claim_meta_account_operation(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'READ_SYNC', 'executor-planner-regression', 900
);

select public.record_meta_campaign_budget_sharing_snapshot(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  (select lease_token from executor_read_lease),
  '[{"platform_campaign_id":"111111111111","is_adset_budget_sharing_enabled":false}]'::jsonb
);

create temporary table executor_planner_result on commit drop as
select * from public.run_meta_budget_planner(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  (select lease_token from executor_read_lease),
  now()
);

select public.release_meta_account_operation(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  (select lease_token from executor_read_lease)
);

create temporary table executor_claim on commit drop as
select * from public.claim_next_meta_mutation_execution(
  'executor-worker-1', 600
);

create temporary table executor_steps (
  phase text primary key,
  step_id uuid not null,
  operation text not null,
  object_type text not null
) on commit drop;

insert into executor_steps
select 'validate', first_step_id, first_step_operation, first_step_object_type
from executor_claim;

select * from public.begin_meta_mutation_step_dispatch(
  (select execution_id from executor_claim),
  (select step_id from executor_steps where phase = 'validate'),
  (select lease_token from executor_claim)
);

select public.complete_meta_mutation_remote_step(
  (select execution_id from executor_claim),
  (select step_id from executor_steps where phase = 'validate'),
  (select lease_token from executor_claim),
  repeat('1', 64), repeat('2', 64), null, 'validate-req-1', true,
  '{"account_util_pct":1}'::jsonb
);

insert into executor_steps
select 'update', step_id, operation, object_type
from public.claim_next_meta_mutation_step(
  (select execution_id from executor_claim),
  (select lease_token from executor_claim)
);

select * from public.begin_meta_mutation_step_dispatch(
  (select execution_id from executor_claim),
  (select step_id from executor_steps where phase = 'update'),
  (select lease_token from executor_claim)
);

select public.complete_meta_mutation_remote_step(
  (select execution_id from executor_claim),
  (select step_id from executor_steps where phase = 'update'),
  (select lease_token from executor_claim),
  repeat('3', 64), repeat('4', 64), null, 'update-req-1', false,
  '{"account_util_pct":2}'::jsonb
);

insert into executor_steps
select 'read', step_id, operation, object_type
from public.claim_next_meta_mutation_step(
  (select execution_id from executor_claim),
  (select lease_token from executor_claim)
);

select public.record_meta_mutation_remote_snapshot(
  (select execution_id from executor_claim),
  (select step_id from executor_steps where phase = 'read'),
  (select lease_token from executor_claim),
  'READ_AFTER_WRITE', '111111111111',
  '{"id":"111111111111","account_id":"111111111111","daily_budget":"1600","status":"ACTIVE","effective_status":"ACTIVE"}'::jsonb,
  repeat('5', 64), 'read-req-1'
);

insert into executor_steps
select 'reconcile', step_id, operation, object_type
from public.claim_next_meta_mutation_step(
  (select execution_id from executor_claim),
  (select lease_token from executor_claim)
);

create temporary table executor_reconcile on commit drop as
select * from public.reconcile_meta_mutation_plan(
  (select execution_id from executor_claim),
  (select step_id from executor_steps where phase = 'reconcile'),
  (select lease_token from executor_claim)
);

do $$
declare
  v_plan public.mutation_plans%rowtype;
begin
  if (select planner_status from executor_planner_result) <> 'PLANNED'
    or (select count(*) from executor_claim) <> 1
    or (select outcome from executor_reconcile) <> 'SUCCEEDED' then
    raise exception 'Executor happy path did not complete';
  end if;

  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = (select plan_id from executor_claim);

  if v_plan.status <> 'SUCCEEDED'
    or v_plan.attempt_count <> 1
    or v_plan.terminal_at is null
    or v_plan.lease_token is not null
    or (select daily_budget_minor from public.campaigns
        where id = '42000000-0000-4000-8000-000000000001') <> 1600
    or (select count(*) from public.budget_mutation_ledger
        where plan_id = v_plan.id) <> 1
    or (select after_budget_minor from public.budget_mutation_ledger
        where plan_id = v_plan.id) <> 1600
    or (select count(*) from public.meta_mutation_remote_snapshots
        where plan_id = v_plan.id and snapshot_kind = 'READ_AFTER_WRITE') <> 1
    or exists (
      select 1 from public.mutation_plan_steps
      where plan_id = v_plan.id and status not in ('VALIDATED','REMOTE_APPLIED','RECONCILED')
    )
    or (select automation_executor_status from public.platform_accounts
        where id = v_plan.platform_account_id) <> 'success'
    or exists (
      select 1 from public.meta_account_operation_leases
      where platform_account_id = v_plan.platform_account_id
        and lease_token is not null
    ) then
    raise exception 'Executor reconciliation state is incorrect';
  end if;
end;
$$;

-- The executor independently re-checks the rolling 20% budget limit directly
-- before dispatch. After a reconciled 2,000 -> 1,600 history entry consumed
-- exactly 400 minor units, a further single minor unit must fail without a remote call.
savepoint executor_movement_plus_one;

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, last_seen_sync_id,
  last_seen_at, is_current
) values (
  '42000000-0000-4000-8000-000000000020',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '111111111120', 'Executor Limit Boundary Campaign', 'ACTIVE', 'ACTIVE',
  'OUTCOME_SALES', 1600,
  '32000000-0000-4000-8000-000000000001', now(), true
);

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_successful_mutation_at,
  last_reconciled_at
) values (
  '52000000-0000-4000-8000-000000000020',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'CAMPAIGN', 'campaign:111111111120', '111111111120',
  'campaign:111111111120', 'CAMPAIGN', 'campaign:111111111120',
  '42000000-0000-4000-8000-000000000020', 'MANAGED',
  now() - interval '13 hours', now() - interval '13 hours'
);

select * from public.set_meta_customer_automation_scope(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'TARGET',
  '52000000-0000-4000-8000-000000000020',
  'MANAGED',
  'Executor movement-boundary target selection'
);

insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  action_type, target_type, target_key, campaign_scope_key, budget_owner_key,
  automation_target_id, idempotency_key, expected_before, intended_after,
  planned_payload, payload_hash, status, priority, safety_action,
  attempt_count, terminal_at, created_at, updated_at
) values (
  '72000000-0000-4000-8000-000000000019',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'UPDATE_BUDGET', 'CAMPAIGN', 'campaign:111111111120',
  'campaign:111111111120', 'campaign:111111111120',
  '52000000-0000-4000-8000-000000000020', repeat('1', 64),
  '{"daily_budget_minor":2000}'::jsonb,
  '{"daily_budget_minor":1600}'::jsonb,
  '{"operation":"UPDATE_BUDGET","amount_minor":1600}'::jsonb,
  public.meta_sha256('{"operation":"UPDATE_BUDGET","amount_minor":1600}'::jsonb::text),
  'SUCCEEDED', 50, false, 1, now() - interval '13 hours',
  now() - interval '14 hours', now() - interval '13 hours'
);

insert into public.mutation_plan_steps (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, planned_request, request_hash, expected_result,
  compensation_operation, status, started_at, completed_at, created_at, updated_at
) values (
  '73000000-0000-4000-8000-000000000019',
  '72000000-0000-4000-8000-000000000019',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  0, 'historical-budget-update', 'UPDATE', 'CAMPAIGN',
  '{"amount_minor":1600,"mode":"execute"}'::jsonb,
  public.meta_sha256('{"amount_minor":1600,"mode":"execute"}'::jsonb::text),
  '{"daily_budget_minor":1600}'::jsonb, 'PAUSE', 'RECONCILED',
  now() - interval '13 hours', now() - interval '13 hours',
  now() - interval '14 hours', now() - interval '13 hours'
);

insert into public.mutation_executions (
  id, plan_id, user_id, platform_account_id, attempt_number, worker_id,
  lease_token, status, started_at, last_heartbeat_at, finished_at
) values (
  '74000000-0000-4000-8000-000000000019',
  '72000000-0000-4000-8000-000000000019',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  1, 'executor-history-fixture',
  '75000000-0000-4000-8000-000000000019', 'SUCCEEDED',
  now() - interval '13 hours', now() - interval '13 hours',
  now() - interval '13 hours'
);

insert into public.budget_mutation_ledger (
  id, user_id, platform_account_id, policy_id, plan_id, step_id,
  execution_id, automation_target_id, budget_owner_key, currency,
  before_budget_minor, after_budget_minor, remote_request_id,
  executed_at, reconciled_at
) values (
  '76000000-0000-4000-8000-000000000019',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000019',
  '73000000-0000-4000-8000-000000000019',
  '74000000-0000-4000-8000-000000000019',
  '52000000-0000-4000-8000-000000000020',
  'campaign:111111111120', 'EUR', 2000, 1600,
  'historical-limit-request', now() - interval '13 hours',
  now() - interval '13 hours' + interval '1 minute'
);

select *
from public.reserve_meta_daily_budget_exposure(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  (
    select (mp.planned_payload->>'exposure_snapshot_id')::uuid
    from public.mutation_plans mp
    where mp.id = (select plan_id from executor_claim)
  ),
  null,
  '52000000-0000-4000-8000-000000000020',
  (
    select s.account_day
    from public.daily_budget_exposure_snapshots s
    where s.id = (
      select (mp.planned_payload->>'exposure_snapshot_id')::uuid
      from public.mutation_plans mp
      where mp.id = (select plan_id from executor_claim)
    )
  ),
  'campaign:111111111120', 'campaign:111111111120',
  'CAMPAIGN', false, 'EUR', 1600, 17500, 'SNAPSHOT'
);

with source_plan as (
  select mp.*
  from public.mutation_plans mp
  where mp.id = (select plan_id from executor_claim)
), payload as (
  select jsonb_build_object(
    'schema_version', 1,
    'operation', 'UPDATE_BUDGET',
    'object_type', 'CAMPAIGN',
    'object_id', '111111111120',
    'target_key', 'campaign:111111111120',
    'budget_type', 'daily_budget',
    'amount_minor', 1601,
    'direction', 'INCREASE',
    'change_bps', 1,
    'exposure_snapshot_id', source_plan.planned_payload->>'exposure_snapshot_id'
  ) as value
  from source_plan
)
insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  action_type, target_type, target_key, campaign_scope_key, budget_owner_key,
  automation_target_id, idempotency_key, expected_before, intended_after,
  planned_payload, payload_hash, status, priority, safety_action
)
select
  '72000000-0000-4000-8000-000000000020', source_plan.user_id,
  source_plan.platform_account_id, source_plan.policy_id,
  source_plan.source_marketing_sync_id, 'UPDATE_BUDGET', 'CAMPAIGN',
  'campaign:111111111120', 'campaign:111111111120',
  'campaign:111111111120', '52000000-0000-4000-8000-000000000020',
  repeat('2', 64), '{"daily_budget_minor":1600}'::jsonb,
  '{"daily_budget_minor":1601}'::jsonb, payload.value,
  public.meta_sha256(payload.value::text), 'PENDING', 50, false
from source_plan cross join payload;

with requests as (
  select
    jsonb_build_object(
      'operation', 'UPDATE_BUDGET', 'object_type', 'CAMPAIGN',
      'object_id', '111111111120', 'budget_type', 'daily_budget',
      'amount_minor', 1601, 'mode', 'validate_only'
    ) as validate_request,
    jsonb_build_object(
      'operation', 'UPDATE_BUDGET', 'object_type', 'CAMPAIGN',
      'object_id', '111111111120', 'budget_type', 'daily_budget',
      'amount_minor', 1601, 'mode', 'execute'
    ) as update_request
)
insert into public.mutation_plan_steps (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, depends_on_step_id, planned_request, request_hash,
  expected_result, compensation_operation, status
)
select
  '73000000-0000-4000-8000-000000000020'::uuid,
  '72000000-0000-4000-8000-000000000020'::uuid,
  '12000000-0000-4000-8000-000000000001'::uuid,
  '22000000-0000-4000-8000-000000000001'::uuid,
  0, 'validate-budget-plus-one', 'VALIDATE', 'CAMPAIGN', null::uuid,
  requests.validate_request, public.meta_sha256(requests.validate_request::text),
  '{"daily_budget_minor":1601}'::jsonb, 'NONE', 'PENDING'
from requests
union all
select
  '73000000-0000-4000-8000-000000000021',
  '72000000-0000-4000-8000-000000000020',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  1, 'execute-budget-plus-one', 'UPDATE', 'CAMPAIGN',
  '73000000-0000-4000-8000-000000000020',
  requests.update_request, public.meta_sha256(requests.update_request::text),
  '{"daily_budget_minor":1601}'::jsonb, 'PAUSE', 'PENDING'
from requests;

create temporary table executor_limit_claim on commit drop as
select * from public.claim_next_meta_mutation_execution(
  'executor-worker-limit-plus-one', 600
);

select * from public.begin_meta_mutation_step_dispatch(
  (select execution_id from executor_limit_claim),
  (select first_step_id from executor_limit_claim),
  (select lease_token from executor_limit_claim)
);

select public.complete_meta_mutation_remote_step(
  (select execution_id from executor_limit_claim),
  (select first_step_id from executor_limit_claim),
  (select lease_token from executor_limit_claim),
  repeat('6', 64), repeat('7', 64), null, 'validate-limit-plus-one', true,
  '{"account_util_pct":1}'::jsonb
);

create temporary table executor_limit_update_step on commit drop as
select * from public.claim_next_meta_mutation_step(
  (select execution_id from executor_limit_claim),
  (select lease_token from executor_limit_claim)
);

do $$
begin
  if (select plan_id from executor_limit_claim)
       <> '72000000-0000-4000-8000-000000000020'
    or (select operation from executor_limit_update_step) <> 'UPDATE' then
    raise exception 'Budget plus-one fixture did not reach executor UPDATE pre-dispatch';
  end if;

  begin
    perform public.begin_meta_mutation_step_dispatch(
      (select execution_id from executor_limit_claim),
      (select step_id from executor_limit_update_step),
      (select lease_token from executor_limit_claim)
    );
    raise exception 'Executor accepted rolling budget movement above 20 percent';
  exception
    when others then
      if sqlerrm = 'Executor accepted rolling budget movement above 20 percent' then
        raise;
      end if;
      if sqlerrm <> 'Rolling 24-hour budget movement limit exceeded' then
        raise;
      end if;
  end;

  if (select dispatch_state from public.mutation_plan_steps
      where id = (select step_id from executor_limit_update_step)) <> 'NOT_DISPATCHED'
    or exists (
      select 1 from public.budget_mutation_ledger
      where plan_id = '72000000-0000-4000-8000-000000000020'
    ) then
    raise exception 'Rejected budget plus-one mutation changed remote or ledger state';
  end if;
end;
$$;

rollback to savepoint executor_movement_plus_one;
release savepoint executor_movement_plus_one;

-- A new stale plan is blocked before an execution or account lease is created.
insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  action_type, target_type, target_key, campaign_scope_key, budget_owner_key,
  automation_target_id, idempotency_key, expected_before, intended_after,
  planned_payload, payload_hash, status, priority, safety_action
)
select
  '72000000-0000-4000-8000-000000000002', mp.user_id,
  mp.platform_account_id, mp.policy_id, mp.source_marketing_sync_id,
  'UPDATE_BUDGET', mp.target_type, mp.target_key, mp.campaign_scope_key,
  mp.budget_owner_key, mp.automation_target_id, repeat('c', 64),
  '{"daily_budget_minor":9999}'::jsonb,
  '{"daily_budget_minor":8000}'::jsonb,
  '{"operation":"UPDATE_BUDGET","daily_budget_minor":8000}'::jsonb,
  public.meta_sha256('{"operation":"UPDATE_BUDGET","daily_budget_minor":8000}'::jsonb::text),
  'PENDING', 50, false
from public.mutation_plans mp
where mp.id = (select plan_id from executor_claim);

select * from public.claim_next_meta_mutation_execution(
  'executor-worker-drift', 600
);

do $$
begin
  if (select status from public.mutation_plans
      where id = '72000000-0000-4000-8000-000000000002') <> 'STALE'
    or (select blocked_reason from public.mutation_plans
        where id = '72000000-0000-4000-8000-000000000002') <> 'before_state_drift'
    or exists (
      select 1 from public.mutation_executions
      where plan_id = '72000000-0000-4000-8000-000000000002'
    ) then
    raise exception 'Before-state drift was not blocked before execution';
  end if;
end;
$$;

-- Create a status-pause saga and simulate an unknown response after POST.
insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  action_type, target_type, target_key, campaign_scope_key,
  automation_target_id, idempotency_key, expected_before, intended_after,
  planned_payload, payload_hash, status, priority, safety_action
) values (
  '72000000-0000-4000-8000-000000000003',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'SAFETY_PAUSE', 'CAMPAIGN', 'campaign:111111111111',
  'campaign:111111111111',
  (select id from public.automation_targets
   where platform_account_id = '22000000-0000-4000-8000-000000000001'
     and target_key = 'campaign:111111111111'),
  repeat('d', 64),
  '{"status":"ACTIVE"}'::jsonb,
  '{"status":"PAUSED"}'::jsonb,
  '{"operation":"SAFETY_PAUSE","status":"PAUSED"}'::jsonb,
  public.meta_sha256('{"operation":"SAFETY_PAUSE","status":"PAUSED"}'::jsonb::text),
  'PENDING', 1, true
);

insert into public.mutation_plan_steps (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, depends_on_step_id, planned_request,
  request_hash, expected_result, compensation_operation
) values
  (
    '73000000-0000-4000-8000-000000000030',
    '72000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    0, 'validate-status', 'VALIDATE', 'CAMPAIGN', null,
    '{"operation":"update_campaign_status","object_id":"111111111111","status":"PAUSED","mode":"validate_only"}'::jsonb,
    public.meta_sha256('{"operation":"update_campaign_status","object_id":"111111111111","status":"PAUSED","mode":"validate_only"}'::jsonb::text),
    '{"validated":true}'::jsonb, 'NONE'
  ),
  (
    '73000000-0000-4000-8000-000000000031',
    '72000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    1, 'pause-campaign', 'UPDATE', 'CAMPAIGN',
    '73000000-0000-4000-8000-000000000030',
    '{"operation":"update_campaign_status","object_id":"111111111111","status":"PAUSED","mode":"execute"}'::jsonb,
    public.meta_sha256('{"operation":"update_campaign_status","object_id":"111111111111","status":"PAUSED","mode":"execute"}'::jsonb::text),
    '{"status":"PAUSED"}'::jsonb, 'NONE'
  ),
  (
    '73000000-0000-4000-8000-000000000032',
    '72000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    2, 'read-campaign', 'READ', 'CAMPAIGN',
    '73000000-0000-4000-8000-000000000031',
    '{"operation":"read_campaign","object_id":"111111111111"}'::jsonb,
    public.meta_sha256('{"operation":"read_campaign","object_id":"111111111111"}'::jsonb::text),
    '{"status":"PAUSED"}'::jsonb, 'NONE'
  ),
  (
    '73000000-0000-4000-8000-000000000033',
    '72000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    3, 'reconcile-status', 'RECONCILE', 'CAMPAIGN',
    '73000000-0000-4000-8000-000000000032',
    '{"operation":"reconcile_campaign_status","object_id":"111111111111"}'::jsonb,
    public.meta_sha256('{"operation":"reconcile_campaign_status","object_id":"111111111111"}'::jsonb::text),
    '{"status":"PAUSED"}'::jsonb, 'NONE'
  );

create temporary table executor_ambiguous_claim on commit drop as
select * from public.claim_next_meta_mutation_execution(
  'executor-worker-ambiguous', 600
);

select * from public.begin_meta_mutation_step_dispatch(
  (select execution_id from executor_ambiguous_claim),
  (select first_step_id from executor_ambiguous_claim),
  (select lease_token from executor_ambiguous_claim)
);
select public.complete_meta_mutation_remote_step(
  (select execution_id from executor_ambiguous_claim),
  (select first_step_id from executor_ambiguous_claim),
  (select lease_token from executor_ambiguous_claim),
  repeat('6', 64), repeat('7', 64), null, 'validate-req-2', true,
  '{}'::jsonb
);

create temporary table executor_ambiguous_steps (
  phase text primary key,
  step_id uuid not null
) on commit drop;
insert into executor_ambiguous_steps
select 'update', step_id from public.claim_next_meta_mutation_step(
  (select execution_id from executor_ambiguous_claim),
  (select lease_token from executor_ambiguous_claim)
);
select * from public.begin_meta_mutation_step_dispatch(
  (select execution_id from executor_ambiguous_claim),
  (select step_id from executor_ambiguous_steps where phase = 'update'),
  (select lease_token from executor_ambiguous_claim)
);
select public.fail_meta_mutation_execution(
  (select execution_id from executor_ambiguous_claim),
  (select step_id from executor_ambiguous_steps where phase = 'update'),
  (select lease_token from executor_ambiguous_claim),
  'TRANSPORT', 'transport_unknown', 'UNKNOWN', 120
);

do $$
begin
  if (select status from public.mutation_plans
      where id = '72000000-0000-4000-8000-000000000003') <> 'RECONCILING'
    or (select dispatch_state from public.mutation_plan_steps
        where id = '73000000-0000-4000-8000-000000000031') <> 'REMOTE_UNKNOWN'
    or not exists (
      select 1 from public.automation_alerts
      where plan_id = '72000000-0000-4000-8000-000000000003'
        and alert_type = 'REMOTE_OUTCOME_AMBIGUOUS'
        and severity = 'CRITICAL'
    ) then
    raise exception 'Unknown remote outcome was not persisted fail-closed';
  end if;

  begin
    perform public.begin_meta_mutation_step_dispatch(
      (select execution_id from executor_ambiguous_claim),
      '73000000-0000-4000-8000-000000000031',
      (select lease_token from executor_ambiguous_claim)
    );
    raise exception 'Ambiguous mutation was dispatched a second time';
  exception
    when others then
      if sqlerrm = 'Ambiguous mutation was dispatched a second time' then
        raise;
      end if;
  end;
end;
$$;

insert into executor_ambiguous_steps
select 'read', step_id from public.claim_next_meta_mutation_step(
  (select execution_id from executor_ambiguous_claim),
  (select lease_token from executor_ambiguous_claim)
);
select public.record_meta_mutation_remote_snapshot(
  (select execution_id from executor_ambiguous_claim),
  (select step_id from executor_ambiguous_steps where phase = 'read'),
  (select lease_token from executor_ambiguous_claim),
  'AMBIGUITY_PROBE', '111111111111',
  '{"id":"111111111111","account_id":"111111111111","daily_budget":"1600","status":"PAUSED","effective_status":"PAUSED"}'::jsonb,
  repeat('8', 64), 'ambiguity-probe-1'
);
insert into executor_ambiguous_steps
select 'reconcile', step_id from public.claim_next_meta_mutation_step(
  (select execution_id from executor_ambiguous_claim),
  (select lease_token from executor_ambiguous_claim)
);
select * from public.reconcile_meta_mutation_plan(
  (select execution_id from executor_ambiguous_claim),
  (select step_id from executor_ambiguous_steps where phase = 'reconcile'),
  (select lease_token from executor_ambiguous_claim)
);

do $$
begin
  if (select status from public.mutation_plans
      where id = '72000000-0000-4000-8000-000000000003') <> 'SUCCEEDED'
    or (select effective_status from public.campaigns
        where id = '42000000-0000-4000-8000-000000000001') <> 'PAUSED'
    or (select count(*) from public.mutation_executions
        where plan_id = '72000000-0000-4000-8000-000000000003') <> 1
    or exists (
      select 1 from public.meta_account_operation_leases
      where platform_account_id = '22000000-0000-4000-8000-000000000001'
        and lease_token is not null
    ) then
    raise exception 'Ambiguous outcome was not reconciled without duplicate mutation';
  end if;
end;
$$;

-- Atomic Active Launch Chain: materialization is held under FREEZE_WRITES.
select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  null,
  'FREEZE_WRITES',
  'Atomic launch preparation regression fixture',
  'OPERATOR',
  'test'
);

insert into public.allowed_domains (
  id, user_id, platform_account_id, hostname, registrable_domain,
  expected_redirect_hostname, observed_redirect_hostname, status,
  verification_method, verification_evidence, customer_confirmed_at,
  customer_confirmed_by, verified_at
) values (
  '91000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'shop.launch.example.test', 'example.test',
  'shop.launch.example.test', 'shop.launch.example.test', 'VERIFIED',
  'HTTPS_REDIRECT', '{"status_code":200}'::jsonb, now(),
  '12000000-0000-4000-8000-000000000001', now()
);

insert into public.objective_blueprints (
  id, user_id, platform_account_id, objective, version, name, status,
  payload_template, required_inputs, compliance_rules, blueprint_hash,
  customer_confirmed_at, customer_confirmed_by, activated_at
) values (
  '92000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'OUTCOME_SALES', 1, 'Launch Sales v1', 'ACTIVE',
  jsonb_build_object(
    'campaign', jsonb_build_object(
      'buying_type', 'AUCTION',
      'special_ad_categories', '[]'::jsonb
    ),
    'ad_set', jsonb_build_object(
      'billing_event', 'IMPRESSIONS',
      'optimization_goal', 'OFFSITE_CONVERSIONS',
      'targeting', jsonb_build_object(
        'geo_locations', jsonb_build_object('countries', jsonb_build_array('DE'))
      )
    ),
    'creative', jsonb_build_object(
      'object_story_spec', jsonb_build_object(
        'link_data', jsonb_build_object(
          'message', 'Launch regression creative',
          'link', 'https://shop.launch.example.test/products/regression'
        )
      )
    ),
    'ad', '{}'::jsonb
  ),
  '["destination_url"]'::jsonb,
  '{"verified_domain":true}'::jsonb,
  repeat('6', 64), now(),
  '12000000-0000-4000-8000-000000000001', now()
);

insert into public.brand_profiles (
  id, user_id, platform_account_id, version, status, display_name,
  brand_name, facebook_page_id, instagram_actor_id, guidelines,
  forbidden_content, generation_defaults, generated_asset_approval_mode,
  profile_hash, customer_confirmed_at, customer_confirmed_by, activated_at
) values (
  '94000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  1, 'ACTIVE', 'Launch Regression Brand', 'Launch Regression',
  '333333333390', '333333333391', '{}'::jsonb, '[]'::jsonb,
  '{}'::jsonb, 'AUTONOMOUS_POLICY', repeat('7', 64), now(),
  '12000000-0000-4000-8000-000000000001', now()
);

insert into public.brand_assets (
  id, user_id, platform_account_id, brand_profile_id, source_type,
  storage_bucket, storage_path, original_filename, sha256, mime_type,
  byte_size, width, height, brand_policy_version, moderation_status,
  status, metadata, reviewed_at, reviewed_by
) values (
  '93000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'UPLOADED', 'creative-assets',
  '12000000-0000-4000-8000-000000000001/22000000-0000-4000-8000-000000000001/88/'
    || repeat('8', 64) || '.png',
  'launch-regression.png', repeat('8', 64), 'image/png',
  2048, 1200, 1200, 1, 'APPROVED', 'READY',
  '{"purpose":"active_launch_regression"}'::jsonb, now(),
  '12000000-0000-4000-8000-000000000001'
);

create temporary table launch_read_lease (
  lease_token uuid not null
) on commit drop;

insert into launch_read_lease
select public.claim_meta_account_operation(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'READ_SYNC', 'launch-materializer-regression', 900
);

create temporary table launch_materialized on commit drop as
select public.materialize_meta_launch_chain_plan(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  (select snapshot_id from executor_planner_result),
  '32000000-0000-4000-8000-000000000001',
  (select lease_token from launch_read_lease),
  '92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  array['93000000-0000-4000-8000-000000000001'::uuid],
  '91000000-0000-4000-8000-000000000001',
  'AD_SET',
  3000,
  jsonb_build_object(
    'destination_url',
      'https://shop.launch.example.test/products/regression',
    'campaign_name', 'Launch Regression Campaign',
    'ad_set_name', 'Launch Regression Ad Set',
    'creative_name', 'Launch Regression Creative',
    'ad_name', 'Launch Regression Ad'
  ),
  now()
) as result;

create temporary table launch_replayed on commit drop as
select public.materialize_meta_launch_chain_plan(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  (select snapshot_id from executor_planner_result),
  '32000000-0000-4000-8000-000000000001',
  (select lease_token from launch_read_lease),
  '92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  array['93000000-0000-4000-8000-000000000001'::uuid],
  '91000000-0000-4000-8000-000000000001',
  'AD_SET',
  3000,
  jsonb_build_object(
    'destination_url',
      'https://shop.launch.example.test/products/regression',
    'campaign_name', 'Launch Regression Campaign',
    'ad_set_name', 'Launch Regression Ad Set',
    'creative_name', 'Launch Regression Creative',
    'ad_name', 'Launch Regression Ad'
  ),
  now()
) as result;

select public.release_meta_account_operation(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  (select lease_token from launch_read_lease)
);

create temporary table launch_ids (
  plan_id uuid primary key
) on commit drop;

insert into launch_ids
select (result->>'plan_id')::uuid from launch_materialized;

do $$
declare
  v_plan_id uuid := (select plan_id from launch_ids);
  v_step_keys text[];
  v_provisional_exposure public.daily_budget_exposures%rowtype;
begin
  select array_agg(step_key order by step_index)
    into v_step_keys
  from public.mutation_plan_steps
  where plan_id = v_plan_id;

  select exposure.* into v_provisional_exposure
  from public.daily_budget_exposures exposure
  where exposure.plan_id = v_plan_id;

  if (select result->>'outcome' from launch_materialized) <> 'CREATED'
    or (select result->>'status' from launch_materialized) <> 'HELD'
    or (select result->>'outcome' from launch_replayed) <> 'EXISTING'
    or (select result->>'status' from launch_replayed) <> 'HELD'
    or (select status from public.mutation_plans where id = v_plan_id) <> 'PENDING'
    or (select max_attempts from public.mutation_plans where id = v_plan_id) <> 1
    or not (select not_before = 'infinity'::timestamptz
            from public.mutation_plans where id = v_plan_id)
    or (select count(*) from public.meta_launch_canary_approvals
        where plan_id = v_plan_id) <> 0
    or (select (result->>'plan_id')::uuid from launch_replayed) <> v_plan_id
    or (select count(*) from public.mutation_plans
        where action_type = 'LAUNCH_CHAIN'
          and idempotency_key = (select result->>'idempotency_key'
                                 from launch_materialized)) <> 1
    or v_step_keys <> array[
      'validate-campaign', 'create-campaign-paused',
      'read-campaign-paused', 'validate-ad-set',
      'create-ad-set-paused', 'read-ad-set-paused', 'upload-image',
      'validate-creative', 'create-creative', 'read-creative',
      'validate-ad-paused', 'create-ad-paused', 'read-ad-paused',
      'activate-ad-set', 'read-ad-set-active', 'activate-campaign',
      'activate-ad', 'read-campaign-active', 'read-ad-active',
      'read-ad-set-active-final', 'reconcile-launch-chain'
    ]::text[]
    or exists (
      select 1 from public.mutation_plan_steps
      where plan_id = v_plan_id
        and public.meta_jsonb_has_sensitive_key(planned_request)
    )
    or (select planned_request#>>'{payload,status}'
        from public.mutation_plan_steps
        where plan_id = v_plan_id and step_key = 'create-campaign-paused')
       <> 'PAUSED'
    or (select planned_request#>>'{payload,status}'
        from public.mutation_plan_steps
        where plan_id = v_plan_id and step_key = 'create-ad-set-paused')
       <> 'PAUSED'
    or (select planned_request#>>'{payload,status}'
        from public.mutation_plan_steps
        where plan_id = v_plan_id and step_key = 'create-ad-paused')
       <> 'PAUSED'
    or v_provisional_exposure.id is null
    or v_provisional_exposure.source <> 'PLAN'
    or v_provisional_exposure.max_daily_budget_minor <> 3000
    or v_provisional_exposure.budget_owner_type <> 'AD_SET'
    or v_provisional_exposure.automation_target_id is not null then
    raise exception 'Launch materialization or idempotent replay is incorrect';
  end if;
end;
$$;

-- Fail-closed materialization checks must not create partial plans.
do $$
declare
  v_failed boolean;
  v_before integer := (select count(*) from public.mutation_plans
                       where action_type = 'LAUNCH_CHAIN');
  v_lease uuid;
begin
  v_lease := public.claim_meta_account_operation(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'READ_SYNC', 'launch-negative-regression', 900
  );

  v_failed := false;
  begin
    perform public.materialize_meta_customer_launch_plan(
      '12000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      v_lease,
      '92000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      'AD_SET', 3000,
      '{"destination_url":"https://sibling.example.test/path"}'::jsonb,
      now()
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Customer launch accepted a non-confirmed sibling hostname';
  end if;

  v_failed := false;
  begin
    perform public.materialize_meta_launch_chain_plan(
      '22000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      (select snapshot_id from executor_planner_result),
      '32000000-0000-4000-8000-000000000001', v_lease,
      '92000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      array['93000000-0000-4000-8000-000000000001'::uuid],
      '91000000-0000-4000-8000-000000000001', 'AD_SET', 3000,
      '{"destination_url":"https://evil.invalid/path"}'::jsonb, now()
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Unverified launch destination was accepted';
  end if;

  v_failed := false;
  begin
    perform public.materialize_meta_launch_chain_plan(
      '22000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      (select snapshot_id from executor_planner_result),
      '32000000-0000-4000-8000-000000000001', v_lease,
      '92000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      array['93000000-0000-4000-8000-000000000001'::uuid],
      '91000000-0000-4000-8000-000000000001', 'AD_SET', 7000,
      '{"destination_url":"https://shop.launch.example.test/too-large"}'::jsonb,
      now()
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Launch campaign hard cap was bypassed';
  end if;

  perform public.release_meta_account_operation(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001', v_lease
  );

  if (select count(*) from public.mutation_plans
      where action_type = 'LAUNCH_CHAIN') <> v_before then
    raise exception 'Rejected launch left a partial mutation plan';
  end if;
end;
$$;

create temporary table launch_unapproved_claim on commit drop as
select * from public.claim_next_meta_mutation_execution(
  'launch-unapproved-worker', 900
);

do $$
declare
  v_plan_id uuid := (select plan_id from launch_ids);
  v_failed boolean := false;
begin
  if (select count(*) from launch_unapproved_claim) <> 0
    or (select mode from public.kill_switch_state
        where scope_type = 'ACCOUNT'
          and user_id = '12000000-0000-4000-8000-000000000001'
          and platform_account_id = '22000000-0000-4000-8000-000000000001'
        order by sequence desc limit 1) <> 'FREEZE_WRITES'
    or (select mode from public.kill_switch_state
        where scope_type = 'PLAN' and plan_id = v_plan_id
        order by sequence desc limit 1) <> 'FREEZE_WRITES' then
    raise exception 'Unapproved launch was claimable or not held fail-closed';
  end if;

  begin
    perform public.approve_meta_launch_canary_plan(
      '12000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      v_plan_id,
      repeat('0', 64),
      (select result->>'objective' from launch_materialized),
      (select result->>'destination_url' from launch_materialized),
      (select result->>'budget_owner_type' from launch_materialized),
      (select (result->>'daily_budget_minor')::bigint from launch_materialized),
      (select result->>'campaign_name' from launch_materialized),
      (select result->>'ad_set_name' from launch_materialized),
      (select result->>'creative_name' from launch_materialized),
      (select result->>'ad_name' from launch_materialized),
      'ACTIVE',
      'Negative fingerprint regression.'
    );
  exception when others then
    v_failed := true;
  end;

  if not v_failed
    or (select count(*) from public.meta_launch_canary_approvals
        where plan_id = v_plan_id) <> 0
    or (select mode from public.kill_switch_state
        where scope_type = 'ACCOUNT'
          and user_id = '12000000-0000-4000-8000-000000000001'
          and platform_account_id = '22000000-0000-4000-8000-000000000001'
        order by sequence desc limit 1) <> 'FREEZE_WRITES'
    or (select mode from public.kill_switch_state
        where scope_type = 'PLAN' and plan_id = v_plan_id
        order by sequence desc limit 1) <> 'FREEZE_WRITES' then
    raise exception 'Mismatched launch fingerprint changed approval or gates';
  end if;
end;
$$;

create temporary table launch_approval on commit drop as
select * from public.approve_meta_launch_canary_plan(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  (select plan_id from launch_ids),
  (select result->>'payload_hash' from launch_materialized),
  (select result->>'objective' from launch_materialized),
  (select result->>'destination_url' from launch_materialized),
  (select result->>'budget_owner_type' from launch_materialized),
  (select (result->>'daily_budget_minor')::bigint from launch_materialized),
  (select result->>'campaign_name' from launch_materialized),
  (select result->>'ad_set_name' from launch_materialized),
  (select result->>'creative_name' from launch_materialized),
  (select result->>'ad_name' from launch_materialized),
  'ACTIVE',
  'Exact atomic launch regression approval.'
);

create temporary table launch_approval_replayed on commit drop as
select * from public.approve_meta_launch_canary_plan(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  (select plan_id from launch_ids),
  (select result->>'payload_hash' from launch_materialized),
  (select result->>'objective' from launch_materialized),
  (select result->>'destination_url' from launch_materialized),
  (select result->>'budget_owner_type' from launch_materialized),
  (select (result->>'daily_budget_minor')::bigint from launch_materialized),
  (select result->>'campaign_name' from launch_materialized),
  (select result->>'ad_set_name' from launch_materialized),
  (select result->>'creative_name' from launch_materialized),
  (select result->>'ad_name' from launch_materialized),
  'ACTIVE',
  'Exact atomic launch regression approval.'
);

do $$
declare
  v_plan_id uuid := (select plan_id from launch_ids);
begin
  if (select plan_status from launch_approval) <> 'PENDING'
    or (select plan_id from launch_approval) <> v_plan_id
    or (select approval_id from launch_approval_replayed)
       <> (select approval_id from launch_approval)
    or (select count(*) from public.meta_launch_canary_approvals
        where plan_id = v_plan_id) <> 1
    or (select status from public.mutation_plans where id = v_plan_id) <> 'PENDING'
    or (select max_attempts from public.mutation_plans where id = v_plan_id) <> 1
    or (select not_before from public.mutation_plans where id = v_plan_id)
       = 'infinity'::timestamptz
    or (select mode from public.kill_switch_state
        where scope_type = 'ACCOUNT'
          and user_id = '12000000-0000-4000-8000-000000000001'
          and platform_account_id = '22000000-0000-4000-8000-000000000001'
        order by sequence desc limit 1) <> 'ALLOW'
    or (select mode from public.kill_switch_state
        where scope_type = 'PLAN' and plan_id = v_plan_id
        order by sequence desc limit 1) <> 'ALLOW' then
    raise exception 'Exact launch approval did not atomically open one plan';
  end if;
end;
$$;

create temporary table launch_claim on commit drop as
select * from public.claim_next_meta_mutation_execution(
  'launch-executor-worker', 900
);

create temporary table launch_preflight_diag on commit drop as
select
  public.meta_launch_canary_preflight_ok(plan.id) as preflight_ok,
  plan.status as plan_status,
  plan.attempt_count,
  plan.max_attempts,
  public.meta_sha256(plan.planned_payload::text) = plan.payload_hash as payload_hash_ok,
  (select mode from public.get_effective_meta_kill_switch(
     plan.user_id, plan.platform_account_id, plan.id
   )) as effective_mode,
  exists (
    select 1 from public.platform_accounts account
    where account.id = plan.platform_account_id
      and account.marketing_sync_id = plan.source_marketing_sync_id
      and account.marketing_sync_status = 'success'
      and account.marketing_last_success_at >= now() - interval '2 hours'
  ) as account_ok,
  exists (
    select 1 from public.automation_policies policy
    where policy.id = plan.policy_id
      and policy.is_current and policy.status = 'ACTIVE'
      and policy.allow_new_launches and policy.allow_status_changes
      and policy.policy_hash = plan.expected_before->>'policy_hash'
  ) as policy_ok,
  exists (
    select 1 from public.meta_launch_canary_approvals approval
    where approval.plan_id = plan.id
      and approval.payload_hash = plan.payload_hash
      and approval.target_status = plan.intended_after->>'status'
  ) as approval_ok,
  exists (
    select 1 from public.daily_budget_exposure_snapshots snapshot
    where snapshot.id = (plan.expected_before->>'exposure_snapshot_id')::uuid
      and snapshot.source_marketing_sync_id = plan.source_marketing_sync_id
      and snapshot.status = 'COMPLETE' and snapshot.currency = 'EUR'
  ) as snapshot_ok,
  exists (
    select 1 from public.daily_budget_exposures exposure
    where exposure.plan_id = plan.id
      and exposure.snapshot_id = (plan.expected_before->>'exposure_snapshot_id')::uuid
      and exposure.source in ('PLAN', 'RECONCILIATION')
      and exposure.budget_owner_type = plan.planned_payload->>'budget_owner_type'
      and exposure.max_daily_budget_minor
          = (plan.planned_payload->>'daily_budget_minor')::bigint
  ) as exposure_ok,
  not exists (
    select 1 from public.mutation_plan_steps step
    where step.plan_id = plan.id
      and (
        public.meta_sha256(step.planned_request::text) <> step.request_hash
        or step.dispatch_state = 'REMOTE_UNKNOWN'
        or step.status in ('COMPENSATION_REQUIRED', 'FAILED')
      )
  ) as steps_ok
from public.mutation_plans plan
where plan.id = (select plan_id from launch_ids);

do $$
declare
  v_diag jsonb := (select to_jsonb(diag) from launch_preflight_diag diag);
begin
  if coalesce((v_diag->>'preflight_ok')::boolean, false) is not true then
    raise exception 'Launch preflight changed after claim: %', v_diag;
  end if;
end;
$$;

create temporary table launch_reconcile_result (
  outcome text,
  plan_id uuid,
  ledger_id uuid,
  snapshot_id uuid
) on commit drop;

do $$
declare
  v_execution_id uuid := (select execution_id from launch_claim);
  v_lease_token uuid := (select lease_token from launch_claim);
  v_expected_plan_id uuid := (select plan_id from launch_ids);
  v_step_id uuid := (select first_step_id from launch_claim);
  v_operation text := (select first_step_operation from launch_claim);
  v_object_type text := (select first_step_object_type from launch_claim);
  v_step_key text;
  v_remote_id text;
  v_snapshot jsonb;
  v_iterations integer := 0;
begin
  if (select plan_id from launch_claim) is distinct from v_expected_plan_id then
    raise exception 'Launch plan was not claimed by the executor';
  end if;

  loop
    v_iterations := v_iterations + 1;
    if v_iterations > 25 then
      raise exception 'Launch executor loop did not terminate';
    end if;

    select step_key into v_step_key
    from public.mutation_plan_steps
    where id = v_step_id and plan_id = v_expected_plan_id;

    if v_operation = 'RECONCILE' then
      insert into launch_reconcile_result
      select * from public.reconcile_meta_mutation_plan(
        v_execution_id, v_step_id, v_lease_token
      );
      exit;
    elsif v_operation = 'READ' then
      v_remote_id := case v_object_type
        when 'CAMPAIGN' then '333333333301'
        when 'AD_SET' then '333333333302'
        when 'CREATIVE' then '333333333303'
        when 'AD' then '333333333304'
        else null
      end;

      v_snapshot := case v_object_type
        when 'CAMPAIGN' then jsonb_build_object(
          'id', v_remote_id,
          'account_id', '111111111111',
          'name', 'Launch Regression Campaign',
          'objective', 'OUTCOME_SALES',
          'status', case when v_step_key = 'read-campaign-paused'
                         then 'PAUSED' else 'ACTIVE' end,
          'effective_status', case when v_step_key = 'read-campaign-paused'
                                   then 'PAUSED' else 'ACTIVE' end,
          'buying_type', 'AUCTION',
          'special_ad_categories', '[]'::jsonb,
          'updated_time', '2026-07-29T12:00:00+0000'
        )
        when 'AD_SET' then jsonb_build_object(
          'id', v_remote_id,
          'account_id', '111111111111',
          'campaign_id', '333333333301',
          'name', 'Launch Regression Ad Set',
          'status', case when v_step_key = 'read-ad-set-paused'
                         then 'PAUSED' else 'ACTIVE' end,
          'effective_status', case when v_step_key = 'read-ad-set-paused'
                                   then 'PAUSED' else 'ACTIVE' end,
          'daily_budget', '3000',
          'billing_event', 'IMPRESSIONS',
          'optimization_goal', 'OFFSITE_CONVERSIONS',
          'targeting', jsonb_build_object(
            'geo_locations', jsonb_build_object(
              'countries', jsonb_build_array('DE')
            )
          ),
          'updated_time', '2026-07-29T12:00:01+0000'
        )
        when 'CREATIVE' then jsonb_build_object(
          'id', v_remote_id,
          'account_id', '111111111111',
          'name', 'Launch Regression Creative',
          'object_type', 'IMAGE',
          'object_story_id', '333333333390_333333333399',
          'image_hash', repeat('a', 32),
          'object_story_spec', jsonb_build_object(
            'page_id', '333333333390'
          ),
          'updated_time', '2026-07-29T12:00:02+0000'
        )
        when 'AD' then jsonb_build_object(
          'id', v_remote_id,
          'account_id', '111111111111',
          'campaign_id', '333333333301',
          'adset_id', '333333333302',
          'name', 'Launch Regression Ad',
          'status', case when v_step_key = 'read-ad-paused'
                         then 'PAUSED' else 'ACTIVE' end,
          'effective_status', case when v_step_key = 'read-ad-paused'
                                   then 'PAUSED' else 'ACTIVE' end,
          'creative', jsonb_build_object('id', '333333333303'),
          'conversion_domain', 'example.test',
          'updated_time', '2026-07-29T12:00:03+0000'
        )
        else null
      end;

      perform public.record_meta_mutation_remote_snapshot(
        v_execution_id, v_step_id, v_lease_token,
        'READ_AFTER_WRITE', v_remote_id, v_snapshot,
        public.meta_sha256('launch-read-response|' || v_step_id::text),
        'launch-read-' || v_step_key
      );
    else
      if not public.meta_launch_canary_preflight_ok(v_expected_plan_id) then
        raise exception 'Launch preflight drift at step %: %',
          v_step_key,
          jsonb_build_object(
            'plan_status', (select status from public.mutation_plans where id = v_expected_plan_id),
            'attempt_count', (select attempt_count from public.mutation_plans where id = v_expected_plan_id),
            'effective_mode', (
              select mode from public.get_effective_meta_kill_switch(
                '12000000-0000-4000-8000-000000000001',
                '22000000-0000-4000-8000-000000000001',
                v_expected_plan_id
              )
            ),
            'latest_account_gate', (
              select jsonb_build_object(
                'mode', state.mode,
                'reason', state.reason,
                'actor_type', state.actor_type,
                'actor_id', state.actor_id,
                'sequence', state.sequence
              )
              from public.kill_switch_state state
              where state.scope_type = 'ACCOUNT'
                and state.user_id = '12000000-0000-4000-8000-000000000001'
                and state.platform_account_id = '22000000-0000-4000-8000-000000000001'
              order by state.sequence desc limit 1
            ),
            'latest_plan_gate', (
              select jsonb_build_object(
                'mode', state.mode,
                'reason', state.reason,
                'actor_type', state.actor_type,
                'actor_id', state.actor_id,
                'sequence', state.sequence
              )
              from public.kill_switch_state state
              where state.scope_type = 'PLAN'
                and state.plan_id = v_expected_plan_id
              order by state.sequence desc limit 1
            ),
            'account_sync_status', (
              select marketing_sync_status from public.platform_accounts
              where id = '22000000-0000-4000-8000-000000000001'
            ),
            'approval_count', (
              select count(*) from public.meta_launch_canary_approvals
              where plan_id = v_expected_plan_id
            ),
            'exposure_count', (
              select count(*) from public.daily_budget_exposures
              where plan_id = v_expected_plan_id
                and source in ('PLAN', 'RECONCILIATION')
            ),
            'bad_step_count', (
              select count(*) from public.mutation_plan_steps
              where plan_id = v_expected_plan_id
                and (
                  public.meta_sha256(planned_request::text) <> request_hash
                  or dispatch_state = 'REMOTE_UNKNOWN'
                  or status in ('COMPENSATION_REQUIRED', 'FAILED')
                )
            )
          );
      end if;

      perform public.begin_meta_mutation_step_dispatch(
        v_execution_id, v_step_id, v_lease_token
      );

      v_remote_id := case
        when v_operation <> 'CREATE' then null
        when v_object_type = 'CAMPAIGN' then '333333333301'
        when v_object_type = 'AD_SET' then '333333333302'
        when v_object_type = 'CREATIVE' then '333333333303'
        when v_object_type = 'IMAGE' then repeat('a', 32)
        when v_object_type = 'AD' then '333333333304'
        else null
      end;

      perform public.complete_meta_mutation_remote_step(
        v_execution_id, v_step_id, v_lease_token,
        public.meta_sha256('launch-request|' || v_step_id::text),
        public.meta_sha256('launch-response|' || v_step_id::text),
        v_remote_id,
        'launch-remote-' || v_step_key,
        v_operation = 'VALIDATE',
        '{"account_util_pct":1}'::jsonb
      );
    end if;

    select claimed.step_id, claimed.operation, claimed.object_type
      into v_step_id, v_operation, v_object_type
    from public.claim_next_meta_mutation_step(
      v_execution_id, v_lease_token
    ) claimed;

    if not found then
      raise exception 'Launch saga ended before reconciliation';
    end if;
  end loop;
end;
$$;

do $$
declare
  v_plan_id uuid := (select plan_id from launch_ids);
  v_campaign_id uuid;
  v_ad_group_id uuid;
  v_creative_id uuid;
  v_ad_id uuid;
  v_exposure public.daily_budget_exposures%rowtype;
begin
  select id into v_campaign_id from public.campaigns
  where platform_account_id = '22000000-0000-4000-8000-000000000001'
    and platform_campaign_id = '333333333301';
  select id into v_ad_group_id from public.ad_groups
  where platform_account_id = '22000000-0000-4000-8000-000000000001'
    and platform_ad_group_id = '333333333302';
  select id into v_creative_id from public.creatives
  where platform_account_id = '22000000-0000-4000-8000-000000000001'
    and platform_creative_id = '333333333303'
    and source = 'meta';
  select id into v_ad_id from public.ads
  where platform_account_id = '22000000-0000-4000-8000-000000000001'
    and platform_ad_id = '333333333304';
  select exposure.* into v_exposure
  from public.daily_budget_exposures exposure
  where exposure.plan_id = v_plan_id;

  if (select outcome from launch_reconcile_result) <> 'SUCCEEDED'
    or (select status from public.mutation_plans where id = v_plan_id)
       <> 'SUCCEEDED'
    or (select count(*) from public.mutation_plan_steps
        where plan_id = v_plan_id) <> 21
    or exists (
      select 1 from public.mutation_plan_steps
      where plan_id = v_plan_id
        and status not in ('VALIDATED', 'REMOTE_APPLIED', 'RECONCILED')
    )
    or v_campaign_id is null
    or v_ad_group_id is null
    or v_creative_id is null
    or v_ad_id is null
    or (select status from public.campaigns where id = v_campaign_id) <> 'ACTIVE'
    or (select daily_budget_minor from public.campaigns
        where id = v_campaign_id) is not null
    or (select campaign_id from public.ad_groups where id = v_ad_group_id)
       <> v_campaign_id
    or (select daily_budget_minor from public.ad_groups
        where id = v_ad_group_id) <> 3000
    or (select creative_id from public.ads where id = v_ad_id) <> v_creative_id
    or (select ad_group_id from public.ads where id = v_ad_id) <> v_ad_group_id
    or (select count(*) from public.automation_targets
        where platform_account_id = '22000000-0000-4000-8000-000000000001'
          and platform_object_id in (
            '333333333301', '333333333302', '333333333304'
          ) and status = 'MANAGED') <> 3
    or (select count(*) from public.remote_object_bindings
        where plan_id = v_plan_id and reconciled_at is not null) <> 5
    or exists (
      select 1 from public.remote_object_bindings
      where plan_id = v_plan_id and object_type = 'CAMPAIGN'
        and local_campaign_id is distinct from v_campaign_id
    )
    or exists (
      select 1 from public.remote_object_bindings
      where plan_id = v_plan_id and object_type = 'AD_SET'
        and (
          local_campaign_id is distinct from v_campaign_id
          or local_ad_group_id is distinct from v_ad_group_id
        )
    )
    or exists (
      select 1 from public.remote_object_bindings
      where plan_id = v_plan_id and object_type = 'CREATIVE'
        and local_creative_id is distinct from v_creative_id
    )
    or exists (
      select 1 from public.remote_object_bindings
      where plan_id = v_plan_id and object_type = 'AD'
        and (
          local_campaign_id is distinct from v_campaign_id
          or local_ad_group_id is distinct from v_ad_group_id
          or local_creative_id is distinct from v_creative_id
          or local_ad_id is distinct from v_ad_id
        )
    )
    or v_exposure.id is null
    or v_exposure.source <> 'RECONCILIATION'
    or v_exposure.campaign_scope_key <> 'campaign:333333333301'
    or v_exposure.budget_owner_key <> 'adset:333333333302'
    or v_exposure.automation_target_id is null
    or (select count(*) from public.daily_budget_exposures
        where plan_id = v_plan_id) <> 1
    or exists (
      select 1 from public.daily_budget_exposures
      where plan_id = v_plan_id
        and budget_owner_key like 'launch:%'
    )
    or exists (
      select 1 from public.meta_account_operation_leases
      where platform_account_id = '22000000-0000-4000-8000-000000000001'
        and lease_token is not null
    )
    or (select count(*) from public.mutation_executions
        where plan_id = v_plan_id) <> 1
    or (select count(*) from public.meta_launch_canary_approvals
        where plan_id = v_plan_id) <> 1
    or (select mode from public.kill_switch_state
        where scope_type = 'ACCOUNT'
          and user_id = '12000000-0000-4000-8000-000000000001'
          and platform_account_id = '22000000-0000-4000-8000-000000000001'
        order by sequence desc limit 1) <> 'FREEZE_WRITES'
    or (select mode from public.kill_switch_state
        where scope_type = 'PLAN' and plan_id = v_plan_id
        order by sequence desc limit 1) <> 'FREEZE_WRITES' then
    raise exception 'Launch reconciliation projection, one-shot execution or refreeze failed';
  end if;
end;
$$;

-- Lifetime-v3 Active Launch Chain: EUR 15.00 over exactly seven days.
-- This fixture owns its asset and proves independent account-cap headroom before
-- creating the conservative 1:1 lifetime exposure reservation.
insert into public.brand_assets (
  id, user_id, platform_account_id, brand_profile_id, source_type,
  storage_bucket, storage_path, original_filename, sha256, mime_type,
  byte_size, width, height, brand_policy_version, moderation_status,
  status, metadata, reviewed_at, reviewed_by
) values (
  '93000000-0000-4000-8000-000000000002',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'UPLOADED', 'creative-assets',
  '12000000-0000-4000-8000-000000000001/22000000-0000-4000-8000-000000000001/99/'
    || repeat('9', 64) || '.png',
  'lifetime-v3-regression.png', repeat('9', 64), 'image/png',
  2048, 1200, 1200, 1, 'APPROVED', 'READY',
  '{"purpose":"lifetime_v3_launch_regression"}'::jsonb, now(),
  '12000000-0000-4000-8000-000000000001'
);

create temporary table lifetime_v3_contract (
  start_time timestamptz not null,
  end_time timestamptz not null,
  materialized jsonb,
  replayed jsonb
) on commit drop;

insert into lifetime_v3_contract (start_time, end_time)
select fixture_start, fixture_start + interval '7 days'
from (
  select date_trunc('second', now()) + interval '10 minutes' as fixture_start
) fixture;

create temporary table lifetime_v3_read_lease (
  lease_token uuid not null
) on commit drop;

insert into lifetime_v3_read_lease
select public.claim_meta_account_operation(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'READ_SYNC', 'lifetime-v3-materializer-regression', 900
);

do $$
declare
  v_reserved_before bigint;
  v_existing_lifetime bigint;
  v_required_cap bigint;
  v_policy_payload jsonb;
begin
  select coalesce(sum(exposure.reserved_exposure_minor), 0)::bigint
    into v_reserved_before
  from public.daily_budget_exposures exposure
  where exposure.platform_account_id = '22000000-0000-4000-8000-000000000001'
    and exposure.account_day = (
      now() at time zone (
        select marketing_timezone_name
        from public.platform_accounts
        where id = '22000000-0000-4000-8000-000000000001'
      )
    )::date;

  v_existing_lifetime := public.meta_active_lifetime_budget_exposure_minor(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001',
    now()
  );
  v_required_cap := v_reserved_before + v_existing_lifetime + 1500 + 875;
  v_policy_payload := jsonb_build_object(
    'campaign_objectives', 'ALL',
    'regions', 'ALL',
    'domains', 'ALL',
    'fixture', 'lifetime_v3',
    'reserved_before_minor', v_reserved_before,
    'existing_lifetime_minor', v_existing_lifetime,
    'dedicated_lifetime_headroom_minor', 1500,
    'followup_daily_headroom_minor', 875
  );

  update public.automation_policies
  set status = 'SUSPENDED',
      is_current = false,
      suspended_at = now(),
      suspension_reason = 'Superseded by lifetime-v3 regression policy',
      updated_at = now()
  where id = '82000000-0000-4000-8000-000000000001'
    and is_current
    and status = 'ACTIVE';

  if not found then
    raise exception 'Lifetime-v3 fixture could not supersede policy version 1';
  end if;

  insert into public.automation_policies (
    id, user_id, platform_account_id, previous_policy_id, version,
    status, currency, account_daily_hard_cap_minor,
    default_campaign_daily_hard_cap_minor, budget_change_limit_bps,
    cooldown_seconds, standard_flex_spend_multiplier_bps,
    shared_budget_flex_spend_multiplier_bps, allow_budget_changes,
    allow_status_changes, allow_new_launches, require_verified_domain,
    policy_payload, policy_hash, is_current, customer_confirmed_at,
    customer_confirmed_by, activated_at
  ) values (
    '82000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    2, 'ACTIVE', 'EUR', v_required_cap, 6000, 2000, 43200,
    17500, 21000, true, true, true, true,
    v_policy_payload, public.meta_sha256(v_policy_payload::text), true,
    now(), '12000000-0000-4000-8000-000000000001', now()
  );

  update public.daily_budget_exposure_snapshots
  set policy_id = '82000000-0000-4000-8000-000000000003',
      updated_at = now()
  where id = (select snapshot_id from executor_planner_result)
    and status = 'COMPLETE';

  if not found
    or (select account_daily_hard_cap_minor
        from public.automation_policies
        where id = '82000000-0000-4000-8000-000000000003')
       - v_reserved_before - v_existing_lifetime <> 2375
    or (select policy_id from public.daily_budget_exposure_snapshots
        where id = (select snapshot_id from executor_planner_result))
       <> '82000000-0000-4000-8000-000000000003'::uuid then
    raise exception 'Lifetime-v3 fixture did not isolate its 1500-unit reservation and 875-unit follow-up Daily headroom';
  end if;
end;
$$;

update lifetime_v3_contract fixture
set materialized = public.materialize_meta_customer_lifetime_launch_plan_v3(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  (select lease_token from lifetime_v3_read_lease),
  '92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  'CAMPAIGN',
  1500,
  fixture.start_time,
  fixture.end_time,
  jsonb_build_object(
    'destination_url',
      'https://shop.launch.example.test/products/lifetime-v3',
    'campaign_name', 'Lifetime v3 Regression Campaign',
    'ad_set_name', 'Lifetime v3 Regression Ad Set',
    'creative_name', 'Lifetime v3 Regression Creative',
    'ad_name', 'Lifetime v3 Regression Ad'
  ),
  now()
);

update lifetime_v3_contract fixture
set replayed = public.materialize_meta_customer_lifetime_launch_plan_v3(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  (select lease_token from lifetime_v3_read_lease),
  '92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  'CAMPAIGN',
  1500,
  fixture.start_time,
  fixture.end_time,
  jsonb_build_object(
    'destination_url',
      'https://shop.launch.example.test/products/lifetime-v3',
    'campaign_name', 'Lifetime v3 Regression Campaign',
    'ad_set_name', 'Lifetime v3 Regression Ad Set',
    'creative_name', 'Lifetime v3 Regression Creative',
    'ad_name', 'Lifetime v3 Regression Ad'
  ),
  now()
);

select public.release_meta_account_operation(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  (select lease_token from lifetime_v3_read_lease)
);

create temporary table lifetime_v3_ids on commit drop as
select (materialized->>'plan_id')::uuid as plan_id
from lifetime_v3_contract;

do $$
declare
  v_plan_id uuid := (select plan_id from lifetime_v3_ids);
  v_plan public.mutation_plans%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
  v_start timestamptz := (select start_time from lifetime_v3_contract);
  v_end timestamptz := (select end_time from lifetime_v3_contract);
  v_step_keys text[];
begin
  select plan.* into v_plan
  from public.mutation_plans plan
  where plan.id = v_plan_id;

  select exposure.* into v_exposure
  from public.daily_budget_exposures exposure
  where exposure.plan_id = v_plan_id;

  select array_agg(step_key order by step_index) into v_step_keys
  from public.mutation_plan_steps
  where plan_id = v_plan_id;

  if (select materialized->>'outcome' from lifetime_v3_contract) <> 'CREATED'
    or (select materialized->>'status' from lifetime_v3_contract) <> 'HELD'
    or (select replayed->>'outcome' from lifetime_v3_contract) <> 'EXISTING'
    or (select replayed->>'status' from lifetime_v3_contract) <> 'HELD'
    or (select replayed->>'plan_id' from lifetime_v3_contract)
       <> (select materialized->>'plan_id' from lifetime_v3_contract)
    or (select materialized->>'budget_type' from lifetime_v3_contract) <> 'LIFETIME'
    or (select materialized->>'budget_owner_type' from lifetime_v3_contract) <> 'CAMPAIGN'
    or (select (materialized->>'lifetime_budget_minor')::bigint
        from lifetime_v3_contract) <> 1500
    or (select materialized ? 'daily_budget_minor'
        from lifetime_v3_contract)
    or v_end <> v_start + interval '7 days'
    or v_plan.status <> 'PENDING'
    or v_plan.not_before <> 'infinity'::timestamptz
    or v_plan.max_attempts <> 1
    or (v_plan.planned_payload->>'contract_version')::integer <> 3
    or v_plan.planned_payload->>'budget_type' <> 'LIFETIME'
    or v_plan.planned_payload->>'budget_owner_type' <> 'CAMPAIGN'
    or (v_plan.planned_payload->>'lifetime_budget_minor')::bigint <> 1500
    or (v_plan.planned_payload->>'start_time')::timestamptz <> v_start
    or (v_plan.planned_payload->>'end_time')::timestamptz <> v_end
    or (v_plan.planned_payload#>>'{campaign,lifetime_budget}')::bigint <> 1500
    or v_plan.planned_payload#>>'{campaign,daily_budget}' is not null
    or v_plan.planned_payload#>>'{ad_set,daily_budget}' is not null
    or v_plan.planned_payload#>>'{ad_set,lifetime_budget}' is not null
    or (v_plan.planned_payload#>>'{ad_set,start_time}')::timestamptz <> v_start
    or (v_plan.planned_payload#>>'{ad_set,end_time}')::timestamptz <> v_end
    or v_exposure.id is null
    or v_exposure.source <> 'PLAN'
    or v_exposure.max_daily_budget_minor <> 1500
    or v_exposure.flex_spend_multiplier_bps <> 10000
    or v_exposure.budget_owner_type <> 'CAMPAIGN'
    or v_exposure.automation_target_id is not null
    or v_step_keys <> array[
      'validate-campaign', 'create-campaign-paused',
      'read-campaign-paused', 'validate-ad-set',
      'create-ad-set-paused', 'read-ad-set-paused', 'upload-image',
      'validate-creative', 'create-creative', 'read-creative',
      'validate-ad-paused', 'create-ad-paused', 'read-ad-paused',
      'activate-ad-set', 'read-ad-set-active', 'activate-campaign',
      'activate-ad', 'read-campaign-active', 'read-ad-active',
      'read-ad-set-active-final', 'reconcile-launch-chain'
    ]::text[]
    or (select planned_request#>>'{payload,lifetime_budget}'
        from public.mutation_plan_steps
        where plan_id = v_plan_id and step_key = 'create-campaign-paused') <> '1500'
    or (select planned_request#>>'{payload,daily_budget}'
        from public.mutation_plan_steps
        where plan_id = v_plan_id and step_key = 'create-campaign-paused') is not null
    or (select planned_request#>>'{payload,start_time}'
        from public.mutation_plan_steps
        where plan_id = v_plan_id and step_key = 'create-ad-set-paused')::timestamptz <> v_start
    or (select planned_request#>>'{payload,end_time}'
        from public.mutation_plan_steps
        where plan_id = v_plan_id and step_key = 'create-ad-set-paused')::timestamptz <> v_end
    or exists (
      select 1 from public.mutation_plan_steps
      where plan_id = v_plan_id
        and public.meta_jsonb_has_sensitive_key(planned_request)
    ) then
    raise exception 'Lifetime-v3 materialization, replay, payload, steps, or reservation is incorrect';
  end if;
end;
$$;

-- Any lifetime or time drift must fail closed without opening gates or writing approval.
do $$
declare
  v_failed boolean := false;
  v_materialized jsonb := (select materialized from lifetime_v3_contract);
  v_plan_id uuid := (select plan_id from lifetime_v3_ids);
  v_start timestamptz := (select start_time from lifetime_v3_contract);
  v_end timestamptz := (select end_time from lifetime_v3_contract);
begin
  begin
    perform public.approve_meta_lifetime_launch_canary_plan_v3(
      '12000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      v_plan_id,
      v_materialized->>'payload_hash',
      v_materialized->>'objective',
      v_materialized->>'destination_url',
      v_materialized->>'budget_owner_type',
      1500,
      v_start,
      v_end + interval '1 second',
      v_materialized->>'campaign_name',
      v_materialized->>'ad_set_name',
      v_materialized->>'creative_name',
      v_materialized->>'ad_name',
      'ACTIVE',
      'Negative lifetime end-time fingerprint regression.'
    );
  exception when others then
    v_failed := true;
  end;

  if not v_failed
    or (select count(*) from public.meta_launch_canary_approvals
        where plan_id = v_plan_id) <> 0
    or (select not_before from public.mutation_plans where id = v_plan_id)
       <> 'infinity'::timestamptz
    or (select mode from public.kill_switch_state
        where scope_type = 'PLAN' and plan_id = v_plan_id
        order by sequence desc limit 1) <> 'FREEZE_WRITES' then
    raise exception 'Lifetime-v3 approval drift did not remain fail-closed';
  end if;
end;
$$;

create temporary table lifetime_v3_approval on commit drop as
select * from public.approve_meta_lifetime_launch_canary_plan_v3(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  (select plan_id from lifetime_v3_ids),
  (select materialized->>'payload_hash' from lifetime_v3_contract),
  (select materialized->>'objective' from lifetime_v3_contract),
  (select materialized->>'destination_url' from lifetime_v3_contract),
  'CAMPAIGN',
  1500,
  (select start_time from lifetime_v3_contract),
  (select end_time from lifetime_v3_contract),
  (select materialized->>'campaign_name' from lifetime_v3_contract),
  (select materialized->>'ad_set_name' from lifetime_v3_contract),
  (select materialized->>'creative_name' from lifetime_v3_contract),
  (select materialized->>'ad_name' from lifetime_v3_contract),
  'ACTIVE',
  'Exact lifetime-v3 launch regression approval.'
);

create temporary table lifetime_v3_approval_replayed on commit drop as
select * from public.approve_meta_lifetime_launch_canary_plan_v3(
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  (select plan_id from lifetime_v3_ids),
  (select materialized->>'payload_hash' from lifetime_v3_contract),
  (select materialized->>'objective' from lifetime_v3_contract),
  (select materialized->>'destination_url' from lifetime_v3_contract),
  'CAMPAIGN',
  1500,
  (select start_time from lifetime_v3_contract),
  (select end_time from lifetime_v3_contract),
  (select materialized->>'campaign_name' from lifetime_v3_contract),
  (select materialized->>'ad_set_name' from lifetime_v3_contract),
  (select materialized->>'creative_name' from lifetime_v3_contract),
  (select materialized->>'ad_name' from lifetime_v3_contract),
  'ACTIVE',
  'Exact lifetime-v3 launch regression approval.'
);

do $$
declare
  v_plan_id uuid := (select plan_id from lifetime_v3_ids);
  v_approval public.meta_launch_canary_approvals%rowtype;
begin
  select approval.* into v_approval
  from public.meta_launch_canary_approvals approval
  where approval.plan_id = v_plan_id;

  if (select plan_status from lifetime_v3_approval) <> 'PENDING'
    or (select approval_id from lifetime_v3_approval_replayed)
       <> (select approval_id from lifetime_v3_approval)
    or v_approval.id is null
    or v_approval.budget_type <> 'LIFETIME'
    or v_approval.budget_owner_type <> 'CAMPAIGN'
    or v_approval.daily_budget_minor is not null
    or v_approval.lifetime_budget_minor <> 1500
    or v_approval.start_time <> (select start_time from lifetime_v3_contract)
    or v_approval.end_time <> (select end_time from lifetime_v3_contract)
    or not public.meta_launch_canary_preflight_ok(v_plan_id)
    or (select not_before from public.mutation_plans where id = v_plan_id)
       = 'infinity'::timestamptz
    or (select mode from public.kill_switch_state
        where scope_type = 'ACCOUNT'
          and user_id = '12000000-0000-4000-8000-000000000001'
          and platform_account_id = '22000000-0000-4000-8000-000000000001'
        order by sequence desc limit 1) <> 'ALLOW'
    or (select mode from public.kill_switch_state
        where scope_type = 'PLAN' and plan_id = v_plan_id
        order by sequence desc limit 1) <> 'ALLOW' then
    raise exception 'Lifetime-v3 exact approval did not atomically open the plan';
  end if;
end;
$$;

create temporary table lifetime_v3_claim on commit drop as
select * from public.claim_next_meta_mutation_execution(
  'lifetime-v3-executor-worker', 900
);

create temporary table lifetime_v3_reconcile_result (
  outcome text,
  plan_id uuid,
  ledger_id uuid,
  snapshot_id uuid
) on commit drop;

do $$
declare
  v_execution_id uuid := (select execution_id from lifetime_v3_claim);
  v_lease_token uuid := (select lease_token from lifetime_v3_claim);
  v_expected_plan_id uuid := (select plan_id from lifetime_v3_ids);
  v_step_id uuid := (select first_step_id from lifetime_v3_claim);
  v_operation text := (select first_step_operation from lifetime_v3_claim);
  v_object_type text := (select first_step_object_type from lifetime_v3_claim);
  v_step_key text;
  v_remote_id text;
  v_snapshot jsonb;
  v_start timestamptz := (select start_time from lifetime_v3_contract);
  v_end timestamptz := (select end_time from lifetime_v3_contract);
  v_iterations integer := 0;
begin
  if (select plan_id from lifetime_v3_claim) is distinct from v_expected_plan_id then
    raise exception 'Lifetime-v3 plan was not claimed by the executor';
  end if;

  loop
    v_iterations := v_iterations + 1;
    if v_iterations > 25 then
      raise exception 'Lifetime-v3 executor loop did not terminate';
    end if;

    select step_key into v_step_key
    from public.mutation_plan_steps
    where id = v_step_id and plan_id = v_expected_plan_id;

    if v_operation = 'RECONCILE' then
      insert into lifetime_v3_reconcile_result
      select * from public.reconcile_meta_mutation_plan(
        v_execution_id, v_step_id, v_lease_token
      );
      exit;
    elsif v_operation = 'READ' then
      v_remote_id := case v_object_type
        when 'CAMPAIGN' then '444444444401'
        when 'AD_SET' then '444444444402'
        when 'CREATIVE' then '444444444403'
        when 'AD' then '444444444404'
        else null
      end;

      v_snapshot := case v_object_type
        when 'CAMPAIGN' then jsonb_build_object(
          'id', v_remote_id,
          'account_id', '111111111111',
          'name', 'Lifetime v3 Regression Campaign',
          'objective', 'OUTCOME_SALES',
          'status', case when v_step_key = 'read-campaign-paused'
                         then 'PAUSED' else 'ACTIVE' end,
          'effective_status', case when v_step_key = 'read-campaign-paused'
                                   then 'PAUSED' else 'ACTIVE' end,
          'daily_budget', null,
          'lifetime_budget', '1500',
          'buying_type', 'AUCTION',
          'special_ad_categories', '[]'::jsonb,
          'updated_time', '2026-08-02T12:00:00+0000'
        )
        when 'AD_SET' then jsonb_build_object(
          'id', v_remote_id,
          'account_id', '111111111111',
          'campaign_id', '444444444401',
          'name', 'Lifetime v3 Regression Ad Set',
          'status', case when v_step_key = 'read-ad-set-paused'
                         then 'PAUSED' else 'ACTIVE' end,
          'effective_status', case when v_step_key = 'read-ad-set-paused'
                                   then 'PAUSED' else 'ACTIVE' end,
          'daily_budget', null,
          'lifetime_budget', null,
          'start_time', v_start,
          'end_time', v_end,
          'billing_event', 'IMPRESSIONS',
          'optimization_goal', 'OFFSITE_CONVERSIONS',
          'targeting', jsonb_build_object(
            'geo_locations', jsonb_build_object(
              'countries', jsonb_build_array('DE')
            )
          ),
          'updated_time', '2026-08-02T12:00:01+0000'
        )
        when 'CREATIVE' then jsonb_build_object(
          'id', v_remote_id,
          'account_id', '111111111111',
          'name', 'Lifetime v3 Regression Creative',
          'object_type', 'IMAGE',
          'object_story_id', '333333333390_444444444499',
          'image_hash', repeat('b', 32),
          'object_story_spec', jsonb_build_object(
            'page_id', '333333333390'
          ),
          'updated_time', '2026-08-02T12:00:02+0000'
        )
        when 'AD' then jsonb_build_object(
          'id', v_remote_id,
          'account_id', '111111111111',
          'campaign_id', '444444444401',
          'adset_id', '444444444402',
          'name', 'Lifetime v3 Regression Ad',
          'status', case when v_step_key = 'read-ad-paused'
                         then 'PAUSED' else 'ACTIVE' end,
          'effective_status', case when v_step_key = 'read-ad-paused'
                                   then 'PAUSED' else 'ACTIVE' end,
          'creative', jsonb_build_object('id', '444444444403'),
          'conversion_domain', 'example.test',
          'updated_time', '2026-08-02T12:00:03+0000'
        )
        else null
      end;

      perform public.record_meta_mutation_remote_snapshot(
        v_execution_id, v_step_id, v_lease_token,
        'READ_AFTER_WRITE', v_remote_id, v_snapshot,
        public.meta_sha256('lifetime-v3-read-response|' || v_step_id::text),
        'lifetime-v3-read-' || v_step_key
      );
    else
      if not public.meta_launch_canary_preflight_ok(v_expected_plan_id) then
        raise exception 'Lifetime-v3 launch preflight drift at step %', v_step_key;
      end if;

      perform public.begin_meta_mutation_step_dispatch(
        v_execution_id, v_step_id, v_lease_token
      );

      v_remote_id := case
        when v_operation <> 'CREATE' then null
        when v_object_type = 'CAMPAIGN' then '444444444401'
        when v_object_type = 'AD_SET' then '444444444402'
        when v_object_type = 'CREATIVE' then '444444444403'
        when v_object_type = 'IMAGE' then repeat('b', 32)
        when v_object_type = 'AD' then '444444444404'
        else null
      end;

      perform public.complete_meta_mutation_remote_step(
        v_execution_id, v_step_id, v_lease_token,
        public.meta_sha256('lifetime-v3-request|' || v_step_id::text),
        public.meta_sha256('lifetime-v3-response|' || v_step_id::text),
        v_remote_id,
        'lifetime-v3-remote-' || v_step_key,
        v_operation = 'VALIDATE',
        '{"account_util_pct":1}'::jsonb
      );
    end if;

    select claimed.step_id, claimed.operation, claimed.object_type
      into v_step_id, v_operation, v_object_type
    from public.claim_next_meta_mutation_step(
      v_execution_id, v_lease_token
    ) claimed;

    if not found then
      raise exception 'Lifetime-v3 saga ended before reconciliation';
    end if;
  end loop;
end;
$$;

do $$
declare
  v_plan_id uuid := (select plan_id from lifetime_v3_ids);
  v_start timestamptz := (select start_time from lifetime_v3_contract);
  v_end timestamptz := (select end_time from lifetime_v3_contract);
  v_campaign public.campaigns%rowtype;
  v_ad_set public.ad_groups%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
begin
  select campaign.* into v_campaign
  from public.campaigns campaign
  where campaign.platform_account_id = '22000000-0000-4000-8000-000000000001'
    and campaign.platform_campaign_id = '444444444401';

  select ad_set.* into v_ad_set
  from public.ad_groups ad_set
  where ad_set.platform_account_id = '22000000-0000-4000-8000-000000000001'
    and ad_set.platform_ad_group_id = '444444444402';

  select exposure.* into v_exposure
  from public.daily_budget_exposures exposure
  where exposure.plan_id = v_plan_id;

  if (select outcome from lifetime_v3_reconcile_result) <> 'SUCCEEDED'
    or (select status from public.mutation_plans where id = v_plan_id) <> 'SUCCEEDED'
    or (select count(*) from public.mutation_plan_steps
        where plan_id = v_plan_id) <> 21
    or exists (
      select 1 from public.mutation_plan_steps
      where plan_id = v_plan_id
        and status not in ('VALIDATED', 'REMOTE_APPLIED', 'RECONCILED')
    )
    or v_campaign.id is null
    or v_campaign.status <> 'ACTIVE'
    or v_campaign.daily_budget_minor is not null
    or v_campaign.lifetime_budget_minor <> 1500
    or v_ad_set.id is null
    or v_ad_set.status <> 'ACTIVE'
    or v_ad_set.campaign_id <> v_campaign.id
    or v_ad_set.daily_budget_minor is not null
    or v_ad_set.lifetime_budget_minor is not null
    or v_ad_set.start_time <> v_start
    or v_ad_set.end_time <> v_end
    or v_exposure.id is null
    or v_exposure.source <> 'RECONCILIATION'
    or v_exposure.max_daily_budget_minor <> 1500
    or v_exposure.flex_spend_multiplier_bps <> 10000
    or v_exposure.campaign_scope_key <> 'campaign:444444444401'
    or v_exposure.budget_owner_key <> 'campaign:444444444401'
    or v_exposure.budget_owner_type <> 'CAMPAIGN'
    or v_exposure.automation_target_id is null
    or (select count(*) from public.daily_budget_exposures
        where plan_id = v_plan_id) <> 1
    or (select count(*) from public.remote_object_bindings
        where plan_id = v_plan_id and reconciled_at is not null) <> 5
    or (select count(*) from public.meta_launch_canary_approvals
        where plan_id = v_plan_id
          and budget_type = 'LIFETIME'
          and daily_budget_minor is null
          and lifetime_budget_minor = 1500
          and start_time = v_start
          and end_time = v_end) <> 1
    or public.meta_active_lifetime_budget_exposure_minor(
         '12000000-0000-4000-8000-000000000001',
         '22000000-0000-4000-8000-000000000001',
         '32000000-0000-4000-8000-000000000001',
         now()
       ) < 1500
    or exists (
      select 1 from public.meta_account_operation_leases
      where platform_account_id = '22000000-0000-4000-8000-000000000001'
        and lease_token is not null
    )
    or (select count(*) from public.mutation_executions
        where plan_id = v_plan_id) <> 1
    or (select mode from public.kill_switch_state
        where scope_type = 'ACCOUNT'
          and user_id = '12000000-0000-4000-8000-000000000001'
          and platform_account_id = '22000000-0000-4000-8000-000000000001'
        order by sequence desc limit 1) <> 'FREEZE_WRITES'
    or (select mode from public.kill_switch_state
        where scope_type = 'PLAN' and plan_id = v_plan_id
        order by sequence desc limit 1) <> 'FREEZE_WRITES' then
    raise exception 'Lifetime-v3 reconciliation, projection, exposure, or refreeze failed';
  end if;
end;
$$;

-- An ambiguous Create result is terminal, never retried blindly, and refreezes immediately.
do $$
declare
  v_read_lease uuid;
  v_materialized jsonb;
  v_plan_id uuid;
  v_approval record;
  v_claim record;
  v_next record;
  v_step_key text;
  v_failure_status text;
begin
  v_read_lease := public.claim_meta_account_operation(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'READ_SYNC', 'launch-ambiguous-create-regression', 900
  );

  if v_read_lease is null then
    raise exception 'Ambiguous Create regression could not claim its read lease';
  end if;

  v_materialized := public.materialize_meta_launch_chain_plan(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000003',
    (select snapshot_id from executor_planner_result),
    '32000000-0000-4000-8000-000000000001',
    v_read_lease,
    '92000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    array['93000000-0000-4000-8000-000000000001'::uuid],
    '91000000-0000-4000-8000-000000000001',
    'AD_SET',
    500,
    jsonb_build_object(
      'destination_url',
        'https://shop.launch.example.test/products/ambiguous-create',
      'campaign_name', 'Ambiguous Create Campaign',
      'ad_set_name', 'Ambiguous Create Ad Set',
      'creative_name', 'Ambiguous Create Creative',
      'ad_name', 'Ambiguous Create Ad'
    ),
    now()
  );

  perform public.release_meta_account_operation(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    v_read_lease
  );

  v_plan_id := (v_materialized->>'plan_id')::uuid;
  if v_materialized->>'outcome' <> 'CREATED'
    or v_materialized->>'status' <> 'HELD' then
    raise exception 'Ambiguous Create regression did not create a held plan';
  end if;

  select * into v_approval
  from public.approve_meta_launch_canary_plan(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    v_plan_id,
    v_materialized->>'payload_hash',
    v_materialized->>'objective',
    v_materialized->>'destination_url',
    v_materialized->>'budget_owner_type',
    (v_materialized->>'daily_budget_minor')::bigint,
    v_materialized->>'campaign_name',
    v_materialized->>'ad_set_name',
    v_materialized->>'creative_name',
    v_materialized->>'ad_name',
    'ACTIVE',
    'Ambiguous Create terminal-stop regression approval.'
  );

  select * into v_claim
  from public.claim_next_meta_mutation_execution(
    'launch-ambiguous-create-worker', 900
  );

  if v_claim.plan_id is distinct from v_plan_id then
    raise exception 'Ambiguous Create plan was not claimed';
  end if;

  perform public.begin_meta_mutation_step_dispatch(
    v_claim.execution_id, v_claim.first_step_id, v_claim.lease_token
  );
  perform public.complete_meta_mutation_remote_step(
    v_claim.execution_id, v_claim.first_step_id, v_claim.lease_token,
    public.meta_sha256('ambiguous-validate-request'),
    public.meta_sha256('ambiguous-validate-response'),
    null,
    'ambiguous-validate-campaign',
    true,
    '{"account_util_pct":1}'::jsonb
  );

  select claimed.* into v_next
  from public.claim_next_meta_mutation_step(
    v_claim.execution_id, v_claim.lease_token
  ) claimed;

  select step_key into v_step_key
  from public.mutation_plan_steps
  where id = v_next.step_id and plan_id = v_plan_id;

  if v_step_key <> 'create-campaign-paused'
    or v_next.operation <> 'CREATE'
    or v_next.object_type <> 'CAMPAIGN' then
    raise exception 'Ambiguous Create regression did not reach Campaign Create';
  end if;

  perform public.begin_meta_mutation_step_dispatch(
    v_claim.execution_id, v_next.step_id, v_claim.lease_token
  );

  v_failure_status := public.fail_meta_mutation_execution(
    v_claim.execution_id,
    v_next.step_id,
    v_claim.lease_token,
    'TRANSPORT',
    'AMBIGUOUS_CREATE_TIMEOUT',
    'UNKNOWN',
    120
  );

  if v_failure_status <> 'COMPENSATION_REQUIRED'
    or (select status from public.mutation_plans where id = v_plan_id)
       <> 'COMPENSATION_REQUIRED'
    or (select attempt_count from public.mutation_plans where id = v_plan_id) <> 1
    or (select status from public.mutation_plan_steps where id = v_next.step_id)
       <> 'COMPENSATION_REQUIRED'
    or (select dispatch_state from public.mutation_plan_steps where id = v_next.step_id)
       <> 'REMOTE_UNKNOWN'
    or exists (
      select 1 from public.mutation_plan_steps
      where plan_id = v_plan_id
        and step_index > (select step_index from public.mutation_plan_steps
                          where id = v_next.step_id)
        and status <> 'PENDING'
    )
    or exists (
      select 1 from public.meta_account_operation_leases
      where platform_account_id = '22000000-0000-4000-8000-000000000001'
        and lease_token is not null
    )
    or (select mode from public.kill_switch_state
        where scope_type = 'ACCOUNT'
          and user_id = '12000000-0000-4000-8000-000000000001'
          and platform_account_id = '22000000-0000-4000-8000-000000000001'
        order by sequence desc limit 1) <> 'FREEZE_WRITES'
    or (select mode from public.kill_switch_state
        where scope_type = 'PLAN' and plan_id = v_plan_id
        order by sequence desc limit 1) <> 'FREEZE_WRITES'
    or not exists (
      select 1 from public.automation_alerts
      where plan_id = v_plan_id
        and alert_type = 'REMOTE_OUTCOME_AMBIGUOUS'
        and severity = 'CRITICAL'
        and status = 'OPEN'
    ) then
    raise exception 'Ambiguous Create was retried, advanced, left a lease, lacked an alert, or failed to refreeze';
  end if;
end;
$$;

-- Browser roles cannot invoke launch materialization or its private base paths.
do $$
begin
  if has_function_privilege(
       'authenticated',
       'public.materialize_meta_launch_chain_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid[],uuid,text,bigint,jsonb,timestamptz)',
       'EXECUTE'
     )
    or has_function_privilege(
       'authenticated',
       'public.materialize_meta_launch_chain_plan_v3(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid[],uuid,text,bigint,timestamptz,timestamptz,jsonb,timestamptz)',
       'EXECUTE'
     )
    or has_function_privilege(
       'authenticated',
       'public.materialize_meta_customer_lifetime_launch_plan_v3(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,timestamptz,timestamptz,jsonb,timestamptz)',
       'EXECUTE'
     )
    or has_function_privilege(
       'authenticated',
       'public.approve_meta_lifetime_launch_canary_plan_v3(uuid,uuid,uuid,text,text,text,text,bigint,timestamptz,timestamptz,text,text,text,text,text,text)',
       'EXECUTE'
     )
    or has_function_privilege(
       'authenticated',
       'public.reconcile_meta_launch_mutation_plan(uuid,uuid,uuid)',
       'EXECUTE'
     )
    or has_function_privilege(
       'authenticated',
       'public.reconcile_meta_mutation_plan_base(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'Authenticated role can execute a Launch mutation RPC';
  end if;
end;
$$;

-- Browser roles cannot execute any mutating Executor primitive.
do $$
begin
  if has_function_privilege('authenticated',
      'public.claim_next_meta_mutation_execution(text,integer)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.claim_next_meta_mutation_step(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.begin_meta_mutation_step_dispatch(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.complete_meta_mutation_remote_step(uuid,uuid,uuid,text,text,text,text,boolean,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.record_meta_mutation_remote_snapshot(uuid,uuid,uuid,text,text,jsonb,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.reconcile_meta_mutation_plan(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.fail_meta_mutation_execution(uuid,uuid,uuid,text,text,text,integer)', 'EXECUTE') then
    raise exception 'Authenticated role can execute an Executor mutation RPC';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $$
begin
  if exists (
    select 1 from public.meta_mutation_remote_snapshots
    where user_id = '12000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Remote snapshots leaked across tenants';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- The executor events remain part of the existing immutable SHA-256 chain.
do $$
begin
  if exists (
    select 1
    from (
      select
        platform_account_id,
        event_sequence,
        previous_event_hash,
        lag(event_hash) over (
          partition by platform_account_id order by event_sequence
        ) as expected_previous_hash
      from public.mutation_audit_events
    ) chained
    where previous_event_hash is distinct from expected_previous_hash
  )
  or exists (
    select 1 from public.mutation_audit_events
    where event_hash !~ '^[0-9a-f]{64}$'
  )
  or (select count(*) from public.mutation_audit_events
      where user_id = '12000000-0000-4000-8000-000000000001'
        and event_type in (
          'MUTATION_EXECUTION_CLAIMED',
          'MUTATION_STEP_PRE_DISPATCH',
          'MUTATION_REMOTE_STEP_COMPLETED',
          'MUTATION_REMOTE_SNAPSHOT_RECORDED',
          'MUTATION_PLAN_RECONCILED',
          'MUTATION_EXECUTION_FAILED'
        )) < 10 then
    raise exception 'Executor audit hash chain or lifecycle events are incomplete';
  end if;
end;
$$;

select 'Meta Mutation Executor migration checks passed' as result;

rollback;

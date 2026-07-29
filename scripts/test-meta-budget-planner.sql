\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values
  ('11000000-0000-4000-8000-000000000001', 'planner-owner@example.test'),
  ('11000000-0000-4000-8000-000000000002', 'planner-other@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_name, access_token,
  ad_account_ids, marketing_meta_ad_account_id, marketing_currency,
  marketing_timezone_name, marketing_sync_status, marketing_sync_id,
  marketing_last_success_at, marketing_campaign_count,
  marketing_ad_set_count, marketing_ad_count, marketing_creative_count,
  marketing_insight_count, marketing_recommendation_count,
  marketing_insights_since, marketing_insights_until
) values
  (
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'meta', 'planner-owner', 'Planner Owner Meta', null,
    '["act_111111111111"]'::jsonb, '111111111111', 'EUR',
    'Europe/Berlin', 'success',
    '31000000-0000-4000-8000-000000000001', now(),
    1, 0, 0, 0, 0, 1, current_date - 13, current_date
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002',
    'meta', 'planner-other', 'Planner Other Meta', null,
    '["act_222222222222"]'::jsonb, '222222222222', 'EUR',
    'Europe/Berlin', 'success',
    '31000000-0000-4000-8000-000000000002', now(),
    1, 0, 0, 0, 0, 0, current_date - 13, current_date
  );

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, last_seen_sync_id,
  last_seen_at, is_current
) values
  (
    '41000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '111111111111', 'Planner Owner Campaign', 'ACTIVE', 'ACTIVE',
    'OUTCOME_SALES', 2000,
    '31000000-0000-4000-8000-000000000001', now(), true
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    '222222222222', 'Planner Other Campaign', 'ACTIVE', 'ACTIVE',
    'OUTCOME_TRAFFIC', 2000,
    '31000000-0000-4000-8000-000000000002', now(), true
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
    '81000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    1, 'ACTIVE', 'EUR', 10000, 6000, 2000, 43200, 17500, 21000,
    true, true, true, true,
    '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
    repeat('a', 64), true, now(),
    '11000000-0000-4000-8000-000000000001', now()
  ),
  (
    '81000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    1, 'ACTIVE', 'EUR', 3000, 3000, 2000, 43200, 17500, 21000,
    true, true, true, true,
    '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
    repeat('b', 64), true, now(),
    '11000000-0000-4000-8000-000000000002', now()
  );

insert into public.campaign_recommendations (
  id, user_id, platform_account_id, campaign_id, rule_key, rule_version,
  severity, priority, title, summary, evidence, evidence_hash,
  window_start, window_end, status, generated_at, expires_at
) values (
  '61000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'spend_without_results_14d', 1, 'warning', 75,
  'Ausgaben ohne Ergebnis', 'Planner regression recommendation',
  '{"rule":"spend_without_results_14d","spend":100,"results":0,"currency":"EUR"}'::jsonb,
  md5('{"rule":"spend_without_results_14d","spend":100,"results":0,"currency":"EUR"}'),
  current_date - 13, current_date, 'active', now(), now() + interval '2 hours'
);

-- Without the still-live READ_SYNC lease, no target, exposure or plan may be built.
create temporary table planner_without_lease on commit drop as
select *
from public.run_meta_budget_planner(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000099',
  now()
);

do $$
begin
  if (select planner_status from planner_without_lease) <> 'READ_LEASE_REQUIRED'
    or exists (
      select 1 from public.automation_targets
      where platform_account_id = '21000000-0000-4000-8000-000000000001'
    ) then
    raise exception 'Planner mutated state without an active READ_SYNC lease';
  end if;
end;
$$;

create temporary table planner_leases (
  platform_account_id uuid primary key,
  lease_token uuid not null
) on commit drop;

insert into planner_leases
select
  '21000000-0000-4000-8000-000000000001'::uuid,
  public.claim_meta_account_operation(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'READ_SYNC', 'planner-regression-owner', 900
  )
union all
select
  '21000000-0000-4000-8000-000000000002'::uuid,
  public.claim_meta_account_operation(
    '21000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002',
    'READ_SYNC', 'planner-regression-other', 900
  );

-- Sharing capture is complete, idempotent and drift-failing for the exact sync.
select public.record_meta_campaign_budget_sharing_snapshot(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  (select lease_token from planner_leases
    where platform_account_id = '21000000-0000-4000-8000-000000000001'),
  '[{"platform_campaign_id":"111111111111","is_adset_budget_sharing_enabled":false}]'::jsonb
);

select public.record_meta_campaign_budget_sharing_snapshot(
  '21000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000002',
  (select lease_token from planner_leases
    where platform_account_id = '21000000-0000-4000-8000-000000000002'),
  '[{"platform_campaign_id":"222222222222","is_adset_budget_sharing_enabled":null}]'::jsonb
);

do $$
begin
  begin
    perform public.record_meta_campaign_budget_sharing_snapshot(
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      (select lease_token from planner_leases
        where platform_account_id = '21000000-0000-4000-8000-000000000001'),
      '[{"platform_campaign_id":"111111111111","is_adset_budget_sharing_enabled":true}]'::jsonb
    );
    raise exception 'Same-sync budget-sharing drift was accepted';
  exception
    when others then
      if sqlerrm = 'Same-sync budget-sharing drift was accepted' then
        raise;
      end if;
      if sqlerrm <> 'Campaign budget-sharing snapshot replay drifted' then
        raise;
      end if;
  end;
end;
$$;

create temporary table planner_owner_first on commit drop as
select *
from public.run_meta_budget_planner(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  (select lease_token from planner_leases
    where platform_account_id = '21000000-0000-4000-8000-000000000001'),
  now()
);

do $$
declare
  v_plan public.mutation_plans%rowtype;
begin
  if (select planner_status from planner_owner_first) <> 'PLANNED'
    or (select observed_budget_owner_count from planner_owner_first) <> 1
    or (select reserved_exposure_minor from planner_owner_first) <> 3500
    or (select plans_created from planner_owner_first) <> 1
    or (select hard_cap_breach from planner_owner_first) then
    raise exception 'Normal planner result is incorrect';
  end if;

  select * into v_plan
  from public.mutation_plans
  where platform_account_id = '21000000-0000-4000-8000-000000000001'
    and action_type = 'UPDATE_BUDGET';

  if v_plan.status <> 'PENDING'
    or v_plan.target_type <> 'CAMPAIGN'
    or v_plan.target_key <> 'campaign:111111111111'
    or v_plan.budget_owner_key <> 'campaign:111111111111'
    or v_plan.source_recommendation_id
      <> '61000000-0000-4000-8000-000000000001'
    or (v_plan.expected_before->>'daily_budget_minor')::bigint <> 2000
    or (v_plan.intended_after->>'daily_budget_minor')::bigint <> 1600
    or (v_plan.planned_payload->>'change_bps')::integer <> 2000
    or v_plan.payload_hash <> public.meta_sha256(v_plan.planned_payload::text)
    or v_plan.idempotency_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Deterministic budget plan is incorrect';
  end if;

  if (select count(*) from public.mutation_plan_steps where plan_id = v_plan.id) <> 4
    or exists (
      select 1
      from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.request_hash <> public.meta_sha256(step.planned_request::text)
    )
    or exists (
      select 1
      from public.mutation_plan_steps step
      left join public.mutation_plan_steps predecessor
        on predecessor.id = step.depends_on_step_id
      where step.plan_id = v_plan.id
        and (
          (step.step_index = 0 and step.depends_on_step_id is not null)
          or (step.step_index > 0 and predecessor.step_index <> step.step_index - 1)
        )
    )
    or (select array_agg(operation order by step_index)
        from public.mutation_plan_steps where plan_id = v_plan.id)
      <> array['VALIDATE','UPDATE','READ','RECONCILE']::text[] then
    raise exception 'Budget plan saga is incorrect';
  end if;

  if not exists (
    select 1
    from public.daily_budget_exposures exposure
    where exposure.platform_account_id = v_plan.platform_account_id
      and exposure.budget_owner_key = v_plan.budget_owner_key
      and exposure.shared_budget_enabled = false
      and exposure.flex_spend_multiplier_bps = 17500
      and exposure.max_daily_budget_minor = 2000
      and exposure.reserved_exposure_minor = 3500
  ) then
    raise exception 'Standard Flexspend exposure is incorrect';
  end if;
end;
$$;

-- Exact replay does not create a second plan.
create temporary table planner_owner_replay on commit drop as
select *
from public.run_meta_budget_planner(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  (select lease_token from planner_leases
    where platform_account_id = '21000000-0000-4000-8000-000000000001'),
  now()
);

do $$
begin
  if (select plans_created from planner_owner_replay) <> 0
    or (select plans_existing from planner_owner_replay) <> 1
    or (select count(*) from public.mutation_plans
        where platform_account_id = '21000000-0000-4000-8000-000000000001'
          and action_type = 'UPDATE_BUDGET') <> 1 then
    raise exception 'Planner replay was not idempotent';
  end if;
end;
$$;

-- Terminalize the unexecuted fixture, then isolate the 12-hour target cooldown.
update public.mutation_plans
set status = 'CANCELLED', terminal_at = now(),
    blocked_reason = 'planner_regression', updated_at = now()
where platform_account_id = '21000000-0000-4000-8000-000000000001'
  and action_type = 'UPDATE_BUDGET';

update public.automation_targets
set last_successful_mutation_at = now() - interval '1 hour', updated_at = now()
where platform_account_id = '21000000-0000-4000-8000-000000000001'
  and target_key = 'campaign:111111111111';

create temporary table planner_owner_cooldown on commit drop as
select *
from public.run_meta_budget_planner(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  (select lease_token from planner_leases
    where platform_account_id = '21000000-0000-4000-8000-000000000001'),
  now()
);

do $$
begin
  if (select plans_created from planner_owner_cooldown) <> 0
    or (select candidates_blocked from planner_owner_cooldown) <> 1 then
    raise exception 'Twelve-hour cooldown did not block the candidate';
  end if;
end;
$$;

-- A reconciled 20% change 13 hours ago is outside cooldown but consumes the
-- entire rolling movement allowance for the original 2,000-minor baseline.
insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_rule_key, source_rule_version, action_type, target_type, target_key,
  campaign_scope_key, budget_owner_key, automation_target_id,
  idempotency_key, expected_before, intended_after, planned_payload,
  payload_hash, validation_fingerprint, validated_at, status, priority,
  terminal_at, created_at, updated_at
) values (
  'a1000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'spend_without_results_14d', 1, 'UPDATE_BUDGET', 'CAMPAIGN',
  'campaign:111111111111', 'campaign:111111111111',
  'campaign:111111111111',
  (select id from public.automation_targets
    where platform_account_id = '21000000-0000-4000-8000-000000000001'
      and target_key = 'campaign:111111111111'),
  repeat('c', 64), '{"daily_budget_minor":2000}'::jsonb,
  '{"daily_budget_minor":1600}'::jsonb, '{"history":true}'::jsonb,
  repeat('d', 64), repeat('e', 64), now() - interval '13 hours',
  'SUCCEEDED', 50, now() - interval '13 hours',
  now() - interval '14 hours', now() - interval '13 hours'
);

insert into public.mutation_plan_steps (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, planned_request, request_hash, expected_result,
  compensation_operation, status, validation_fingerprint, validated_at,
  started_at, completed_at, created_at, updated_at
) values (
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  0, 'history-update', 'UPDATE', 'CAMPAIGN',
  '{"daily_budget_minor":1600}'::jsonb, repeat('f', 64),
  '{"daily_budget_minor":1600}'::jsonb, 'PAUSE', 'RECONCILED',
  repeat('1', 64), now() - interval '13 hours',
  now() - interval '13 hours', now() - interval '13 hours',
  now() - interval '14 hours', now() - interval '13 hours'
);

insert into public.mutation_executions (
  id, plan_id, user_id, platform_account_id, attempt_number, worker_id,
  lease_token, status, started_at, last_heartbeat_at, finished_at
) values (
  'c1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  1, 'planner-history-worker',
  'd1000000-0000-4000-8000-000000000001',
  'SUCCEEDED', now() - interval '13 hours',
  now() - interval '13 hours', now() - interval '13 hours'
);

insert into public.budget_mutation_ledger (
  id, user_id, platform_account_id, policy_id, plan_id, step_id,
  execution_id, automation_target_id, budget_owner_key, currency,
  before_budget_minor, after_budget_minor, remote_request_id,
  executed_at, reconciled_at
) values (
  'e1000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  (select id from public.automation_targets
    where platform_account_id = '21000000-0000-4000-8000-000000000001'
      and target_key = 'campaign:111111111111'),
  'campaign:111111111111', 'EUR', 2000, 1600,
  'planner-history-request', now() - interval '13 hours',
  now() - interval '13 hours' + interval '1 minute'
);

update public.campaigns
set daily_budget_minor = 1600, updated_at = now()
where id = '41000000-0000-4000-8000-000000000001';

update public.automation_targets
set last_successful_mutation_at = now() - interval '13 hours', updated_at = now()
where platform_account_id = '21000000-0000-4000-8000-000000000001'
  and target_key = 'campaign:111111111111';

create temporary table planner_owner_rolling_limit on commit drop as
select *
from public.run_meta_budget_planner(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  (select lease_token from planner_leases
    where platform_account_id = '21000000-0000-4000-8000-000000000001'),
  now()
);

do $$
begin
  if (select plans_created from planner_owner_rolling_limit) <> 0
    or (select candidates_blocked from planner_owner_rolling_limit) <> 1
    or exists (
      select 1 from public.mutation_plans
      where platform_account_id = '21000000-0000-4000-8000-000000000001'
        and status = 'PENDING'
    ) then
    raise exception 'Rolling 24-hour movement limit did not block the candidate';
  end if;
end;
$$;

-- Unknown sharing is explicitly captured and must use at least the 2.10 factor.
-- The 2,000 budget therefore reserves 4,200, breaching both 3,000 hard caps and
-- queues an autonomous campaign safety pause, never a budget increase.
create temporary table planner_other_hard_cap on commit drop as
select *
from public.run_meta_budget_planner(
  '21000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000002',
  (select lease_token from planner_leases
    where platform_account_id = '21000000-0000-4000-8000-000000000002'),
  now()
);

do $$
declare
  v_plan public.mutation_plans%rowtype;
begin
  if (select planner_status from planner_other_hard_cap) <> 'HARD_CAP_SAFETY'
    or (select reserved_exposure_minor from planner_other_hard_cap) <> 4200
    or (select plans_created from planner_other_hard_cap) <> 1
    or not (select hard_cap_breach from planner_other_hard_cap) then
    raise exception 'Hard-cap planner result is incorrect';
  end if;

  if not exists (
    select 1
    from public.daily_budget_exposures exposure
    where exposure.platform_account_id =
      '21000000-0000-4000-8000-000000000002'
      and exposure.shared_budget_enabled
      and exposure.flex_spend_multiplier_bps = 21000
      and exposure.max_daily_budget_minor = 2000
      and exposure.reserved_exposure_minor = 4200
  ) then
    raise exception 'Unknown sharing did not use conservative 2.10 exposure';
  end if;

  select * into v_plan
  from public.mutation_plans
  where platform_account_id = '21000000-0000-4000-8000-000000000002';

  if v_plan.action_type <> 'SAFETY_PAUSE'
    or not v_plan.safety_action
    or v_plan.target_type <> 'CAMPAIGN'
    or v_plan.target_key <> 'campaign:222222222222'
    or v_plan.status <> 'PENDING'
    or v_plan.planned_payload->>'status' <> 'PAUSED'
    or v_plan.planned_payload->>'safety_reason'
      <> 'hard_cap_exposure_breach'
    or exists (
      select 1 from public.mutation_plans
      where platform_account_id = v_plan.platform_account_id
        and action_type = 'UPDATE_BUDGET'
    )
    or (select array_agg(operation order by step_index)
        from public.mutation_plan_steps where plan_id = v_plan.id)
      <> array['VALIDATE','UPDATE','READ','RECONCILE']::text[] then
    raise exception 'Hard-cap safety pause plan is incorrect';
  end if;
end;
$$;

-- Public planner entry points are service-role only; internal partial-write
-- helpers are intentionally not executable even by the service role.
do $$
begin
  if has_function_privilege(
      'authenticated',
      'public.record_meta_campaign_budget_sharing_snapshot(uuid,uuid,uuid,uuid,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.run_meta_budget_planner(uuid,uuid,uuid,uuid,timestamptz)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.record_meta_campaign_budget_sharing_snapshot(uuid,uuid,uuid,uuid,jsonb)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.run_meta_budget_planner(uuid,uuid,uuid,uuid,timestamptz)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.refresh_meta_budget_planner_snapshot_internal(uuid,uuid,uuid,uuid,timestamptz)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.queue_meta_budget_plan_internal(uuid,uuid,uuid,uuid,uuid,uuid,text,integer,uuid,text,integer,jsonb,timestamptz)',
      'EXECUTE'
    )
    or has_column_privilege(
      'authenticated', 'public.campaigns',
      'budget_sharing_snapshot_sync_id', 'SELECT'
    ) then
    raise exception 'Planner RPC or snapshot-column grants are incorrect';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(id) from public.mutation_plans) <> 2
    or exists (
      select 1 from public.mutation_plans
      where platform_account_id = '21000000-0000-4000-8000-000000000002'
    )
    or (select count(id) from public.daily_budget_exposure_snapshots) <> 1
    or (select count(id) from public.daily_budget_exposures) <> 1 then
    raise exception 'Planner tenant RLS is incorrect';
  end if;
end;
$$;

reset role;

-- Every account audit stream remains a contiguous SHA-256 chain.
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
      where event_type in (
        'BUDGET_EXPOSURE_SNAPSHOT_COMPLETED',
        'MUTATION_PLAN_QUEUED',
        'HARD_CAP_EXPOSURE_BREACH_DETECTED',
        'HARD_CAP_SAFETY_PAUSE_QUEUED'
      )) < 4 then
    raise exception 'Planner audit hash chain or lifecycle events are incomplete';
  end if;
end;
$$;

select 'Meta Budget Planner migration checks passed' as result;

rollback;

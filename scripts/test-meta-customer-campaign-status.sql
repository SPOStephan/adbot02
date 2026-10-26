\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values ('14000000-0000-4000-8000-000000000001', 'status-owner@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_name, access_token,
  ad_account_ids, meta_scopes, marketing_meta_ad_account_id,
  marketing_currency, marketing_timezone_name, marketing_sync_status,
  marketing_sync_id, marketing_last_success_at, marketing_campaign_count,
  marketing_ad_set_count, marketing_ad_count, marketing_creative_count,
  marketing_insight_count, marketing_recommendation_count,
  marketing_insights_since, marketing_insights_until
) values (
  '24000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  'meta', 'status-owner', 'Status Owner Meta', null,
  '["act_555555555555"]'::jsonb,
  array['ads_read','ads_management']::text[],
  '555555555555', 'EUR', 'Europe/Berlin', 'success',
  '34000000-0000-4000-8000-000000000001', now(),
  2, 0, 0, 0, 0, 0, current_date - 13, current_date
);

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, last_seen_sync_id,
  last_seen_at, is_current
) values
  (
    '44000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'Lead Kampagne', 'ACTIVE', 'ACTIVE',
    'OUTCOME_LEADS', 2000,
    '34000000-0000-4000-8000-000000000001', now(), true
  ),
  (
    '44000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555502', 'Beitrag-Push', 'ACTIVE', 'ACTIVE',
    'OUTCOME_ENGAGEMENT', 500,
    '34000000-0000-4000-8000-000000000001', now(), true
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
  '84000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  1, 'ACTIVE', 'EUR', 10000, 5000, 2000, 43200, 17500, 21000,
  true, true, true, true,
  '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
  repeat('e', 64), true, now(),
  '14000000-0000-4000-8000-000000000001', now()
);

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_reconciled_at
) values
  (
    '54000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    'CAMPAIGN', 'campaign:555555555501', '555555555501',
    'campaign:555555555501', 'CAMPAIGN', 'campaign:555555555501',
    '44000000-0000-4000-8000-000000000001', 'MANAGED', now()
  ),
  (
    '54000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    'CAMPAIGN', 'campaign:555555555502', '555555555502',
    'campaign:555555555502', 'CAMPAIGN', 'campaign:555555555502',
    '44000000-0000-4000-8000-000000000002', 'MANAGED', now()
  );

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  null,
  'ALLOW', 'Customer status regression fixture', 'OPERATOR', 'test'
);

-- Launch plans: one Adbot Lead launch, one Beitrag-Push.
insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_rule_key, source_rule_version, action_type, target_type, target_key,
  idempotency_key, expected_before, intended_after, planned_payload,
  payload_hash, status, terminal_at, created_at
) values
  (
    'b4000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '34000000-0000-4000-8000-000000000001',
    'active-launch-chain', 1, 'LAUNCH_CHAIN', 'CHAIN', 'launch:lead',
    repeat('1', 64), '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    repeat('2', 64), 'SUCCEEDED', now() - interval '3 days',
    now() - interval '3 days'
  ),
  (
    'b4000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '34000000-0000-4000-8000-000000000001',
    'organic-boost', 1, 'LAUNCH_CHAIN', 'CHAIN', 'launch:boost',
    repeat('3', 64), '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    repeat('4', 64), 'SUCCEEDED', now() - interval '3 days',
    now() - interval '3 days'
  );

insert into public.mutation_plan_steps (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, planned_request, request_hash,
  expected_result, compensation_operation, status
) values
  (
    'c4000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001', 0, 'create-campaign',
    'CREATE', 'CAMPAIGN', '{}'::jsonb, repeat('5', 64), '{}', 'NONE', 'RECONCILED'
  ),
  (
    'c4000000-0000-4000-8000-000000000002',
    'b4000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001', 0, 'create-campaign',
    'CREATE', 'CAMPAIGN', '{}'::jsonb, repeat('6', 64), '{}', 'NONE', 'RECONCILED'
  );

insert into public.remote_object_bindings (
  plan_id, step_id, user_id, platform_account_id, object_type,
  remote_object_id, request_fingerprint, local_campaign_id, reconciled_at
) values
  (
    'b4000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001', 'CAMPAIGN', '555555555501',
    repeat('5', 64), '44000000-0000-4000-8000-000000000001', now()
  ),
  (
    'b4000000-0000-4000-8000-000000000002',
    'c4000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001', 'CAMPAIGN', '555555555502',
    repeat('6', 64), '44000000-0000-4000-8000-000000000002', now()
  );

do $$
declare
  v_result jsonb;
  v_again jsonb;
  v_plan public.mutation_plans%rowtype;
  v_steps integer;
begin
  v_result := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'PAUSED'
  );
  if v_result->>'outcome' <> 'CREATED' then
    raise exception 'Customer pause was not queued: %', v_result;
  end if;

  select * into v_plan from public.mutation_plans
  where id = (v_result->>'plan_id')::uuid;
  if v_plan.action_type <> 'PAUSE'
    or v_plan.safety_action
    or v_plan.source_rule_key <> 'customer_status_change'
    or v_plan.automation_target_id <> '54000000-0000-4000-8000-000000000001'
    or v_plan.expected_before->>'status' <> 'ACTIVE'
    or v_plan.intended_after->>'status' <> 'PAUSED' then
    raise exception 'Customer pause plan has the wrong shape: %', row_to_json(v_plan);
  end if;

  select count(*) into v_steps from public.mutation_plan_steps
  where plan_id = v_plan.id;
  if v_steps <> 4 then
    raise exception 'Customer pause plan needs 4 steps, got %', v_steps;
  end if;

  v_again := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'PAUSED'
  );
  if v_again->>'outcome' <> 'EXISTING'
    or v_again->>'plan_id' <> v_result->>'plan_id' then
    raise exception 'Second click must reuse the open plan: %', v_again;
  end if;

  v_again := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555502', 'PAUSED'
  );
  if v_again->>'reason' <> 'not_adbot_launch' then
    raise exception 'Beitrag-Push must not be paused by the button: %', v_again;
  end if;

  v_again := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'ACTIVE'
  );
  if v_again->>'outcome' <> 'UNCHANGED' then
    raise exception 'Resume of an active campaign must be a no-op: %', v_again;
  end if;

  -- Executor finished the pause.
  update public.mutation_plans
  set status = 'SUCCEEDED', terminal_at = now(), updated_at = now()
  where id = v_plan.id;
  update public.campaigns
  set status = 'PAUSED', effective_status = 'PAUSED'
  where id = '44000000-0000-4000-8000-000000000001';

  v_again := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'ACTIVE'
  );
  if v_again->>'outcome' <> 'CREATED' or v_again->>'action_type' <> 'ACTIVATE' then
    raise exception 'Customer resume was not queued: %', v_again;
  end if;
  update public.mutation_plans
  set status = 'CANCELLED', terminal_at = now(), updated_at = now()
  where id = (v_again->>'plan_id')::uuid;

  update public.automation_policies
  set allow_status_changes = false
  where id = '84000000-0000-4000-8000-000000000001';
  v_again := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'ACTIVE'
  );
  if v_again->>'reason' <> 'status_changes_not_allowed' then
    raise exception 'Policy without status changes must block: %', v_again;
  end if;
  update public.automation_policies
  set allow_status_changes = true
  where id = '84000000-0000-4000-8000-000000000001';
end;
$$;

-- Hard-cap day-resume must not undo the customer pause above.
insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_rule_key, source_rule_version, action_type, target_type, target_key,
  automation_target_id, idempotency_key, expected_before, intended_after,
  planned_payload, payload_hash, status, safety_action, terminal_at, created_at
) values (
  'b4000000-0000-4000-8000-000000000010',
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001',
  'hard_cap_exposure_breach', 1, 'SAFETY_PAUSE', 'CAMPAIGN',
  'campaign:555555555501', '54000000-0000-4000-8000-000000000001',
  repeat('7', 64), '{"status":"ACTIVE"}'::jsonb, '{"status":"PAUSED"}'::jsonb,
  '{"safety_reason":"hard_cap_exposure_breach"}'::jsonb,
  repeat('8', 64), 'SUCCEEDED', true, now() - interval '2 days',
  now() - interval '2 days'
);

do $$
declare
  v_result jsonb;
begin
  v_result := public.queue_meta_hard_cap_resume_internal(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    gen_random_uuid(),
    '34000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000001',
    current_date, '{}'::jsonb, now()
  );
  if v_result->>'reason' is distinct from 'later_status_change_wins' then
    raise exception 'Hard-cap resume overrode a customer pause: %', v_result;
  end if;

  -- A newer hard-cap pause (after the customer's decision) is resumed again.
  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
    source_rule_key, source_rule_version, action_type, target_type, target_key,
    automation_target_id, idempotency_key, expected_before, intended_after,
    planned_payload, payload_hash, status, safety_action, terminal_at, created_at
  ) values (
    'b4000000-0000-4000-8000-000000000011',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '34000000-0000-4000-8000-000000000001',
    'hard_cap_exposure_breach', 1, 'SAFETY_PAUSE', 'CAMPAIGN',
    'campaign:555555555501', '54000000-0000-4000-8000-000000000001',
    repeat('9', 64), '{"status":"ACTIVE"}'::jsonb, '{"status":"PAUSED"}'::jsonb,
    '{"safety_reason":"hard_cap_exposure_breach"}'::jsonb,
    repeat('a', 64), 'SUCCEEDED', true, now(), now() + interval '1 minute'
  );

  v_result := public.queue_meta_hard_cap_resume_internal(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    gen_random_uuid(),
    '34000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000001',
    current_date, '{}'::jsonb, now()
  );
  if v_result->>'outcome' is distinct from 'CREATED' then
    raise exception 'Hard-cap resume must still resume its own pause: %', v_result;
  end if;
end;
$$;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.queue_meta_customer_campaign_status_change(uuid,uuid,text,text)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.queue_meta_customer_campaign_status_change(uuid,uuid,text,text)',
    'execute'
  ) then
    raise exception 'Customer status RPC privileges are incorrect';
  end if;
end;
$$;

rollback;

select 'Meta customer campaign status checks passed' as result;

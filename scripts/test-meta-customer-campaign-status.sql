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

-- Without budget autonomy the planner refresh suspends the launch target. The
-- customer button must still pause/resume it; automatic rules must not.
do $$
declare
  v_result jsonb;
  v_status text;
  v_claimed integer;
  v_claim record;
begin
  update public.automation_policies
  set allow_budget_changes = false
  where id = '84000000-0000-4000-8000-000000000001';
  update public.automation_targets
  set last_reconciled_at = now()
  where id = '54000000-0000-4000-8000-000000000001';
  select status into v_status from public.automation_targets
  where id = '54000000-0000-4000-8000-000000000001';
  if v_status <> 'SUSPENDED' then
    raise exception 'Fixture target should be SUSPENDED, got %', v_status;
  end if;

  v_result := public.queue_meta_campaign_status_plan_internal(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000001',
    'ACTIVE', 'lead_underperformer_pause_v1', '{}'::jsonb, 'SYSTEM', 'test', now()
  );
  if v_result->>'reason' is distinct from 'target_not_managed' then
    raise exception 'Automatic rules must not use a SUSPENDED target: %', v_result;
  end if;

  v_result := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'ACTIVE'
  );
  if v_result->>'outcome' <> 'CREATED' then
    raise exception 'Customer resume of a SUSPENDED target was not queued: %', v_result;
  end if;

  update public.mutation_plans
  set status = 'CANCELLED', terminal_at = now(), updated_at = now()
  where id = (v_result->>'plan_id')::uuid;

  update public.platform_accounts
  set access_token_encrypted = 'encrypted', token_iv = 'iv', token_auth_tag = 'tag'
  where id = '24000000-0000-4000-8000-000000000001';

  -- The RPC stamps the click time (clock_timestamp); queue a claimable copy
  -- with a planned time inside this test transaction.
  v_result := public.queue_meta_campaign_status_plan_internal(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000001',
    'ACTIVE', 'customer_status_change', '{}'::jsonb, 'CUSTOMER', 'test',
    now() - interval '1 second'
  );
  if v_result->>'outcome' <> 'CREATED' then
    raise exception 'Claimable customer resume was not queued: %', v_result;
  end if;

  select * into v_claim
  from public.claim_meta_mutation_execution(
    'status-test-worker', 60, (v_result->>'plan_id')::uuid
  );
  v_claimed := case when v_claim.execution_id is null then 0 else 1 end;
  if v_claimed = 1 then
    -- The per-step dispatch gate right before the Meta request must agree.
    perform public.begin_meta_mutation_step_dispatch(
      v_claim.execution_id, v_claim.first_step_id, v_claim.lease_token
    );
  end if;
  select status into v_status from public.mutation_plans
  where id = (v_result->>'plan_id')::uuid;
  if v_claimed <> 1 then
    raise exception 'Customer plan on a SUSPENDED target was not claimed (plan %)', v_status;
  end if;

  select status into v_status from public.automation_targets
  where id = '54000000-0000-4000-8000-000000000001';
  if v_status <> 'SUSPENDED' then
    raise exception 'Customer status change must not re-manage the target: %', v_status;
  end if;

  -- Release the account write lease the test claim took.
  update public.meta_account_operation_leases
  set lease_kind = null, lease_token = null, owner_id = null,
      acquired_at = null, expires_at = null, updated_at = now()
  where platform_account_id = '24000000-0000-4000-8000-000000000001';

  update public.mutation_plans
  set status = 'CANCELLED', terminal_at = now(), updated_at = now()
  where id = (v_result->>'plan_id')::uuid;
  update public.automation_policies
  set allow_budget_changes = true
  where id = '84000000-0000-4000-8000-000000000001';
  update public.automation_targets
  set last_reconciled_at = now()
  where id = '54000000-0000-4000-8000-000000000001';
end;
$$;


-- The automatic account refreeze after an accepted launch must not stop the
-- customer button; a customer Not-Aus and automatic rules stay blocked.
do $$
declare
  v_result jsonb;
  v_claimed integer;
  v_claim record;
begin
  perform public.append_meta_kill_switch_state(
    'ACCOUNT',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    null, 'FREEZE_WRITES', 'Atomarer Aktiv-Launch hat alle Remote-Writes beendet',
    'SYSTEM', 'meta-launch-canary-refreeze'
  );

  v_result := public.queue_meta_campaign_status_plan_internal(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000001',
    'ACTIVE', 'lead_underperformer_pause_v1', '{}'::jsonb, 'SYSTEM', 'test', now()
  );
  if v_result->>'reason' is distinct from 'writes_frozen' then
    raise exception 'Automatic rules must stay frozen after a launch: %', v_result;
  end if;

  v_result := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'ACTIVE'
  );
  if v_result->>'outcome' <> 'CREATED' then
    raise exception 'Customer click must pass the launch refreeze: %', v_result;
  end if;
  update public.mutation_plans
  set status = 'CANCELLED', terminal_at = now(), updated_at = now()
  where id = (v_result->>'plan_id')::uuid;

  v_result := public.queue_meta_campaign_status_plan_internal(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000001',
    'ACTIVE', 'customer_status_change', '{}'::jsonb, 'CUSTOMER', 'test',
    now() - interval '2 seconds'
  );
  if v_result->>'outcome' <> 'CREATED' then
    raise exception 'Claimable customer resume after refreeze was not queued: %', v_result;
  end if;
  select * into v_claim
  from public.claim_meta_mutation_execution(
    'status-test-worker', 60, (v_result->>'plan_id')::uuid
  );
  v_claimed := case when v_claim.execution_id is null then 0 else 1 end;
  if v_claimed = 1 then
    -- The per-step dispatch gate right before the Meta request must agree.
    perform public.begin_meta_mutation_step_dispatch(
      v_claim.execution_id, v_claim.first_step_id, v_claim.lease_token
    );
  end if;
  if v_claimed <> 1 then
    raise exception 'Customer plan was not claimed under the launch refreeze';
  end if;
  if (
    select ks.mode from public.get_effective_meta_kill_switch(
      '14000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001', null
    ) ks
  ) <> 'FREEZE_WRITES' then
    raise exception 'Customer click must not unfreeze the account';
  end if;
  update public.meta_account_operation_leases
  set lease_kind = null, lease_token = null, owner_id = null,
      acquired_at = null, expires_at = null, updated_at = now()
  where platform_account_id = '24000000-0000-4000-8000-000000000001';
  update public.mutation_plans
  set status = 'CANCELLED', terminal_at = now(), updated_at = now()
  where id = (v_result->>'plan_id')::uuid;

  perform public.append_meta_kill_switch_state(
    'ACCOUNT',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    null, 'FREEZE_WRITES', 'Kunde hat Not-Aus gedrückt', 'CUSTOMER',
    '14000000-0000-4000-8000-000000000001'
  );
  v_result := public.queue_meta_customer_campaign_status_change(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555501', 'ACTIVE'
  );
  if v_result->>'reason' is distinct from 'writes_frozen' then
    raise exception 'Customer Not-Aus must still block the button: %', v_result;
  end if;

  perform public.append_meta_kill_switch_state(
    'ACCOUNT',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    null, 'ALLOW', 'Customer status regression fixture', 'OPERATOR', 'test'
  );
end;
$$;

-- After a launch the account returns to its pre-launch write gate state.
do $$
declare
  v_round integer;
  v_prior text;
  v_plan_id uuid;
  v_mode text;
begin
  for v_round in 1..2 loop
    v_prior := case when v_round = 1 then 'ALLOW' else 'FREEZE_WRITES' end;
    perform public.append_meta_kill_switch_state(
      'ACCOUNT', '14000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001', null, v_prior,
      'Kunde hat den Schreibmodus gesetzt', 'CUSTOMER',
      '14000000-0000-4000-8000-000000000001'
    );
    perform public.append_meta_kill_switch_state(
      'ACCOUNT', '14000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001', null, 'FREEZE_WRITES',
      'Automatische Freeze-Phase für Kampagnen-Vorbereitung', 'CUSTOMER',
      '14000000-0000-4000-8000-000000000001'
    );
    perform public.append_meta_kill_switch_state(
      'ACCOUNT', '14000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001', null, 'ALLOW',
      'Exakt bestätigter atomarer Aktiv-Launch', 'CUSTOMER',
      '14000000-0000-4000-8000-000000000001'
    );
    if public.meta_account_pre_launch_kill_mode(
      '14000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001'
    ) is distinct from v_prior then
      raise exception 'Pre-launch mode must be %', v_prior;
    end if;

    v_plan_id := gen_random_uuid();
    insert into public.mutation_plans (
      id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
      source_rule_key, source_rule_version, action_type, target_type, target_key,
      idempotency_key, expected_before, intended_after, planned_payload,
      payload_hash, status, created_at
    ) values (
      v_plan_id,
      '14000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000001',
      '34000000-0000-4000-8000-000000000001',
      'active-launch-chain', 1, 'LAUNCH_CHAIN', 'CHAIN', 'launch:refreeze-' || v_round,
      public.meta_sha256('refreeze-' || v_round), '{}'::jsonb, '{}'::jsonb,
      '{}'::jsonb, public.meta_sha256('refreeze-payload-' || v_round),
      'PENDING', now()
    );
    update public.mutation_plans
    set status = 'SUCCEEDED', terminal_at = now(), updated_at = now()
    where id = v_plan_id;

    select kss.mode into v_mode
    from public.kill_switch_state kss
    where kss.scope_type = 'ACCOUNT'
      and kss.platform_account_id = '24000000-0000-4000-8000-000000000001'
    order by kss.sequence desc
    limit 1;
    if v_mode is distinct from (
      case when v_round = 1 then 'ALLOW' else 'FREEZE_WRITES' end
    ) then
      raise exception 'Launch round % (prior %) left the account %', v_round, v_prior, v_mode;
    end if;
  end loop;

  perform public.append_meta_kill_switch_state(
    'ACCOUNT', '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001', null, 'ALLOW',
    'Customer status regression fixture', 'OPERATOR', 'test'
  );
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

-- Automatic pause of a comparatively weak Adbot Lead campaign.
begin;

insert into auth.users (id, email)
values ('15000000-0000-4000-8000-000000000001', 'lead-pause@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_name, access_token,
  ad_account_ids, meta_scopes, marketing_meta_ad_account_id,
  marketing_currency, marketing_timezone_name, marketing_sync_status,
  marketing_sync_id, marketing_last_success_at, marketing_campaign_count,
  marketing_ad_set_count, marketing_ad_count, marketing_creative_count,
  marketing_insight_count, marketing_recommendation_count,
  marketing_insights_since, marketing_insights_until
) values (
  '25000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001',
  'meta', 'lead-pause', 'Lead Pause Meta', null,
  '["act_666666666666"]'::jsonb,
  array['ads_read','ads_management']::text[],
  '666666666666', 'EUR', 'Europe/Berlin', 'success',
  '35000000-0000-4000-8000-000000000001', now(),
  4, 4, 4, 0, 4, 0, current_date - 13, current_date
);

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  null,
  'ALLOW', 'Lead underperformer regression fixture', 'OPERATOR', 'test'
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
  true, true, true, true,
  '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
  repeat('f', 64), true, now(),
  '15000000-0000-4000-8000-000000000001', now()
);

-- n: 1 = reference (CPL 10), 2 = weak Adbot (CPL 45), 3 = weak but young,
-- 4 = weak but not launched by Adbot.
insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, start_time,
  last_seen_sync_id, last_seen_at, is_current
)
select
  ('45000000-0000-4000-8000-00000000000' || n)::uuid,
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '66666666660' || n, 'Lead ' || n, 'ACTIVE', 'ACTIVE', 'OUTCOME_LEADS', 2000,
  now() - case when n = 3 then interval '3 days' else interval '20 days' end,
  '35000000-0000-4000-8000-000000000001', now(), true
from generate_series(1, 4) n;

insert into public.ad_groups (
  id, user_id, platform_account_id, campaign_id, platform_ad_group_id,
  name, status, effective_status, optimization_goal, daily_budget_minor,
  lifetime_budget_minor, last_seen_sync_id, last_seen_at, is_current
)
select
  ('55000000-0000-4000-8000-00000000000' || n)::uuid,
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  ('45000000-0000-4000-8000-00000000000' || n)::uuid,
  '66666666670' || n, 'Ad Set ' || n, 'ACTIVE', 'ACTIVE', 'LEAD_GENERATION',
  null, null, '35000000-0000-4000-8000-000000000001', now(), true
from generate_series(1, 4) n;

insert into public.ads (
  id, user_id, platform_account_id, ad_group_id, platform_ad_id,
  name, status, effective_status, creative_id, platform_creative_id,
  last_seen_sync_id, last_seen_at, is_current
)
select
  ('75000000-0000-4000-8000-00000000000' || n)::uuid,
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  ('55000000-0000-4000-8000-00000000000' || n)::uuid,
  '66666666680' || n, 'Ad ' || n, 'ACTIVE', 'ACTIVE', null, null,
  '35000000-0000-4000-8000-000000000001', now(), true
from generate_series(1, 4) n;

insert into public.performance_data (
  entity_id, entity_type, date, impressions, clicks, spend, platform,
  user_id, platform_account_id, campaign_id, ad_group_id, ad_id, leads,
  currency, last_seen_sync_id
)
select
  ('75000000-0000-4000-8000-00000000000' || n)::uuid, 'ad', current_date - d,
  1000, 10,
  case n when 1 then 20 when 2 then 18 when 3 then 18 else 18 end,
  'meta',
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  ('45000000-0000-4000-8000-00000000000' || n)::uuid,
  ('55000000-0000-4000-8000-00000000000' || n)::uuid,
  ('75000000-0000-4000-8000-00000000000' || n)::uuid,
  case when n = 1 then 2 when d < 2 then 1 else 0 end,
  'EUR', '35000000-0000-4000-8000-000000000001'
from generate_series(1, 4) n, generate_series(0, 4) d;

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_reconciled_at
)
select
  ('56000000-0000-4000-8000-00000000000' || n)::uuid,
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  'CAMPAIGN', 'campaign:66666666660' || n, '66666666660' || n,
  'campaign:66666666660' || n, 'CAMPAIGN', 'campaign:66666666660' || n,
  ('45000000-0000-4000-8000-00000000000' || n)::uuid, 'MANAGED', now()
from generate_series(1, 4) n;

insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_rule_key, source_rule_version, action_type, target_type, target_key,
  idempotency_key, expected_before, intended_after, planned_payload,
  payload_hash, status, terminal_at, created_at
)
select
  ('b5000000-0000-4000-8000-00000000000' || n)::uuid,
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'active-launch-chain', 1, 'LAUNCH_CHAIN', 'CHAIN', 'launch:lead-' || n,
  repeat(n::text, 63) || 'a', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  repeat(n::text, 63) || 'b', 'SUCCEEDED', now() - interval '20 days',
  now() - interval '20 days'
from generate_series(1, 3) n;

insert into public.mutation_plan_steps (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, planned_request, request_hash,
  expected_result, compensation_operation, status
)
select
  ('c5000000-0000-4000-8000-00000000000' || n)::uuid,
  ('b5000000-0000-4000-8000-00000000000' || n)::uuid,
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001', 0, 'create-campaign',
  'CREATE', 'CAMPAIGN', '{}'::jsonb, repeat(n::text, 63) || 'c', '{}', 'NONE',
  'RECONCILED'
from generate_series(1, 3) n;

insert into public.remote_object_bindings (
  plan_id, step_id, user_id, platform_account_id, object_type,
  remote_object_id, request_fingerprint, local_campaign_id, reconciled_at
)
select
  ('b5000000-0000-4000-8000-00000000000' || n)::uuid,
  ('c5000000-0000-4000-8000-00000000000' || n)::uuid,
  '15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001', 'CAMPAIGN', '66666666660' || n,
  repeat(n::text, 63) || 'c',
  ('45000000-0000-4000-8000-00000000000' || n)::uuid, now()
from generate_series(1, 3) n;

do $$
declare
  v_result jsonb;
  v_plan public.mutation_plans%rowtype;
begin
  v_result := public.run_meta_lead_underperformer_pause(
    '15000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    now()
  );
  if v_result->>'outcome' <> 'CREATED'
    or v_result->>'campaign_id' <> '666666666602' then
    raise exception 'Weak Adbot Lead campaign was not paused: %', v_result;
  end if;

  select * into v_plan from public.mutation_plans
  where id = (v_result->>'plan_id')::uuid;
  if v_plan.action_type <> 'PAUSE'
    or v_plan.safety_action
    or v_plan.source_rule_key <> 'lead_underperformer_pause_v1'
    or (v_plan.planned_payload #>> '{evidence,reference_cpl}')::numeric <> 10
    or (v_plan.planned_payload #>> '{evidence,cpl}')::numeric <> 45
    or (v_plan.planned_payload #>> '{evidence,leads}')::integer <> 2 then
    raise exception 'Lead underperformer plan has the wrong shape: %', v_plan.planned_payload;
  end if;

  v_result := public.run_meta_lead_underperformer_pause(
    '15000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    now()
  );
  if v_result->>'reason' <> 'daily_pause_limit' then
    raise exception 'Only one automatic pause per day: %', v_result;
  end if;

  update public.mutation_plans
  set status = 'CANCELLED', terminal_at = now(), updated_at = now()
  where id = v_plan.id;
  update public.automation_policies
  set allow_status_changes = false
  where id = '85000000-0000-4000-8000-000000000001';
  v_result := public.run_meta_lead_underperformer_pause(
    '15000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    now()
  );
  if v_result->>'reason' <> 'status_changes_not_allowed' then
    raise exception 'Automatic pause needs allowed status changes: %', v_result;
  end if;
  update public.automation_policies
  set allow_status_changes = true
  where id = '85000000-0000-4000-8000-000000000001';

  -- Only the young and the non-Adbot campaign remain weak: nothing to pause.
  update public.campaigns
  set status = 'PAUSED', effective_status = 'PAUSED'
  where id = '45000000-0000-4000-8000-000000000002';
  v_result := public.run_meta_lead_underperformer_pause(
    '15000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    now()
  );
  if v_result->>'reason' <> 'no_underperformer' then
    raise exception 'Young or foreign campaigns must not be paused: %', v_result;
  end if;
end;
$$;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.run_meta_lead_underperformer_pause(uuid,uuid,timestamptz)',
    'execute'
  ) or has_function_privilege(
    'service_role',
    'public.queue_meta_campaign_status_plan_internal(uuid,uuid,uuid,text,text,jsonb,text,text,timestamptz)',
    'execute'
  ) then
    raise exception 'Lead underperformer RPC privileges are incorrect';
  end if;
end;
$$;

rollback;

select 'Meta customer campaign status checks passed' as result;

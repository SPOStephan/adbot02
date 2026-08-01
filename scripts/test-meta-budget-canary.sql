\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values
  ('14000000-0000-4000-8000-000000000001', 'canary-owner@example.test'),
  ('14000000-0000-4000-8000-000000000002', 'canary-other@example.test');

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
    '24000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',
    'meta', 'canary-owner', '555555555555', 'Canary Owner Meta',
    null, 'ciphertext', 'iv', 'auth-tag',
    '["act_555555555555"]'::jsonb,
    array['ads_read','ads_management']::text[],
    now() + interval '30 days', now() + interval '30 days',
    '555555555555', 'EUR', 'Europe/Berlin', 'success',
    '34000000-0000-4000-8000-000000000001', now(),
    2, 0, 0, 0, 0, 1, current_date - 13, current_date
  ),
  (
    '24000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000002',
    'meta', 'canary-other', '666666666666', 'Canary Other Meta',
    null, 'ciphertext-2', 'iv-2', 'auth-tag-2',
    '["act_666666666666"]'::jsonb,
    array['ads_read','ads_management']::text[],
    now() + interval '30 days', now() + interval '30 days',
    '666666666666', 'EUR', 'Europe/Berlin', 'success',
    '34000000-0000-4000-8000-000000000002', now(),
    0, 0, 0, 0, 0, 0, current_date - 13, current_date
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
    '555555555555', 'Canary Campaign One', 'ACTIVE', 'ACTIVE',
    'OUTCOME_SALES', 2000,
    '34000000-0000-4000-8000-000000000001', now(), true
  ),
  (
    '44000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '555555555556', 'Canary Campaign Two', 'ACTIVE', 'ACTIVE',
    'OUTCOME_TRAFFIC', 3000,
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
  true, false, false, true,
  '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
  repeat('a', 64), true, now(),
  '14000000-0000-4000-8000-000000000001', now()
);

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_reconciled_at
) values (
  '54000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  'CAMPAIGN', 'campaign:555555555555', '555555555555',
  'campaign:555555555555', 'CAMPAIGN', 'campaign:555555555555',
  '44000000-0000-4000-8000-000000000001', 'MANAGED', now()
);

select * from public.set_meta_customer_automation_scope(
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  'CAMPAIGN',
  '44000000-0000-4000-8000-000000000001',
  'MANAGED',
  'Budget canary regression campaign selection'
);

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  null,
  'ALLOW',
  'Budget canary regression fixture',
  'OPERATOR',
  'test'
);

insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_rule_key, source_rule_version, action_type, target_type, target_key,
  campaign_scope_key, budget_owner_key, automation_target_id,
  idempotency_key, expected_before, intended_after, planned_payload,
  payload_hash, status, priority, safety_action, not_before, max_attempts
) values (
  'a4000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001',
  'spend_without_results_14d', 1, 'UPDATE_BUDGET', 'CAMPAIGN',
  'campaign:555555555555', 'campaign:555555555555',
  'campaign:555555555555',
  '54000000-0000-4000-8000-000000000001',
  repeat('f', 64),
  '{"daily_budget_minor":2000,"status":"ACTIVE"}'::jsonb,
  '{"daily_budget_minor":1600}'::jsonb,
  '{"schema_version":1,"operation":"UPDATE_BUDGET","object_type":"CAMPAIGN","object_id":"555555555555","amount_minor":1600,"direction":"DECREASE","change_bps":2000}'::jsonb,
  repeat('e', 64), 'PENDING', 80, false, now(), 5
);

do $$
declare
  v_effective record;
  v_claim_count integer;
begin
  if (select not_before from public.mutation_plans
      where id = 'a4000000-0000-4000-8000-000000000001')
      <> 'infinity'::timestamptz then
    raise exception 'Unapproved budget plan was not held outside the executor';
  end if;

  select * into v_effective
  from public.get_effective_meta_kill_switch(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001'
  );

  if v_effective.mode <> 'FREEZE_WRITES'
    or v_effective.scope_type <> 'PLAN'
    or v_effective.reason <> 'Budget-Canary wartet auf exakte Kundenbestätigung' then
    raise exception 'Unapproved budget plan did not receive a plan freeze';
  end if;

  select count(*) into v_claim_count
  from public.claim_next_meta_mutation_execution('canary-worker-before-approval', 300);

  if v_claim_count <> 0 then
    raise exception 'Unapproved budget plan became claimable';
  end if;

  if (select count(*) from public.mutation_audit_events
      where plan_id = 'a4000000-0000-4000-8000-000000000001'
        and event_type = 'BUDGET_CANARY_CONFIRMATION_REQUIRED') <> 1 then
    raise exception 'Budget canary hold was not audited exactly once';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '14000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(*) from public.list_meta_budget_canary_plans(
      '24000000-0000-4000-8000-000000000001')) <> 1 then
    raise exception 'Tenant budget canary list did not expose one sanitized plan';
  end if;
end;
$$;

reset role;

-- A changed amount or hash must never confirm the immutable plan.
do $$
begin
  begin
    perform * from public.approve_meta_budget_canary_plan(
      '14000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      repeat('e', 64), 2000, 1500,
      'Deliberately mismatched confirmation'
    );
    raise exception 'Mismatched canary amount was accepted';
  exception
    when others then
      if sqlerrm = 'Mismatched canary amount was accepted' then raise; end if;
      if sqlerrm <> 'Budget canary confirmation fingerprint mismatch' then raise; end if;
  end;
end;
$$;

create temporary table first_canary_approval on commit drop as
select * from public.approve_meta_budget_canary_plan(
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  repeat('e', 64), 2000, 1600,
  'Kunde bestätigt exakt diesen einzelnen Budget-Canary'
);

do $$
declare
  v_effective record;
  v_first record;
  v_replay record;
begin
  select * into v_first from first_canary_approval;

  if v_first.plan_status <> 'PENDING'
    or v_first.executable_at > now()
    or (select not_before from public.mutation_plans
        where id = 'a4000000-0000-4000-8000-000000000001') > now() then
    raise exception 'Approved budget canary did not become executable';
  end if;

  select * into v_effective
  from public.get_effective_meta_kill_switch(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001'
  );

  if v_effective.mode <> 'ALLOW' then
    raise exception 'Approved budget canary retained a plan freeze';
  end if;

  select * into v_replay
  from public.approve_meta_budget_canary_plan(
    '14000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    repeat('e', 64), 2000, 1600,
    'Kunde bestätigt exakt diesen einzelnen Budget-Canary'
  );

  if v_replay.approval_id <> v_first.approval_id
    or (select count(*) from public.meta_budget_canary_approvals
        where plan_id = 'a4000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Budget canary confirmation was not idempotent';
  end if;

  if (select count(*) from public.mutation_audit_events
      where plan_id = 'a4000000-0000-4000-8000-000000000001'
        and event_type = 'BUDGET_CANARY_PLAN_APPROVED') <> 1 then
    raise exception 'Budget canary approval audit is not exactly once';
  end if;
end;
$$;

-- A second managed budget owner blocks every new canary approval.
insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_reconciled_at
) values (
  '54000000-0000-4000-8000-000000000002',
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  'CAMPAIGN', 'campaign:555555555556', '555555555556',
  'campaign:555555555556', 'CAMPAIGN', 'campaign:555555555556',
  '44000000-0000-4000-8000-000000000002', 'MANAGED', now()
);

select * from public.set_meta_customer_automation_scope(
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  'CAMPAIGN',
  '44000000-0000-4000-8000-000000000002',
  'MANAGED',
  'Second budget owner for canary boundary test'
);

insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_rule_key, source_rule_version, action_type, target_type, target_key,
  campaign_scope_key, budget_owner_key, automation_target_id,
  idempotency_key, expected_before, intended_after, planned_payload,
  payload_hash, status, priority, safety_action, not_before, max_attempts
) values (
  'a4000000-0000-4000-8000-000000000002',
  '14000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001',
  'cost_per_result_up_30pct', 1, 'UPDATE_BUDGET', 'CAMPAIGN',
  'campaign:555555555556', 'campaign:555555555556',
  'campaign:555555555556',
  '54000000-0000-4000-8000-000000000002',
  repeat('d', 64),
  '{"daily_budget_minor":3000,"status":"ACTIVE"}'::jsonb,
  '{"daily_budget_minor":2400}'::jsonb,
  '{"schema_version":1,"operation":"UPDATE_BUDGET","object_type":"CAMPAIGN","object_id":"555555555556","amount_minor":2400,"direction":"DECREASE","change_bps":2000}'::jsonb,
  repeat('c', 64), 'PENDING', 75, false, now(), 5
);

do $$
begin
  begin
    perform * from public.approve_meta_budget_canary_plan(
      '14000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000002',
      repeat('c', 64), 3000, 2400,
      'Second managed budget owner must block this canary'
    );
    raise exception 'Second managed budget owner was accepted';
  exception
    when others then
      if sqlerrm = 'Second managed budget owner was accepted' then raise; end if;
      if sqlerrm <> 'Exactly one managed budget owner is required for the canary' then raise; end if;
  end;

  if has_function_privilege(
      'authenticated',
      'public.approve_meta_budget_canary_plan(uuid,uuid,uuid,text,bigint,bigint,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.approve_meta_budget_canary_plan(uuid,uuid,uuid,text,bigint,bigint,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.list_meta_budget_canary_plans(uuid)',
      'EXECUTE'
    ) then
    raise exception 'Budget canary RPC privileges are incorrect';
  end if;

  if has_table_privilege(
      'authenticated', 'public.meta_budget_canary_approvals', 'INSERT'
    )
    or has_table_privilege(
      'authenticated', 'public.meta_account_write_modes', 'UPDATE'
    ) then
    raise exception 'Budget canary table privileges are too broad';
  end if;
end;
$$;

rollback;

select 'Meta budget canary checks passed' as result;

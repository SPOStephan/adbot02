\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'other@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_name, access_token,
  meta_scopes, ad_account_ids, marketing_meta_ad_account_id, marketing_currency,
  marketing_timezone_name, marketing_sync_status, marketing_sync_id,
  marketing_last_success_at
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'meta', 'meta-owner', 'Owner Meta Account', null,
    array['ads_read']::text[], '["act_111"]'::jsonb, '111', 'EUR', 'Europe/Berlin', 'success',
    '30000000-0000-4000-8000-000000000001', now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'meta', 'meta-other', 'Other Meta Account', null,
    array['ads_read','ads_management']::text[], '["act_222"]'::jsonb, '222', 'EUR', 'Europe/Berlin', 'success',
    '30000000-0000-4000-8000-000000000002', now()
  );

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, last_seen_sync_id
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'campaign-owner', 'Owner Campaign', 'ACTIVE', 'ACTIVE',
    'OUTCOME_SALES', 2000, '30000000-0000-4000-8000-000000000001'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'campaign-other', 'Other Campaign', 'ACTIVE', 'ACTIVE',
    'OUTCOME_TRAFFIC', 1000, '30000000-0000-4000-8000-000000000002'
  );

insert into public.ad_groups (
  id, user_id, platform_account_id, campaign_id, platform_ad_group_id,
  name, status, effective_status, daily_budget_minor, last_seen_sync_id
) values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'adset-owner', 'Owner Ad Set', 'ACTIVE', 'ACTIVE', 2000,
  '30000000-0000-4000-8000-000000000001'
);

insert into public.ads (
  id, user_id, platform_account_id, ad_group_id, platform_ad_id,
  name, status, effective_status, last_seen_sync_id
) values (
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'ad-owner', 'Owner Ad', 'ACTIVE', 'ACTIVE',
  '30000000-0000-4000-8000-000000000001'
);

-- Active autonomy is impossible without customer-confirmed EUR caps.
do $$
begin
  begin
    insert into public.automation_policies (
      id, user_id, platform_account_id, version, status, policy_hash,
      is_current, activated_at
    ) values (
      '80000000-0000-4000-8000-000000000099',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      99, 'ACTIVE', repeat('9', 64), true, now()
    );
    raise exception 'ACTIVE policy without customer caps was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;

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
    '80000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    1, 'ACTIVE', 'EUR', 10000, 5000, 2000, 43200, 17500, 21000,
    true, true, true, true,
    '{"campaign_objectives":"ALL","regions":"ALL"}'::jsonb,
    repeat('a', 64), true, now(),
    '10000000-0000-4000-8000-000000000001', now()
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    1, 'READY', 'EUR', 5000, 2500, 2000, 43200, 17500, 21000,
    true, true, true, true, '{}'::jsonb, repeat('b', 64), true,
    now(), '10000000-0000-4000-8000-000000000002', null
  );

-- Customer controls create one immutable current version, survive response
-- retries idempotently and never permit a cross-tenant account reference.
savepoint customer_control_rpc_test;

do $$
declare
  v_policy_id uuid;
  v_replay_id uuid;
  v_kill_switch_id uuid;
begin
  begin
    perform public.put_meta_customer_policy_version(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      10000,
      5000,
      true,
      true,
      true,
      true
    );
    raise exception 'Active policy without ads_management was accepted';
  exception
    when others then
      if sqlerrm = 'Active policy without ads_management was accepted' then raise; end if;
  end;

  begin
    perform public.set_meta_customer_kill_switch(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'ALLOW',
      'Writes trotz fehlendem Scope freigeben'
    );
    raise exception 'ALLOW without ads_management was accepted';
  exception
    when others then
      if sqlerrm = 'ALLOW without ads_management was accepted' then raise; end if;
  end;

  perform public.set_meta_customer_kill_switch(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'FREEZE_WRITES',
    'Scope fehlt, deshalb Writes sicher einfrieren'
  );

  select public.put_meta_customer_policy_version(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    12000,
    4000,
    true,
    true,
    true,
    true
  ) into v_policy_id;

  select public.put_meta_customer_policy_version(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    12000,
    4000,
    true,
    true,
    true,
    true
  ) into v_replay_id;

  if v_policy_id is distinct from v_replay_id
    or not exists (
      select 1
      from public.automation_policies ap
      where ap.id = v_policy_id
        and ap.version = 2
        and ap.status = 'ACTIVE'
        and ap.is_current
        and ap.currency = 'EUR'
        and ap.account_daily_hard_cap_minor = 12000
        and ap.default_campaign_daily_hard_cap_minor = 4000
        and ap.budget_change_limit_bps = 2000
        and ap.cooldown_seconds = 43200
        and ap.allow_budget_changes
        and ap.allow_status_changes
        and ap.allow_new_launches
        and ap.require_verified_domain
        and ap.customer_confirmed_by = '10000000-0000-4000-8000-000000000002'
    )
    or (select count(*) from public.automation_policies
        where platform_account_id = '20000000-0000-4000-8000-000000000002'
          and is_current) <> 1
    or (select count(*) from public.mutation_audit_events
        where platform_account_id = '20000000-0000-4000-8000-000000000002'
          and event_type = 'POLICY_ACTIVATED') <> 1 then
    raise exception 'Customer policy RPC is not versioned or idempotent';
  end if;

  begin
    perform public.put_meta_customer_policy_version(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      12000,
      4000,
      true,
      true,
      true,
      true
    );
    raise exception 'Cross-tenant customer policy was accepted';
  exception
    when others then
      if sqlerrm = 'Cross-tenant customer policy was accepted' then raise; end if;
  end;

  begin
    perform public.put_meta_customer_policy_version(
      '10000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000002',
      12000,
      4000,
      true,
      false,
      true,
      true
    );
    raise exception 'Active launch without status permission was accepted';
  exception
    when others then
      if sqlerrm = 'Active launch without status permission was accepted' then raise; end if;
  end;

  select public.set_meta_customer_kill_switch(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'FREEZE_WRITES',
    'Kundenseitiger Sicherheitsstopp im Dashboard'
  ) into v_kill_switch_id;

  if not exists (
      select 1 from public.kill_switch_state ks
      where ks.id = v_kill_switch_id
        and ks.scope_type = 'ACCOUNT'
        and ks.mode = 'FREEZE_WRITES'
        and ks.actor_type = 'CUSTOMER'
    )
    or not exists (
      select 1 from public.mutation_audit_events mae
      where mae.platform_account_id = '20000000-0000-4000-8000-000000000002'
        and mae.event_type = 'KILL_SWITCH_CHANGED'
    ) then
    raise exception 'Customer kill-switch command is incomplete';
  end if;
end;
$$;

rollback to savepoint customer_control_rpc_test;
release savepoint customer_control_rpc_test;

-- Policy constraints may be stricter than customer input, never looser.
do $$
begin
  begin
    insert into public.automation_policies (
      id, user_id, platform_account_id, previous_policy_id, version, status,
      account_daily_hard_cap_minor, default_campaign_daily_hard_cap_minor,
      budget_change_limit_bps, cooldown_seconds,
      shared_budget_flex_spend_multiplier_bps, policy_hash, is_current
    ) values (
      '80000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      2, 'READY', 10000, 5000, 2001, 43199, 20999,
      repeat('c', 64), false
    );
    raise exception 'Policy accepted safety settings below required floor';
  exception
    when check_violation then null;
  end;
end;
$$;

insert into public.allowed_domains (
  id, user_id, platform_account_id, hostname, registrable_domain,
  expected_redirect_hostname, observed_redirect_hostname, status,
  verification_method, verification_evidence, customer_confirmed_at,
  customer_confirmed_by, verified_at
) values (
  '81000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'shop.example.test', 'example.test', 'shop.example.test',
  'shop.example.test', 'VERIFIED', 'HTTPS_REDIRECT',
  '{"status_code":200}'::jsonb, now(),
  '10000000-0000-4000-8000-000000000001', now()
);

insert into public.objective_blueprints (
  id, user_id, platform_account_id, objective, version, name, status,
  payload_template, required_inputs, compliance_rules, blueprint_hash,
  customer_confirmed_at, customer_confirmed_by, activated_at
) values (
  '82000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'OUTCOME_SALES', 1, 'Sales v1', 'ACTIVE',
  '{"objective":"OUTCOME_SALES"}'::jsonb,
  '["destination_url","page_id"]'::jsonb,
  '{"verified_domain":true}'::jsonb, repeat('d', 64), now(),
  '10000000-0000-4000-8000-000000000001', now()
);

insert into public.brand_assets (
  id, user_id, platform_account_id, source_type, original_filename,
  sha256, mime_type, byte_size, width, height, brand_policy_version,
  moderation_status, status, metadata, reviewed_at, reviewed_by
) values (
  '83000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'UPLOADED', 'approved-brand.png', repeat('e', 64), 'image/png',
  1024, 1200, 1200, 1, 'APPROVED', 'READY',
  '{"purpose":"meta_ad"}'::jsonb, now(),
  '10000000-0000-4000-8000-000000000001'
);

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, ad_group_id, ad_id, status
) values (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'AD_SET', 'adset:adset-owner', 'adset-owner',
  'campaign:campaign-owner', 'AD_SET', 'adset:adset-owner',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', null, 'MANAGED'
);

insert into public.campaign_budget_limits (
  id, user_id, platform_account_id, policy_id, campaign_scope_key,
  campaign_id, daily_hard_cap_minor, customer_confirmed_at,
  customer_confirmed_by
) values (
  '84000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  'campaign:campaign-owner',
  '40000000-0000-4000-8000-000000000001',
  6000, now(), '10000000-0000-4000-8000-000000000001'
);

insert into public.daily_budget_exposure_snapshots (
  id, user_id, platform_account_id, policy_id, account_day,
  account_timezone_name, source_marketing_sync_id, currency, status,
  observed_budget_owner_count, completed_at
) values (
  '90000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  current_date, 'Europe/Berlin',
  '30000000-0000-4000-8000-000000000001',
  'EUR', 'COMPLETE', 1, now()
);

insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  action_type, target_type, target_key, campaign_scope_key,
  budget_owner_key, automation_target_id, idempotency_key,
  expected_before, intended_after, planned_payload, payload_hash,
  validation_fingerprint, validated_at, status, priority
) values (
  'a0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'UPDATE_BUDGET', 'AD_SET', 'adset:adset-owner',
  'campaign:campaign-owner', 'adset:adset-owner',
  '70000000-0000-4000-8000-000000000001',
  repeat('1', 64), '{"daily_budget":2000}'::jsonb,
  '{"daily_budget":2200}'::jsonb,
  '{"daily_budget":"2200"}'::jsonb, repeat('2', 64),
  repeat('3', 64), now(), 'PENDING', 50
);

insert into public.mutation_plan_steps (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, planned_request, request_hash,
  expected_result, compensation_operation, status,
  validation_fingerprint, validated_at
) values (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  0, 'update-budget', 'UPDATE', 'AD_SET',
  '{"daily_budget":"2200"}'::jsonb, repeat('4', 64),
  '{"daily_budget":"2200"}'::jsonb, 'PAUSE', 'VALIDATED',
  repeat('5', 64), now()
);

insert into public.mutation_executions (
  id, plan_id, user_id, platform_account_id, attempt_number,
  worker_id, lease_token, status, started_at, last_heartbeat_at, finished_at
) values (
  'c0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1, 'test-worker', 'd0000000-0000-4000-8000-000000000001',
  'SUCCEEDED', now() - interval '1 minute', now(), now()
);

insert into public.budget_mutation_ledger (
  id, user_id, platform_account_id, policy_id, plan_id, step_id,
  execution_id, automation_target_id, budget_owner_key, currency,
  before_budget_minor, after_budget_minor, remote_request_id,
  executed_at, reconciled_at
) values (
  'e0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'adset:adset-owner', 'EUR', 2000, 2200, 'request-1',
  now() - interval '30 seconds', now()
);

-- Core Flexspend and exposure behavior.
do $$
declare
  exposure_result record;
begin
  if public.meta_calculate_exposure_minor(1000, 17500) <> 1750
    or public.meta_calculate_exposure_minor(1000, 21000) <> 2100
    or public.meta_calculate_exposure_minor(1, 17500) <> 2 then
    raise exception 'Flex-spend exposure calculation is incorrect';
  end if;

  select * into exposure_result
  from public.reserve_meta_daily_budget_exposure(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    current_date, 'campaign:campaign-owner', 'adset:adset-owner',
    'AD_SET', false, 'EUR', 2000, 17500, 'PLAN'
  );

  if exposure_result.owner_reserved_exposure_minor <> 3500
    or exposure_result.campaign_reserved_exposure_minor <> 3500
    or exposure_result.account_reserved_exposure_minor <> 3500 then
    raise exception 'Initial normal exposure reservation is incorrect';
  end if;

  perform public.reserve_meta_daily_budget_exposure(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001', null, null,
    current_date, 'campaign:campaign-owner', 'adset:adset-owner',
    'AD_SET', false, 'EUR', 1000, 17500, 'RECONCILIATION'
  );

  if (select max_daily_budget_minor from public.daily_budget_exposures
      where budget_owner_key = 'adset:adset-owner') <> 2000 then
    raise exception 'Same-day budget decrease lowered reserved exposure';
  end if;

  perform public.reserve_meta_daily_budget_exposure(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001', null, null,
    current_date, 'campaign:campaign-owner', 'adset:second',
    'AD_SET', false, 'EUR', 1000, 17500, 'SNAPSHOT'
  );

  if (select sum(reserved_exposure_minor) from public.daily_budget_exposures
      where campaign_scope_key = 'campaign:campaign-owner') <> 5250 then
    raise exception 'Campaign exposure aggregation is incorrect';
  end if;

  -- Equality with the 6,000 campaign cap is valid. Force a nested rollback
  -- afterwards so the following assertion can test exactly one minor unit over.
  begin
    select * into exposure_result
    from public.reserve_meta_daily_budget_exposure(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', null, null,
      current_date, 'campaign:campaign-owner', 'adset:campaign-cap-exact',
      'AD_SET', false, 'EUR', 357, 21000, 'PLAN'
    );
    if exposure_result.campaign_reserved_exposure_minor <> 6000 then
      raise exception 'Exact campaign hard cap was not accepted';
    end if;
    raise exception 'Rollback exact campaign cap fixture';
  exception
    when others then
      if sqlerrm <> 'Rollback exact campaign cap fixture' then raise; end if;
  end;

  begin
    perform public.reserve_meta_daily_budget_exposure(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', null, null,
      current_date, 'campaign:campaign-owner', 'adset:campaign-cap-plus-one',
      'AD_SET', false, 'EUR', 429, 17500, 'PLAN'
    );
    raise exception 'Campaign hard cap overrun was accepted';
  exception
    when others then
      if sqlerrm = 'Campaign hard cap overrun was accepted' then raise; end if;
  end;

  begin
    perform public.reserve_meta_daily_budget_exposure(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', null, null,
      current_date, 'campaign:shared', 'campaign:shared',
      'CAMPAIGN', true, 'EUR', 2000, 17500, 'PLAN'
    );
    raise exception 'Shared budget accepted a multiplier below 2.10';
  exception
    when others then
      if sqlerrm = 'Shared budget accepted a multiplier below 2.10' then raise; end if;
  end;

  perform public.reserve_meta_daily_budget_exposure(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001', null, null,
    current_date, 'campaign:shared', 'campaign:shared',
    'CAMPAIGN', true, 'EUR', 2000, 21000, 'PLAN'
  );

  if (select sum(reserved_exposure_minor) from public.daily_budget_exposures) <> 9450 then
    raise exception 'Shared-budget 2.10 exposure was not reserved';
  end if;

  -- Equality with the 10,000 account cap is valid and remains transactional.
  begin
    select * into exposure_result
    from public.reserve_meta_daily_budget_exposure(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', null, null,
      current_date, 'campaign:account-cap-exact', 'adset:account-cap-exact',
      'AD_SET', false, 'EUR', 314, 17500, 'PLAN'
    );
    if exposure_result.account_reserved_exposure_minor <> 10000 then
      raise exception 'Exact account hard cap was not accepted';
    end if;
    raise exception 'Rollback exact account cap fixture';
  exception
    when others then
      if sqlerrm <> 'Rollback exact account cap fixture' then raise; end if;
  end;

  begin
    perform public.reserve_meta_daily_budget_exposure(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', null, null,
      current_date, 'campaign:account-cap-plus-one', 'campaign:account-cap-plus-one',
      'CAMPAIGN', true, 'EUR', 262, 21000, 'PLAN'
    );
    raise exception 'Account hard cap overrun was accepted';
  exception
    when others then
      if sqlerrm = 'Account hard cap overrun was accepted' then raise; end if;
  end;

  if (select count(*) from public.daily_budget_exposures) <> 3
    or (select sum(reserved_exposure_minor) from public.daily_budget_exposures) <> 9450 then
    raise exception 'Rejected exposure changed committed reservations';
  end if;
end;
$$;

-- Exposure, plan intent and reconciled ledgers are monotone/immutable.
do $$
begin
  begin
    update public.daily_budget_exposures
    set max_daily_budget_minor = 1000
    where budget_owner_key = 'adset:adset-owner';
    raise exception 'Exposure decrease was accepted';
  exception
    when others then
      if sqlerrm = 'Exposure decrease was accepted' then raise; end if;
  end;

  begin
    update public.mutation_plans
    set intended_after = '{"daily_budget":2300}'::jsonb
    where id = 'a0000000-0000-4000-8000-000000000001';
    raise exception 'Mutation plan intent update was accepted';
  exception
    when others then
      if sqlerrm = 'Mutation plan intent update was accepted' then raise; end if;
  end;

  begin
    update public.budget_mutation_ledger
    set after_budget_minor = 2100
    where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'Budget ledger update was accepted';
  exception
    when others then
      if sqlerrm = 'Budget ledger update was accepted' then raise; end if;
  end;

  begin
    delete from public.budget_mutation_ledger
    where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'Budget ledger delete was accepted';
  exception
    when others then
      if sqlerrm = 'Budget ledger delete was accepted' then raise; end if;
  end;
end;
$$;

-- Shared account lease prevents read sync and write execution overlap.
do $$
declare
  first_token uuid;
  second_token uuid;
begin
  first_token := public.claim_meta_account_operation(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'READ_SYNC', 'read-worker', 300
  );
  second_token := public.claim_meta_account_operation(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'WRITE_EXECUTION', 'write-worker', 300
  );

  if first_token is null or second_token is not null then
    raise exception 'Shared account lease allowed overlapping operations';
  end if;

  if public.heartbeat_meta_account_operation(
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001', gen_random_uuid(), 300
    ) then
    raise exception 'Wrong account lease token renewed the lease';
  end if;

  if not public.release_meta_account_operation(
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001', first_token
    ) then
    raise exception 'Correct account lease token could not release lease';
  end if;

  second_token := public.claim_meta_account_operation(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'WRITE_EXECUTION', 'write-worker', 300
  );
  if second_token is null then
    raise exception 'Released account lease could not be reacquired';
  end if;
end;
$$;

-- Hash-chained, secret-sanitized audit stream and append-only kill switches.
select * from public.append_meta_mutation_audit_event(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'EXECUTOR', 'test-worker', 'REMOTE_WRITE_RECONCILED',
  '{"daily_budget":2000}'::jsonb,
  '{"daily_budget":"2200"}'::jsonb,
  '{"success":true}'::jsonb,
  '{"daily_budget":2200}'::jsonb,
  '{"request_fingerprint":"safe"}'::jsonb,
  'meta', null, null, 'request-1', null, now()
);

select * from public.append_meta_mutation_audit_event(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  null, null, 'RECONCILER', 'test-reconciler', 'PLAN_SUCCEEDED',
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  '{"status":"SUCCEEDED"}'::jsonb, '{}'::jsonb,
  'meta', null, null, null, null, now()
);

do $$
declare
  audit_count integer;
  broken_links integer;
begin
  select count(*) into audit_count
  from public.mutation_audit_events
  where platform_account_id = '20000000-0000-4000-8000-000000000001';

  select count(*) into broken_links
  from (
    select previous_event_hash,
      lag(event_hash) over (order by event_sequence) as expected_previous
    from public.mutation_audit_events
    where platform_account_id = '20000000-0000-4000-8000-000000000001'
  ) chain
  where previous_event_hash is distinct from expected_previous;

  if audit_count <> 2 or broken_links <> 0 then
    raise exception 'Audit hash chain is incomplete';
  end if;

  begin
    perform public.append_meta_mutation_audit_event(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', null, null, null, null,
      'SYSTEM', 'test', 'SECRET_REJECTED', '{}'::jsonb,
      '{"access_token":"must-never-persist"}'::jsonb,
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      null, null, null, null, null, now()
    );
    raise exception 'Audit secret key was accepted';
  exception
    when others then
      if sqlerrm = 'Audit secret key was accepted' then raise; end if;
  end;

  begin
    update public.mutation_audit_events set actor_id = 'tampered'
    where event_sequence = (
      select min(event_sequence) from public.mutation_audit_events
    );
    raise exception 'Audit event update was accepted';
  exception
    when others then
      if sqlerrm = 'Audit event update was accepted' then raise; end if;
  end;
end;
$$;

-- Missing kill-switch state is fail-closed. No account becomes writable merely
-- because no customer or operator event has been persisted yet.
do $$
declare effective record;
begin
  select * into effective from public.get_effective_meta_kill_switch(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001'
  );
  if effective.mode <> 'FREEZE_WRITES'
    or effective.scope_type <> 'ACCOUNT'
    or effective.event_id is not null
  then
    raise exception 'Missing kill-switch state did not fail closed';
  end if;
end;
$$;

-- A narrow plan-level ALLOW must not implicitly enable the whole account.
select public.append_meta_kill_switch_state(
  'PLAN',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'ALLOW', 'Plan acknowledgement', 'OPERATOR', 'operator'
);

do $$
declare effective record;
begin
  select * into effective from public.get_effective_meta_kill_switch(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001'
  );
  if effective.mode <> 'FREEZE_WRITES'
    or effective.scope_type <> 'ACCOUNT'
    or effective.event_id is not null
  then
    raise exception 'Plan ALLOW implicitly enabled the account';
  end if;
end;
$$;

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', null,
  'FREEZE_WRITES', 'Customer freeze', 'CUSTOMER', 'owner'
);

do $$
declare effective record;
begin
  select * into effective from public.get_effective_meta_kill_switch(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001'
  );
  if effective.mode <> 'FREEZE_WRITES' or effective.scope_type <> 'ACCOUNT' then
    raise exception 'Account kill switch did not become effective';
  end if;
end;
$$;

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', null,
  'ALLOW', 'Customer resume', 'CUSTOMER', 'owner'
);

do $$
declare effective record;
begin
  select * into effective from public.get_effective_meta_kill_switch(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001'
  );
  if effective.mode <> 'ALLOW'
    or effective.scope_type <> 'ACCOUNT'
    or effective.event_id is null
  then
    raise exception 'Explicit account ALLOW did not open the write gate';
  end if;
end;
$$;

select public.append_meta_kill_switch_state(
  'PLAN',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'PAUSE_MANAGED', 'Plan safety pause', 'SYSTEM', 'executor'
);
select public.append_meta_kill_switch_state(
  'SYSTEM', null, null, null,
  'FREEZE_WRITES', 'System maintenance', 'OPERATOR', 'operator'
);

do $$
declare effective record;
begin
  select * into effective from public.get_effective_meta_kill_switch(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001'
  );
  if effective.mode <> 'FREEZE_WRITES' or effective.scope_type <> 'SYSTEM' then
    raise exception 'System kill switch did not override narrower scope';
  end if;

  begin
    delete from public.kill_switch_state where scope_type = 'SYSTEM';
    raise exception 'Kill-switch event delete was accepted';
  exception
    when others then
      if sqlerrm = 'Kill-switch event delete was accepted' then raise; end if;
  end;
end;
$$;

-- Cross-tenant service-code mistakes are rejected before persistence.
do $$
begin
  begin
    insert into public.allowed_domains (
      user_id, platform_account_id, hostname, registrable_domain, status
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'cross.example.test', 'example.test', 'PENDING'
    );
    raise exception 'Cross-tenant account reference was accepted';
  exception
    when others then
      if sqlerrm = 'Cross-tenant account reference was accepted' then raise; end if;
  end;

  begin
    insert into public.automation_targets (
      user_id, platform_account_id, target_type, target_key,
      platform_object_id, campaign_scope_key, campaign_id, status
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'CAMPAIGN', 'campaign:other', 'campaign-other', 'campaign:other',
      '40000000-0000-4000-8000-000000000002', 'MANAGED'
    );
    raise exception 'Cross-tenant local object reference was accepted';
  exception
    when others then
      if sqlerrm = 'Cross-tenant local object reference was accepted' then raise; end if;
  end;
end;
$$;

-- Browser roles are read-only, tenant-filtered and cannot see lease internals.
do $$
begin
  if has_table_privilege('anon', 'public.automation_policies', 'SELECT')
    or has_table_privilege('authenticated', 'public.automation_policies', 'INSERT')
    or has_table_privilege('authenticated', 'public.mutation_plans', 'UPDATE')
    or has_table_privilege('authenticated', 'public.kill_switch_state', 'DELETE')
    or has_table_privilege('authenticated', 'public.meta_account_operation_leases', 'SELECT')
    or not has_column_privilege(
      'authenticated', 'public.automation_policies', 'id', 'SELECT'
    )
    or has_column_privilege(
      'authenticated', 'public.automation_policies', 'policy_payload', 'SELECT'
    )
    or has_column_privilege(
      'authenticated', 'public.mutation_plans', 'planned_payload', 'SELECT'
    ) then
    raise exception 'Browser Control Plane grants are incorrect';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.reserve_meta_daily_budget_exposure(uuid,uuid,uuid,uuid,uuid,uuid,date,text,text,text,boolean,text,bigint,integer,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.append_meta_kill_switch_state(text,uuid,uuid,uuid,text,text,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.reserve_meta_daily_budget_exposure(uuid,uuid,uuid,uuid,uuid,uuid,date,text,text,text,boolean,text,bigint,integer,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.claim_meta_account_operation(uuid,uuid,text,text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.put_meta_customer_policy_version(uuid,uuid,bigint,bigint,boolean,boolean,boolean,boolean)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.set_meta_customer_kill_switch(uuid,uuid,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.put_meta_customer_policy_version(uuid,uuid,bigint,bigint,boolean,boolean,boolean,boolean)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.set_meta_customer_kill_switch(uuid,uuid,text,text)',
      'EXECUTE'
    ) then
    raise exception 'Control Plane RPC grants are incorrect';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(id) from public.automation_policies) <> 1
    or (select count(id) from public.allowed_domains) <> 1
    or (select count(id) from public.objective_blueprints) <> 1
    or (select count(id) from public.brand_assets) <> 1
    or (select count(id) from public.mutation_plans) <> 1
    or (select count(event_sequence) from public.mutation_audit_events) < 4 then
    raise exception 'Owner cannot read own Control Plane rows';
  end if;
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

do $$
begin
  if (select count(id) from public.automation_policies) <> 1
    or (select count(id) from public.allowed_domains) <> 0
    or (select count(id) from public.objective_blueprints) <> 0
    or (select count(id) from public.brand_assets) <> 0
    or (select count(id) from public.mutation_plans) <> 0
    or (select count(event_sequence) from public.mutation_audit_events) <> 0 then
    raise exception 'Cross-tenant Control Plane rows are visible';
  end if;
end;
$$;

reset role;
rollback;

\echo 'Meta Write Control Plane migration checks passed'

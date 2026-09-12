\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values ('19000000-0000-4000-8000-000000000001', 'creative-optimizer@example.test');

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
  '29000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  'meta', 'creative-optimizer', '777777777777', 'Creative Optimizer Meta',
  null, 'ciphertext', 'iv', 'auth-tag', ' ["act_777777777777"]'::jsonb,
  array['ads_read','ads_management']::text[],
  now() + interval '30 days', now() + interval '30 days',
  '777777777777', 'EUR', 'Europe/Berlin', 'success',
  '39000000-0000-4000-8000-000000000001', now(),
  1, 1, 1, 1, 14, 0, current_date - 14, current_date
);

insert into public.automation_policies (
  id, user_id, platform_account_id, version, status, currency,
  account_daily_hard_cap_minor, default_campaign_daily_hard_cap_minor,
  budget_change_limit_bps, cooldown_seconds,
  standard_flex_spend_multiplier_bps, shared_budget_flex_spend_multiplier_bps,
  allow_budget_changes, allow_status_changes, allow_new_launches,
  require_verified_domain, policy_payload, policy_hash, is_current,
  customer_confirmed_at, customer_confirmed_by, activated_at
) values (
  '89000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  1, 'ACTIVE', 'EUR', 100000, 50000, 2000, 43200, 17500, 21000,
  false, true, true, true,
  '{"campaign_objectives":"ALL","regions":"ALL","brand_assets":"AUTONOMOUS"}'::jsonb,
  repeat('a', 64), true, now(),
  '19000000-0000-4000-8000-000000000001', now()
);

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  null, 'ALLOW', 'Creative optimizer regression', 'OPERATOR', 'test'
);

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, lifetime_budget_minor,
  last_seen_sync_id, last_seen_at, is_current
) values (
  '49000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '777777777701', 'Optimizer Campaign', 'ACTIVE', 'ACTIVE',
  'OUTCOME_TRAFFIC', null, null,
  '39000000-0000-4000-8000-000000000001', now(), true
);

insert into public.ad_groups (
  id, user_id, platform_account_id, campaign_id, platform_ad_group_id,
  name, status, effective_status, optimization_goal, daily_budget_minor,
  lifetime_budget_minor, last_seen_sync_id,
  last_seen_at, is_current
) values (
  '59000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '49000000-0000-4000-8000-000000000001',
  '777777777702', 'Optimizer Ad Set', 'ACTIVE', 'ACTIVE',
  'LINK_CLICKS', 10000, null,
  '39000000-0000-4000-8000-000000000001', now(), true
);

insert into public.creatives (
  id, user_id, platform_account_id, platform_creative_id, source,
  name, type, content, generated_by_ai, last_seen_sync_id, is_current
) values (
  '69000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '777777777703', 'meta', 'Baseline Creative', 'image',
  '{"image_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
  false, '39000000-0000-4000-8000-000000000001', true
);

insert into public.ads (
  id, user_id, platform_account_id, ad_group_id, platform_ad_id,
  name, status, effective_status, creative_id, platform_creative_id,
  last_seen_sync_id, last_seen_at, is_current
) values (
  '79000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000001',
  '777777777704', 'Baseline Ad', 'ACTIVE', 'ACTIVE',
  '69000000-0000-4000-8000-000000000001', '777777777703',
  '39000000-0000-4000-8000-000000000001', now(), true
);

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, ad_group_id, ad_id, status
) values
  (
    '99000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    'CAMPAIGN', 'campaign:777777777701', '777777777701',
    'campaign:777777777701', null, null,
    '49000000-0000-4000-8000-000000000001', null, null, 'MANAGED'
  ),
  (
    '99000000-0000-4000-8000-000000000002',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    'AD_SET', 'adset:777777777702', '777777777702',
    'campaign:777777777701', 'AD_SET', 'adset:777777777702',
    '49000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000001', null, 'MANAGED'
  ),
  (
    '99000000-0000-4000-8000-000000000003',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    'AD', 'ad:777777777704', '777777777704',
    'campaign:777777777701', null, null,
    '49000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000001', 'MANAGED'
  );

create temporary table optimizer_ids (key text primary key, id uuid not null) on commit drop;
insert into optimizer_ids (key, id)
select 'profile', public.put_brand_profile_version(
  p_user_id => '19000000-0000-4000-8000-000000000001',
  p_platform_account_id => '29000000-0000-4000-8000-000000000001',
  p_display_name => 'Optimizer Brand', p_brand_name => 'Optimizer Brand',
  p_facebook_page_id => '777777700001', p_instagram_actor_id => '777777700002',
  p_guidelines => '{}'::jsonb, p_forbidden_content => '[]'::jsonb,
  p_generation_defaults => '{"aspect_ratio":"1:1"}'::jsonb,
  p_activate => true, p_generated_asset_approval_mode => 'AUTONOMOUS_POLICY'
);

insert into public.brand_assets (
  id, user_id, platform_account_id, source_type, storage_bucket, storage_path,
  original_filename, sha256, mime_type, byte_size, width, height,
  brand_policy_version, moderation_status, status, meta_image_hash, metadata,
  reviewed_at, reviewed_by, brand_profile_id, library_scope
) values
  (
    'a1000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    'UPLOADED', 'creative-assets', 'baseline.jpg', 'baseline.jpg',
    repeat('1', 64), 'image/jpeg', 120000, 1080, 1080, 1,
    'APPROVED', 'READY', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '{"meta_format_key":"meta_feed_1x1"}'::jsonb, now(),
    '19000000-0000-4000-8000-000000000001',
    (select id from optimizer_ids where key = 'profile'), 'CUSTOMER'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    'UPLOADED', 'creative-assets', 'candidate.jpg', 'candidate.jpg',
    repeat('2', 64), 'image/jpeg', 130000, 1080, 1350, 1,
    'APPROVED', 'READY', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    jsonb_build_object('meta_format_key', 'meta_feed_4x5',
      'parent_asset_id', 'a1000000-0000-4000-8000-000000000001'),
    now(), '19000000-0000-4000-8000-000000000001',
    (select id from optimizer_ids where key = 'profile'), 'CUSTOMER'
  );

insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_rule_key, source_rule_version, action_type, target_type, target_key,
  idempotency_key, expected_before, intended_after, planned_payload,
  payload_hash, status, terminal_at
) values (
  'b1000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '89000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000001',
  'launch-chain', 1, 'LAUNCH_CHAIN', 'CHAIN', 'launch:fixture',
  repeat('3', 64), '{}'::jsonb, '{}'::jsonb,
  jsonb_build_object(
    'brand_profile_id', (select id from optimizer_ids where key = 'profile'),
    'brand_asset_ids', jsonb_build_array('a1000000-0000-4000-8000-000000000001')
  ), repeat('4', 64), 'SUCCEEDED', now()
);

insert into public.mutation_plan_steps (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, planned_request, request_hash,
  expected_result, compensation_operation, status
) values
  (
    'c1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001', 0, 'create-ad-set',
    'CREATE', 'AD_SET',
    '{"operation":"CREATE_AD_SET","payload":{"name":"Optimizer Ad Set","is_dynamic_creative":false}}'::jsonb,
    repeat('5', 64), '{}', 'NONE', 'RECONCILED'
  ),
  (
    'c1000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001', 1, 'create-creative',
    'CREATE', 'CREATIVE',
    '{"operation":"CREATE_CREATIVE","payload":{"name":"Baseline Creative","object_story_spec":{"page_id":"777777700001","link_data":{"link":"https://example.test","message":"Baseline","image_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","picture":"https://example.test/old.jpg"}}}}'::jsonb,
    repeat('6', 64), '{}', 'NONE', 'RECONCILED'
  ),
  (
    'c1000000-0000-4000-8000-000000000003',
    'b1000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001', 2, 'create-ad',
    'CREATE', 'AD',
    '{"operation":"CREATE_AD","payload":{"name":"Baseline Ad","adset_id":"777777777702","creative":{"creative_id":"777777777703"},"status":"ACTIVE"}}'::jsonb,
    repeat('7', 64), '{}', 'NONE', 'RECONCILED'
  );

insert into public.remote_object_bindings (
  plan_id, step_id, user_id, platform_account_id, object_type,
  remote_object_id, request_fingerprint, local_campaign_id,
  local_ad_group_id, local_ad_id, local_creative_id, reconciled_at
) values
  (
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001', 'AD_SET', '777777777702',
    repeat('5', 64), '49000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000001', null, null, now()
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001', 'CREATIVE', '777777777703',
    repeat('6', 64), null, null, null,
    '69000000-0000-4000-8000-000000000001', now()
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000003',
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001', 'AD', '777777777704',
    repeat('7', 64), '49000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001', now()
  );

create temporary table optimizer_lease on commit drop as
select public.claim_meta_account_operation(
  '29000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  'READ_SYNC', 'creative-optimizer-regression', 300
) as lease_token;

savepoint before_test_materializer;

do $$
declare
  v_result jsonb;
  v_plan uuid;
  v_replay jsonb;
  v_execution uuid := gen_random_uuid();
  v_lease uuid;
  v_reconcile_outcome text;
begin
  v_result := public.materialize_meta_creative_format_optimizer_plan(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'FORMAT', now()
  );
  if v_result->>'outcome' <> 'CREATED' then
    raise exception 'Creative test materializer did not create: %', v_result;
  end if;
  v_plan := (v_result->>'plan_id')::uuid;
  if (select action_type from public.mutation_plans where id = v_plan) <> 'LAUNCH_AD'
    or exists (
      select 1 from public.mutation_plan_steps
      where plan_id = v_plan
        and planned_request->>'operation' in ('CREATE_CAMPAIGN','CREATE_AD_SET','UPDATE_BUDGET')
    )
    or (select count(*) from public.mutation_plan_steps where plan_id = v_plan) <> 9
    or (select planned_payload->>'platform_ad_set_id' from public.mutation_plans where id=v_plan)
      <> '777777777702' then
    raise exception 'Creative test graph violates existing-adset/no-budget contract';
  end if;
  if exists (
    select 1
    from public.mutation_plan_steps
    where plan_id = v_plan
      and planned_request->>'operation' = 'CREATE_CREATIVE'
      and planned_request->>'mode' = 'execute'
      and planned_request#>>'{payload,object_story_spec,link_data,picture}' is not null
  ) then
    raise exception 'Creative optimizer retained a conflicting picture field';
  end if;
  v_replay := public.materialize_meta_creative_format_optimizer_plan(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'FORMAT', now()
  );
  if v_replay->>'outcome' <> 'EXISTING'
    or v_replay->>'plan_id' <> v_plan::text then
    raise exception 'Creative test family is not idempotent: %', v_replay;
  end if;
  select lease_token into v_lease from optimizer_lease;
  perform pg_catalog.set_config('session_replication_role', 'replica', true);
  update public.mutation_plans
  set status = 'RECONCILING', lease_token = v_lease,
    lease_owner = 'creative-optimizer-regression',
    lease_expires_at = now() + interval '5 minutes', updated_at = now()
  where id = v_plan;
  insert into public.mutation_executions (
    id, plan_id, user_id, platform_account_id, attempt_number,
    worker_id, lease_token, status
  ) values (
    v_execution, v_plan,
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    1, 'creative-optimizer-regression', v_lease, 'RECONCILING'
  );
  update public.mutation_plan_steps
  set status = 'RUNNING', started_at = now(), updated_at = now()
  where plan_id = v_plan
    and step_key = 'reconcile-existing-adset-creative-test';
  insert into public.remote_object_bindings (
    plan_id, step_id, execution_id, user_id, platform_account_id,
    object_type, remote_object_id, request_fingerprint
  )
  select v_plan, step.id, v_execution,
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    'CREATIVE', '888888888801', repeat('a', 64)
  from public.mutation_plan_steps step
  where step.plan_id = v_plan and step.step_key = 'create-test-creative';
  insert into public.remote_object_bindings (
    plan_id, step_id, execution_id, user_id, platform_account_id,
    object_type, remote_object_id, request_fingerprint
  )
  select v_plan, step.id, v_execution,
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    'AD', '888888888802', repeat('b', 64)
  from public.mutation_plan_steps step
  where step.plan_id = v_plan and step.step_key = 'create-test-ad-paused';
  insert into public.meta_mutation_remote_snapshots (
    user_id, platform_account_id, policy_id, plan_id, step_id,
    execution_id, object_type, remote_object_id, snapshot_kind,
    snapshot_payload, response_fingerprint
  )
  select '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000001', v_plan, step.id,
    v_execution, 'CREATIVE', '888888888801', 'READ_AFTER_WRITE',
    '{"id":"888888888801","name":"Optimizer Creative","object_type":"IMAGE","status":"ACTIVE"}'::jsonb,
    repeat('c', 64)
  from public.mutation_plan_steps step
  where step.plan_id = v_plan and step.step_key = 'read-test-creative';
  insert into public.meta_mutation_remote_snapshots (
    user_id, platform_account_id, policy_id, plan_id, step_id,
    execution_id, object_type, remote_object_id, snapshot_kind,
    snapshot_payload, response_fingerprint
  )
  select '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000001', v_plan, step.id,
    v_execution, 'AD', '888888888802', 'READ_AFTER_WRITE',
    '{"id":"888888888802","name":"Optimizer Test Ad","status":"ACTIVE","effective_status":"ACTIVE","adset_id":"777777777702","creative":{"id":"888888888801"}}'::jsonb,
    repeat('d', 64)
  from public.mutation_plan_steps step
  where step.plan_id = v_plan and step.step_key = 'read-test-ad-active';
  perform pg_catalog.set_config('session_replication_role', 'origin', true);
  select result.outcome into v_reconcile_outcome
  from public.reconcile_meta_creative_format_optimizer_plan(
    v_execution,
    (select id from public.mutation_plan_steps
     where plan_id = v_plan and step_key = 'reconcile-existing-adset-creative-test'),
    v_lease
  ) result;
  if v_reconcile_outcome <> 'SUCCEEDED'
    or (select status from public.mutation_plans where id = v_plan) <> 'SUCCEEDED'
    or not exists (
      select 1 from public.meta_creative_optimization_cycles
      where plan_id = v_plan and status = 'ACTIVE_TEST'
        and remote_creative_id = '888888888801'
        and remote_ad_id = '888888888802'
  ) then
    raise exception 'Specialized creative reconcile did not succeed';
  end if;
  update optimizer_lease
  set lease_token = public.claim_meta_account_operation(
    '29000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    'READ_SYNC', 'creative-optimizer-replay', 300
  );
  v_replay := public.materialize_meta_creative_format_optimizer_plan(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'FORMAT', now()
  );
  if v_replay->>'outcome' <> 'EXISTING'
    or v_replay->>'plan_id' <> v_plan::text
    or v_replay->>'status' <> 'ACTIVE_TEST' then
    raise exception 'Post-reconcile replay was not idempotent: %', v_replay;
  end if;
  v_result := public.materialize_meta_creative_format_optimizer_plan(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    gen_random_uuid(),
    '79000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'FORMAT', now()
  );
  if v_result->>'reason' <> 'read_lease_required' then
    raise exception 'Missing read lease did not fail closed: %', v_result;
  end if;
end;
$$;

rollback to savepoint before_test_materializer;

insert into public.ads (
  id, user_id, platform_account_id, ad_group_id, platform_ad_id,
  name, status, effective_status, creative_id, platform_creative_id,
  last_seen_sync_id, last_seen_at, is_current
) values (
  '79000000-0000-4000-8000-000000000002',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000001',
  '777777777705', 'Loser Ad', 'ACTIVE', 'ACTIVE',
  '69000000-0000-4000-8000-000000000001', '777777777703',
  '39000000-0000-4000-8000-000000000001', now(), true
);
insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, campaign_id, ad_group_id, ad_id, status
) values (
  '99000000-0000-4000-8000-000000000004',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  'AD', 'ad:777777777705', '777777777705',
  'campaign:777777777701', '49000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000002', 'MANAGED'
);

insert into public.mutation_plans (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_rule_key, source_rule_version, action_type, target_type, target_key,
  idempotency_key, expected_before, intended_after, planned_payload,
  payload_hash, status, terminal_at
) values (
  'b2000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '89000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000001',
  'meta_creative_format_optimizer_v1', 1, 'LAUNCH_AD', 'AD_SET',
  'adset:777777777702', repeat('8', 64), '{}'::jsonb, '{}'::jsonb,
  '{"contract":"meta_existing_adset_creative_test_v1"}'::jsonb,
  repeat('9', 64), 'SUCCEEDED', now()
);

insert into public.meta_creative_optimization_cycles (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_launch_plan_id, plan_id, brand_profile_id, ad_set_id,
  platform_ad_set_id, baseline_ad_id, platform_baseline_ad_id,
  baseline_asset_id, candidate_asset_id, candidate_ad_id,
  remote_creative_id, remote_ad_id, test_kind, contract_marker,
  test_family_key, status, started_at, measurement_start_date,
  measurement_end_date
) values (
  'd2000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '89000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  (select id from optimizer_ids where key = 'profile'),
  '59000000-0000-4000-8000-000000000001', '777777777702',
  '79000000-0000-4000-8000-000000000001', '777777777704',
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  '79000000-0000-4000-8000-000000000002',
  '777777777706', '777777777705', 'FORMAT',
  'meta_existing_adset_creative_test_v1', repeat('d', 64), 'ACTIVE_TEST',
  now() - interval '10 days',
  (now() at time zone 'Europe/Berlin')::date - 9,
  (now() at time zone 'Europe/Berlin')::date - 3
);

do $$
declare
  v_wi bigint := 14000; v_li bigint := 14000;
  v_wc bigint := 1680; v_lc bigint := 980;
  v_wr bigint := 1680; v_lr bigint := 980;
  v_wrate double precision; v_lrate double precision;
  v_start date := (now() at time zone 'Europe/Berlin')::date - 9;
  v_evidence jsonb; v_no_winner jsonb; v_zero jsonb;
  v_tampered jsonb; v_result jsonb; v_replay jsonb; v_plan uuid;
  v_cycle public.meta_creative_optimization_cycles%rowtype;
begin
  v_wrate := v_wr::double precision / v_wi;
  v_lrate := v_lr::double precision / v_li;
  v_evidence := jsonb_build_object(
    'contract', 'meta_creative_format_operational_evidence_v2',
    'attributionContract', 'link_ctr:daily:v1',
    'successKind', 'traffic',
    'commonDates', (select jsonb_agg(to_char(day_value, 'YYYY-MM-DD') order by day_value)
      from generate_series(v_start, v_start + 6, interval '1 day') day_value),
    'sourceSyncId', '39000000-0000-4000-8000-000000000001',
    'currency', 'EUR',
    'adSetId', '59000000-0000-4000-8000-000000000001',
    'platformAdSetId', '777777777702',
    'campaignId', '49000000-0000-4000-8000-000000000001',
    'platformCampaignId', '777777777701',
    'objective', 'OUTCOME_TRAFFIC',
    'optimizationGoal', 'LINK_CLICKS',
    'winner', jsonb_build_object(
      'adId', '79000000-0000-4000-8000-000000000001',
      'platformAdId', '777777777704', 'impressions', v_wi,
      'inlineLinkClicks', v_wc, 'spendMinor', 7000,
      'primaryResults', v_wr, 'trials', v_wi,
      'successes', v_wr, 'rate', v_wrate,
      'daily', (select jsonb_agg(jsonb_build_object(
        'date', to_char(day_value, 'YYYY-MM-DD'), 'impressions', 2000,
        'inlineLinkClicks', 240, 'spendMinor', 1000
      ) order by day_value)
      from generate_series(v_start, v_start + 6, interval '1 day') day_value)
    ),
    'loser', jsonb_build_object(
      'adId', '79000000-0000-4000-8000-000000000002',
      'platformAdId', '777777777705', 'impressions', v_li,
      'inlineLinkClicks', v_lc, 'spendMinor', 7000,
      'primaryResults', v_lr, 'trials', v_li,
      'successes', v_lr, 'rate', v_lrate,
      'daily', (select jsonb_agg(jsonb_build_object(
        'date', to_char(day_value, 'YYYY-MM-DD'), 'impressions', 2000,
        'inlineLinkClicks', 140, 'spendMinor', 1000
      ) order by day_value)
      from generate_series(v_start, v_start + 6, interval '1 day') day_value)
    ),
    'relativeLift', v_wrate / v_lrate - 1,
    'dailyWins', 7, 'deliveryAgreement', true,
    'thresholds', jsonb_build_object('fixedTestDays',7,'impressions',1000,
      'spendMinor',5000,'trafficClicks',100,'minDeliveryBalance',0.5,
      'relativeLift',0.10,'dailyWins',6)
  );
  delete from public.meta_creative_optimization_cycles
  where id = 'd2000000-0000-4000-8000-000000000001'
  returning * into v_cycle;
  v_result := public.queue_meta_creative_evidence_pause_internal(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000002',
    v_evidence, now()
  );
  if v_result->>'reason' <> 'active_test_cycle_required' then
    raise exception 'Pause without active optimizer cycle was not blocked: %', v_result;
  end if;
  insert into public.meta_creative_optimization_cycles select v_cycle.*;
  v_no_winner := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(v_evidence, '{winner,inlineLinkClicks}', '1050'::jsonb),
          '{winner,primaryResults}', '1050'::jsonb
        ),
        '{winner,successes}', '1050'::jsonb
      ),
      '{winner,rate}', to_jsonb(1050::double precision / 14000)
    ),
    '{winner,daily}',
    (select jsonb_agg(jsonb_build_object(
      'date', to_char(day_value, 'YYYY-MM-DD'), 'impressions', 2000,
      'inlineLinkClicks', 150, 'spendMinor', 1000
    ) order by day_value)
    from generate_series(v_start, v_start + 6, interval '1 day') day_value)
  );
  v_no_winner := jsonb_set(
    v_no_winner,
    '{relativeLift}',
    to_jsonb((1050::double precision / 14000) / v_lrate - 1)
  );
  v_zero := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(v_evidence, '{loser,impressions}', '0'::jsonb),
            '{loser,inlineLinkClicks}', '0'::jsonb
          ),
          '{loser,spendMinor}', '0'::jsonb
        ),
        '{loser,primaryResults}', '0'::jsonb
      ),
      '{loser,trials}', '0'::jsonb
    ),
    '{loser,successes}', '0'::jsonb
  );
  v_zero := jsonb_set(v_zero, '{loser,rate}', '0'::jsonb);
  v_zero := jsonb_set(v_zero, '{loser,daily}',
    (select jsonb_agg(jsonb_build_object(
      'date', to_char(day_value, 'YYYY-MM-DD'), 'impressions', 0,
      'inlineLinkClicks', 0, 'spendMinor', 0
    ) order by day_value)
    from generate_series(v_start, v_start + 6, interval '1 day') day_value));
  v_zero := jsonb_set(v_zero, '{relativeLift}', 'null'::jsonb);
  v_result := public.complete_meta_creative_optimization_cycle_no_winner(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    'd2000000-0000-4000-8000-000000000001',
    'insufficient_volume', v_zero, now()
  );
  if v_result->>'outcome' <> 'CREATED' then
    raise exception 'Zero-delivery arm did not close once: %', v_result;
  end if;
  delete from public.meta_creative_optimization_cycles
  where id = 'd2000000-0000-4000-8000-000000000001';
  insert into public.meta_creative_optimization_cycles select v_cycle.*;
  v_tampered := jsonb_set(v_no_winner, '{dailyWins}', '0'::jsonb);
  v_result := public.complete_meta_creative_optimization_cycle_no_winner(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    'd2000000-0000-4000-8000-000000000001',
    'no_consistent_lift', v_tampered, now()
  );
  if v_result->>'reason' <> 'completion_aggregate_mismatch' then
    raise exception 'Tampered no-winner evidence was not blocked: %', v_result;
  end if;
  v_result := public.complete_meta_creative_optimization_cycle_no_winner(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    'd2000000-0000-4000-8000-000000000001',
    'imbalanced_delivery', v_no_winner, now()
  );
  if v_result->>'reason' <> 'completion_reason_mismatch' then
    raise exception 'False no-winner reason was not blocked: %', v_result;
  end if;
  v_result := public.complete_meta_creative_optimization_cycle_no_winner(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    'd2000000-0000-4000-8000-000000000001',
    'no_consistent_lift', v_no_winner, now()
  );
  if v_result->>'outcome' <> 'CREATED'
    or (select status from public.meta_creative_optimization_cycles
        where id = 'd2000000-0000-4000-8000-000000000001') <> 'COMPLETED' then
    raise exception 'No-winner completion did not close the fixed test: %', v_result;
  end if;
  if not exists (
    select 1 from public.meta_creative_optimization_cycles cycle
    where cycle.id = 'd2000000-0000-4000-8000-000000000001'
      and cycle.decision_evidence = v_no_winner
      and cycle.decision_evidence_hash = public.meta_sha256(v_no_winner::text)
  ) or not exists (
    select 1 from public.mutation_audit_events event
    where event.event_type = 'META_CREATIVE_OPTIMIZER_NO_WINNER'
      and event.metadata->>'cycle_id' = 'd2000000-0000-4000-8000-000000000001'
      and event.metadata->'evidence' = v_no_winner
  ) then
    raise exception 'No-winner evidence was not persisted and audited';
  end if;
  v_replay := public.materialize_meta_creative_format_optimizer_plan(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'FORMAT', now()
  );
  if v_replay->>'outcome' <> 'EXISTING'
    or v_replay->>'status' <> 'COMPLETED' then
    raise exception 'Completed-cycle replay was not idempotent: %', v_replay;
  end if;
  delete from public.meta_creative_optimization_cycles
  where id = 'd2000000-0000-4000-8000-000000000001';
  insert into public.meta_creative_optimization_cycles select v_cycle.*;
  v_tampered := jsonb_set(v_evidence, '{dailyWins}', '0'::jsonb);
  v_result := public.queue_meta_creative_evidence_pause_internal(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000002',
    v_tampered, now()
  );
  if v_result->>'reason' <> 'evidence_minimums_not_met' then
    raise exception 'Tampered daily wins were not blocked: %', v_result;
  end if;
  v_tampered := jsonb_set(v_evidence, '{thresholds,relativeLift}', '0.2'::jsonb);
  v_result := public.queue_meta_creative_evidence_pause_internal(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000002',
    v_tampered, now()
  );
  if v_result->>'reason' <> 'invalid_evidence_contract' then
    raise exception 'Tampered evidence thresholds were not blocked: %', v_result;
  end if;
  v_result := public.queue_meta_creative_evidence_pause_internal(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000002',
    v_evidence, now()
  );
  if v_result->>'outcome' <> 'CREATED' then
    raise exception 'Valid evidence pause was not created: %', v_result;
  end if;
  v_plan := (v_result->>'plan_id')::uuid;
  if (select status from public.meta_creative_optimization_cycles
      where id = 'd2000000-0000-4000-8000-000000000001') <> 'PAUSE_PLANNED' then
    raise exception 'Winner decision was not atomically finalized';
  end if;
  if not exists (
    select 1 from public.meta_creative_optimization_cycles cycle
    where cycle.id = 'd2000000-0000-4000-8000-000000000001'
      and cycle.decision_evidence = v_evidence
      and cycle.decision_evidence_hash = public.meta_sha256(v_evidence::text)
  ) then
    raise exception 'Winner evidence was not atomically persisted';
  end if;
  v_result := public.queue_meta_creative_evidence_pause_internal(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (select lease_token from optimizer_lease),
    '79000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000002',
    v_evidence, now()
  );
  if v_result->>'outcome' <> 'EXISTING'
    or (v_result->>'plan_id')::uuid <> v_plan then
    raise exception 'Identical evidence replay was not idempotent: %', v_result;
  end if;
  if exists (
    select 1 from public.mutation_plan_steps
    where plan_id = v_plan and planned_request->>'operation' = 'UPDATE_BUDGET'
  ) or (select action_type from public.mutation_plans where id = v_plan) <> 'PAUSE' then
    raise exception 'Evidence pause contains a forbidden mutation';
  end if;
  update public.mutation_plans
  set status = 'FAILED', terminal_at = now(), error_class = 'TEST', updated_at = now()
  where id = v_plan;
  if (select status from public.meta_creative_optimization_cycles
      where id = 'd2000000-0000-4000-8000-000000000001') <> 'FAILED' then
    raise exception 'Terminal pause failure did not close the decided cycle';
  end if;
end;
$$;

do $$
declare v_result jsonb;
begin
  v_result := public.queue_meta_ad_sibling_success_pause_scan_internal(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000001',
    gen_random_uuid(),
    '39000000-0000-4000-8000-000000000001', now()
  );
  if v_result->>'reason' <> 'disabled_legacy_no_minimum'
    or coalesce((v_result->>'created')::integer, -1) <> 0 then
    raise exception 'Legacy no-minimum pause scan is not fail-closed: %', v_result;
  end if;
  v_result := public.queue_meta_ad_sibling_success_pause_internal(
    '19000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000001',
    gen_random_uuid(),
    '39000000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000003',
    '{}'::jsonb, now()
  );
  if v_result->>'reason' <> 'disabled_legacy_no_minimum' then
    raise exception 'Direct legacy no-minimum pause is not fail-closed: %', v_result;
  end if;
end;
$$;

do $$
begin
  if has_function_privilege(
      'authenticated',
      'public.materialize_meta_creative_format_optimizer_plan(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.reconcile_meta_creative_format_optimizer_plan(uuid,uuid,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.complete_meta_creative_optimization_cycle_no_winner(uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.queue_meta_creative_evidence_pause_internal(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,timestamptz)',
      'EXECUTE'
    ) then
    raise exception 'Authenticated role can execute a Creative optimizer mutation RPC';
  end if;
  if has_table_privilege(
    'authenticated', 'public.meta_creative_optimization_cycles', 'INSERT,UPDATE,DELETE'
  ) then
    raise exception 'Authenticated role can mutate Creative optimizer cycles';
  end if;
end;
$$;

rollback;

select 'Meta Creative/Format optimizer migration checks passed' as result;

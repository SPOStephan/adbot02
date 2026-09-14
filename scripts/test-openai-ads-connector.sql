\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('21000000-0000-4000-8000-000000000001', 'openai-owner@example.com'),
  ('21000000-0000-4000-8000-000000000002', 'openai-other@example.com');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_id, account_name,
  access_token, refresh_token, access_token_encrypted, token_iv,
  token_auth_tag, token_version, credential_kind, provider_metadata,
  connected_at, provider_sync_status, provider_next_sync_at, updated_at
) values
  (
    '22000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'openai_ads', 'oa-account-1', 'oa-account-1', 'OpenAI One',
    null, null, 'cipher-1', 'iv-1', 'tag-1', 1, 'api_key',
    '{"currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active"}'::jsonb,
    now(), 'idle', now(), now()
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    'openai_ads', 'oa-account-2', 'oa-account-2', 'OpenAI Two',
    null, null, 'cipher-2', 'iv-2', 'tag-2', 1, 'api_key',
    '{"currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active"}'::jsonb,
    now(), 'idle', now(), now()
  ),
  (
    '22000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000002',
    'openai_ads', 'oa-account-other', 'oa-account-other', 'Other Tenant',
    null, null, 'cipher-other', 'iv-other', 'tag-other', 1, 'api_key',
    '{"currency_code":"USD","timezone":"America/New_York","review_status":"approved","account_status":"active"}'::jsonb,
    now(), 'idle', now(), now()
  );

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.platform_accounts
  where user_id = '21000000-0000-4000-8000-000000000001'
    and platform = 'openai_ads';
  if v_count <> 2 then
    raise exception 'Expected two OpenAI Ads accounts for one user, got %', v_count;
  end if;
end;
$$;

-- Existing Meta connector remains a single stable row after reconnect.
select public.replace_meta_connection(
  '21000000-0000-4000-8000-000000000001',
  'meta-user-one',
  'Meta One',
  'meta-cipher-one',
  'meta-iv-one',
  'meta-tag-one',
  now() + interval '30 days',
  null,
  now() + interval '60 days',
  array['ads_read'],
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
);

select public.replace_meta_connection(
  '21000000-0000-4000-8000-000000000001',
  'meta-user-two',
  'Meta Reconnected',
  'meta-cipher-two',
  'meta-iv-two',
  'meta-tag-two',
  now() + interval '30 days',
  null,
  now() + interval '60 days',
  array['ads_read', 'ads_management'],
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
);

do $$
declare
  v_count integer;
  v_remote_id text;
begin
  select count(*), min(platform_account_id)
    into v_count, v_remote_id
  from public.platform_accounts
  where user_id = '21000000-0000-4000-8000-000000000001'
    and platform = 'meta';
  if v_count <> 1 or v_remote_id <> 'meta-user-two' then
    raise exception 'Meta singleton/reconnect regression: count %, id %', v_count, v_remote_id;
  end if;
end;
$$;

update public.platform_accounts
set
  marketing_meta_ad_account_id = 'act_old',
  marketing_currency = 'EUR',
  marketing_sync_status = 'success',
  marketing_last_success_at = now(),
  marketing_sync_id = '25000000-0000-4000-8000-000000000001',
  marketing_campaign_count = 3,
  marketing_spend_total = 42
where user_id = '21000000-0000-4000-8000-000000000001'
  and platform = 'meta';

select public.reset_meta_connection_for_reauthorization(
  '21000000-0000-4000-8000-000000000001'
);

do $$
declare
  v_account public.platform_accounts%rowtype;
begin
  select account.* into strict v_account
  from public.platform_accounts account
  where account.user_id = '21000000-0000-4000-8000-000000000001'
    and account.platform = 'meta';

  if v_account.marketing_meta_ad_account_id is not null
    or v_account.marketing_currency is not null
    or v_account.marketing_sync_status <> 'idle'
    or v_account.marketing_last_success_at is not null
    or v_account.marketing_sync_id is not null
    or v_account.marketing_campaign_count <> 0
    or v_account.marketing_spend_total is not null
  then
    raise exception 'Meta authorization reset retained stale marketing readiness';
  end if;
end;
$$;

-- Tokenized claim is atomic and cannot be acquired twice while fresh.
select
  count(*) = 1 as first_claim,
  max(sync_claim_token::text) as sync_claim_token,
  max(credential_generation::text) as credential_generation
from public.claim_openai_ads_account_sync(
  '22000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  900
)
\gset
\if :first_claim
\else
  \quit 1
\endif

select not exists (
  select 1 from public.claim_openai_ads_account_sync(
    '22000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    900
  )
) as second_claim_blocked
\gset
\if :second_claim_blocked
\else
  \quit 1
\endif

insert into public.ad_platform_sync_runs (
  id, user_id, platform_account_id, platform, status,
  sync_claim_token, credential_generation
) values (
  '23000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'openai_ads',
  'running',
  :'sync_claim_token'::uuid,
  :'credential_generation'::uuid
);

create or replace function pg_temp.rearm_openai_test_sync()
returns void
language plpgsql
as $$
begin
  update public.ad_platform_sync_runs
  set status = 'running', completed_at = null, error_code = null
  where id = '23000000-0000-4000-8000-000000000001';
  update public.platform_accounts
  set
    provider_sync_status = 'syncing',
    provider_sync_claim_token = (
      select sync_claim_token from public.ad_platform_sync_runs
      where id = '23000000-0000-4000-8000-000000000001'
    ),
    provider_sync_claimed_at = now()
  where id = '22000000-0000-4000-8000-000000000001'
    and credential_generation = (
      select credential_generation from public.ad_platform_sync_runs
      where id = '23000000-0000-4000-8000-000000000001'
    );
end;
$$;

insert into public.ad_platform_launches (
  id, user_id, platform_account_id, platform, idempotency_key, status,
  request_payload, remote_campaign_id, remote_ad_group_id, remote_ad_id,
  remote_file_id, review_status, activated_at
) values
(
  '24000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'openai_ads',
  'provider-active-drift-test',
  'in_review',
  '{"contractVersion":"paused_campaign_daily_v1","remoteAccountId":"oa-account-1","currency":"EUR","biddingType":"clicks","billingEventType":"click","dailyBudgetMicros":25000000,"maxBidMicros":2000000,"startTime":null,"endTime":null,"locationIds":["DE"],"contextHints":["hotel"],"title":"Test","body":"Test body","targetUrl":"https://example.com/"}'::jsonb,
  'cmp-openai-1',
  'ag-openai-1',
  'ad-openai-1',
  'file-openai-1',
  'in_review',
  null
),
(
  '24000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'openai_ads',
  'paused-launch-test',
  'in_review',
  '{"contractVersion":"paused_campaign_daily_v1","remoteAccountId":"oa-account-1","currency":"EUR","accountTimezone":"Europe/Berlin","campaignName":"Paused launch","campaignDescription":null,"biddingType":"clicks","billingEventType":"click","dailyBudgetMicros":25000000,"maxBidMicros":2000000,"startTime":null,"endTime":null,"locationIds":["DE"],"adGroupName":"Paused group","contextHints":["hotel"],"adName":"Paused ad","title":"Paused Test","body":"Paused body","targetUrl":"https://example.com/paused","imageUrl":"https://example.com/paused.jpg"}'::jsonb,
  'cmp-openai-paused',
  'ag-openai-paused',
  'ad-openai-paused',
  'file-openai-paused',
  'in_review',
  null
),
(
  '24000000-0000-4000-8000-000000000003',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'openai_ads',
  'local-active-launch-test',
  'active',
  '{"contractVersion":"paused_campaign_daily_v1","remoteAccountId":"oa-account-1","currency":"EUR","accountTimezone":"Europe/Berlin","campaignName":"Existing active launch","campaignDescription":null,"biddingType":"clicks","billingEventType":"click","dailyBudgetMicros":25000000,"maxBidMicros":2000000,"startTime":null,"endTime":null,"locationIds":["DE"],"adGroupName":"Existing active group","contextHints":["hotel"],"adName":"Existing active ad","title":"Active Test","body":"Active body","targetUrl":"https://example.com/active","imageUrl":"https://example.com/active.jpg"}'::jsonb,
  'cmp-openai-active',
  'ag-openai-active',
  'ad-openai-active',
  'file-openai-active',
  'approved',
  now() - interval '1 day'
),
(
  '24000000-0000-4000-8000-000000000004',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'openai_ads',
  'legacy-incomplete-launch-test',
  'in_review',
  '{"dailyBudgetMicros":25000000}'::jsonb,
  null,
  null,
  null,
  null,
  'in_review',
  null
);

do $$
begin
  if not public.is_valid_openai_ads_paused_daily_contract(
    '{"contractVersion":"paused_campaign_daily_v1","remoteAccountId":"oa-account-1","currency":"EUR","accountTimezone":"Europe/Berlin","campaignName":"Campaign [adbot:1234567890]","campaignDescription":null,"biddingType":"clicks","billingEventType":"click","dailyBudgetMicros":25000000,"maxBidMicros":2000000,"startTime":null,"endTime":null,"locationIds":["DE"],"adGroupName":"Group [adbot:1234567890]","contextHints":["hotel"],"adName":"Ad [adbot:1234567890]","title":"Title","body":"Body","targetUrl":"https://example.com/","imageUrl":"https://example.com/image.jpg"}'::jsonb
  ) then
    raise exception 'Complete paused daily v1 contract was rejected';
  end if;
  if public.is_valid_openai_ads_paused_daily_contract(
    '{"contractVersion":"paused_campaign_daily_v1","remoteAccountId":"oa-account-1","currency":"EUR","dailyBudgetMicros":25000000}'::jsonb
  ) then
    raise exception 'Partial lookalike v1 contract was accepted';
  end if;
  if public.is_valid_openai_ads_paused_daily_contract(
    '{"contractVersion":"paused_campaign_daily_v1","remoteAccountId":"oa-account-1","currency":"EUR","accountTimezone":"Europe/Berlin","campaignName":"Campaign","campaignDescription":null,"biddingType":"clicks","billingEventType":"click","dailyBudgetMicros":25000000.5,"maxBidMicros":2000000,"startTime":946684799,"endTime":null,"locationIds":["DE"],"adGroupName":"Group","contextHints":["hotel"],"adName":"Ad","title":"Title","body":"Body","targetUrl":"https://example.com/","imageUrl":"https://example.com/image.jpg"}'::jsonb
  ) then
    raise exception 'Fractional amount or out-of-range timestamp was accepted';
  end if;
end;
$$;

select public.replace_openai_ads_snapshot(
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '{"id":"oa-account-1","name":"OpenAI One","currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active"}'::jsonb,
  '[{"id":"cmp-openai-1","name":"Drifted launch","status":"active","objective":"clicks","bidding_type":"clicks","budget_amount_micros":null,"daily_budget_amount_micros":25000000,"start_time":1788998400,"end_time":1789603200,"created_at":1788998400,"updated_at":1788998400,"provider_data":{"budget":{"daily_spend_limit_micros":25000000}}},{"id":"cmp-openai-paused","name":"Paused launch","status":"paused","objective":"clicks","bidding_type":"clicks","budget_amount_micros":null,"daily_budget_amount_micros":25000000,"start_time":null,"end_time":null,"created_at":1788998400,"updated_at":1788998400,"provider_data":{"description":null,"budget":{"daily_spend_limit_micros":25000000,"lifetime_spend_limit_micros_present":false},"targeting":{"locations":{"include":[{"id":"DE"}]}},"product_feed_id":null,"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}},{"id":"cmp-openai-active","name":"Existing active launch","status":"active","objective":"clicks","bidding_type":"clicks","budget_amount_micros":null,"daily_budget_amount_micros":25000000,"start_time":null,"end_time":null,"created_at":1788998400,"updated_at":1788998400,"provider_data":{"description":null,"budget":{"daily_spend_limit_micros":25000000,"lifetime_spend_limit_micros_present":false},"targeting":{"locations":{"include":[{"id":"DE"}]}},"product_feed_id":null,"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb,
  '[{"id":"ag-openai-1","campaign_id":"cmp-openai-1","name":"Drifted group","status":"active","billing_event_type":"click","max_bid_micros":2000000,"bid_strategy":"fixed","created_at":1788998400,"updated_at":1788998400,"provider_data":{}},{"id":"ag-openai-paused","campaign_id":"cmp-openai-paused","name":"Paused group","status":"paused","billing_event_type":"click","max_bid_micros":2000000,"bid_strategy":"fixed_bid","created_at":1788998400,"updated_at":1788998400,"provider_data":{"description":null,"context_hints":["hotel"],"bidding_config":{"billing_event_type":"click","strategy":"fixed_bid","max_bid_micros":2000000,"custom_audience_bid_multipliers":[]},"product_set":null,"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}},{"id":"ag-openai-active","campaign_id":"cmp-openai-active","name":"Existing active group","status":"active","billing_event_type":"click","max_bid_micros":2000000,"bid_strategy":"fixed_bid","created_at":1788998400,"updated_at":1788998400,"provider_data":{"description":null,"context_hints":["hotel"],"bidding_config":{"billing_event_type":"click","strategy":"fixed_bid","max_bid_micros":2000000,"custom_audience_bid_multipliers":[]},"product_set":null,"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb,
  '[{"id":"ad-openai-1","ad_group_id":"ag-openai-1","name":"Drifted ad","status":"active","review_status":"approved","creative_type":"chat_card","target_url":"https://example.com/","created_at":1788998400,"updated_at":1788998400,"provider_data":{}},{"id":"ad-openai-paused","ad_group_id":"ag-openai-paused","name":"Paused ad","status":"paused","review_status":"approved","creative_type":"chat_card","target_url":"https://example.com/paused","created_at":1788998400,"updated_at":1788998400,"provider_data":{"creative":{"type":"chat_card","title":"Paused Test","body":"Paused body","price":null,"file_id":"file-openai-paused","image_crop":null,"target_url":"https://example.com/paused"},"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}},{"id":"ad-openai-active","ad_group_id":"ag-openai-active","name":"Existing active ad","status":"active","review_status":"approved","creative_type":"chat_card","target_url":"https://example.com/active","created_at":1788998400,"updated_at":1788998400,"provider_data":{"creative":{"type":"chat_card","title":"Active Test","body":"Active body","price":null,"file_id":"file-openai-active","image_crop":null,"target_url":"https://example.com/active"},"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb,
  '[{"campaign_id":"cmp-openai-1","date":"2026-09-09","date_stop":"2026-09-09","impressions":1000,"clicks":50,"spend":25.5,"conversions":5,"data_status":"final","provider_data":{}}]'::jsonb
);

do $$
declare
  v_campaign_id uuid;
  v_spend numeric;
  v_cpc numeric;
  v_status text;
begin
  select id into v_campaign_id
  from public.campaigns
  where platform_account_id = '22000000-0000-4000-8000-000000000001'
    and platform_campaign_id = 'cmp-openai-1'
    and is_current = true;
  if v_campaign_id is null then
    raise exception 'OpenAI campaign snapshot missing';
  end if;
  if not exists (
    select 1
    from public.campaigns
    where id = v_campaign_id
      and budget_amount_micros is null
      and daily_budget_amount_micros = 25000000
  ) then
    raise exception 'OpenAI daily-only budget normalization missing';
  end if;

  if not exists (
    select 1 from public.ad_groups
    where platform_account_id = '22000000-0000-4000-8000-000000000001'
      and platform_ad_group_id = 'ag-openai-1'
      and campaign_id = v_campaign_id
      and is_current = true
  ) then
    raise exception 'OpenAI ad group hierarchy missing';
  end if;

  if not exists (
    select 1 from public.ads
    where platform_account_id = '22000000-0000-4000-8000-000000000001'
      and platform_ad_id = 'ad-openai-1'
      and review_status = 'approved'
      and is_current = true
  ) then
    raise exception 'OpenAI ad hierarchy missing';
  end if;

  select spend, cpc
    into v_spend, v_cpc
  from public.cross_platform_campaign_performance_30d
  where user_id = '21000000-0000-4000-8000-000000000001'
    and platform_account_id = '22000000-0000-4000-8000-000000000001'
    and platform = 'openai_ads'
    and campaign_id = v_campaign_id;
  if v_spend <> 25.5 or v_cpc <> 0.51 then
    raise exception 'Cross-platform metrics mismatch: spend %, cpc %', v_spend, v_cpc;
  end if;

  select status into v_status
  from public.ad_platform_sync_runs
  where id = '23000000-0000-4000-8000-000000000001';
  if v_status <> 'success' then
    raise exception 'Expected successful sync run, got %', v_status;
  end if;

  select status into v_status
  from public.ad_platform_launches
  where id = '24000000-0000-4000-8000-000000000001';
  if v_status <> 'activation_uncertain' then
    raise exception 'Provider-ACTIVE drift was not fail-closed, got %', v_status;
  end if;
  if not exists (
    select 1 from public.ad_platform_launches
    where id = '24000000-0000-4000-8000-000000000001'
      and error_code = 'snapshot_launch_contract_not_verified'
      and activated_at is null
  ) then
    raise exception 'Provider-ACTIVE drift did not retain a non-activated uncertain state';
  end if;

  select status into v_status
  from public.ad_platform_launches
  where id = '24000000-0000-4000-8000-000000000002';
  if v_status <> 'ready_to_activate' then
    raise exception 'Verified PAUSED v1 hierarchy was not made ready, got %', v_status;
  end if;

  if not exists (
    select 1 from public.ad_platform_launches
    where id = '24000000-0000-4000-8000-000000000003'
      and status = 'active'
      and activated_at is not null
  ) then
    raise exception 'Existing local ACTIVE launch was reclassified';
  end if;

  if not exists (
    select 1 from public.ad_platform_launches
    where id = '24000000-0000-4000-8000-000000000004'
      and status = 'activation_uncertain'
      and error_code = 'snapshot_launch_contract_not_verified'
      and activated_at is null
  ) then
    raise exception 'Incomplete legacy launch was not fail-closed';
  end if;
end;
$$;

do $$
declare
  v_review_status text;
  v_status text;
  v_campaigns jsonb := '[{"id":"cmp-openai-active","name":"Existing active launch","status":"active","objective":"clicks","bidding_type":"clicks","budget_amount_micros":null,"daily_budget_amount_micros":25000000,"start_time":null,"end_time":null,"created_at":1788998400,"updated_at":1788998400,"provider_data":{"description":null,"budget":{"daily_spend_limit_micros":25000000,"lifetime_spend_limit_micros_present":false},"targeting":{"locations":{"include":[{"id":"DE"}]}},"product_feed_id":null,"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb;
  v_groups jsonb := '[{"id":"ag-openai-active","campaign_id":"cmp-openai-active","name":"Existing active group","status":"active","billing_event_type":"click","max_bid_micros":2000000,"bid_strategy":"fixed_bid","created_at":1788998400,"updated_at":1788998400,"provider_data":{"description":null,"context_hints":["hotel"],"bidding_config":{"billing_event_type":"click","strategy":"fixed_bid","max_bid_micros":2000000,"custom_audience_bid_multipliers":[]},"product_set":null,"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb;
  v_ads_base jsonb := '[{"id":"ad-openai-active","ad_group_id":"ag-openai-active","name":"Existing active ad","status":"active","review_status":"approved","creative_type":"chat_card","target_url":"https://example.com/active","created_at":1788998400,"updated_at":1788998400,"provider_data":{"creative":{"type":"chat_card","title":"Active Test","body":"Active body","file_id":"file-openai-active","target_url":"https://example.com/active"},"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb;
begin
  foreach v_review_status in array array['in_review', 'rejected'] loop
    update public.ad_platform_launches
    set status = 'active', error_code = null
    where id = '24000000-0000-4000-8000-000000000003';
    perform pg_temp.rearm_openai_test_sync();
    perform public.replace_openai_ads_snapshot(
      '21000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000001',
      '{"id":"oa-account-1","name":"OpenAI One","currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active"}'::jsonb,
      v_campaigns,
      v_groups,
      jsonb_set(v_ads_base, '{0,review_status}', to_jsonb(v_review_status)),
      '[]'::jsonb
    );
    select status into v_status
    from public.ad_platform_launches
    where id = '24000000-0000-4000-8000-000000000003';
    if v_status <> 'activation_uncertain' then
      raise exception 'ACTIVE launch with provider review % became %, expected activation_uncertain',
        v_review_status, v_status;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_case text;
  v_status text;
  v_campaigns_base jsonb := '[{"id":"cmp-openai-paused","name":"Paused launch","status":"paused","objective":"clicks","bidding_type":"clicks","budget_amount_micros":null,"daily_budget_amount_micros":25000000,"start_time":null,"end_time":null,"created_at":1788998400,"updated_at":1788998400,"provider_data":{"description":null,"budget":{"daily_spend_limit_micros":25000000,"lifetime_spend_limit_micros_present":false},"targeting":{"locations":{"include":[{"id":"DE"}]}},"product_feed_id":null,"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb;
  v_groups_base jsonb := '[{"id":"ag-openai-paused","campaign_id":"cmp-openai-paused","name":"Paused group","status":"paused","billing_event_type":"click","max_bid_micros":2000000,"bid_strategy":"fixed_bid","created_at":1788998400,"updated_at":1788998400,"provider_data":{"description":null,"context_hints":["hotel"],"bidding_config":{"billing_event_type":"click","strategy":"fixed_bid","max_bid_micros":2000000,"custom_audience_bid_multipliers":[]},"product_set":null,"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb;
  v_ads_base jsonb := '[{"id":"ad-openai-paused","ad_group_id":"ag-openai-paused","name":"Paused ad","status":"paused","review_status":"approved","creative_type":"chat_card","target_url":"https://example.com/paused","created_at":1788998400,"updated_at":1788998400,"provider_data":{"creative":{"type":"chat_card","title":"Paused Test","body":"Paused body","price":null,"file_id":"file-openai-paused","image_crop":null,"target_url":"https://example.com/paused"},"landing_page_configuration":null,"serving_issues":[],"serving_issues_observed":true}}]'::jsonb;
  v_campaigns jsonb;
  v_groups jsonb;
  v_ads jsonb;
  v_account jsonb;
  v_insights jsonb;
begin
  foreach v_case in array array[
    'account_integrity_in_review', 'account_integrity_rejected',
    'campaign_name', 'campaign_description', 'campaign_start',
    'campaign_targeting', 'campaign_product_feed', 'campaign_landing',
    'group_context', 'group_strategy', 'group_max_bid', 'group_multiplier',
    'group_product_set', 'group_landing', 'ad_title', 'ad_file', 'ad_landing',
    'serving_issue'
  ] loop
    v_campaigns := v_campaigns_base;
    v_groups := v_groups_base;
    v_ads := v_ads_base;
    v_account := '{"id":"oa-account-1","name":"OpenAI One","currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active"}'::jsonb;
    case v_case
      when 'account_integrity_in_review' then
        v_account := v_account || '{"account_integrity_review_observed":true,"account_integrity_review_status":"in_review"}'::jsonb;
      when 'account_integrity_rejected' then
        v_account := v_account || '{"account_integrity_review_observed":true,"account_integrity_review_status":"rejected"}'::jsonb;
      when 'campaign_name' then
        v_campaigns := jsonb_set(v_campaigns, '{0,name}', '"Changed"');
      when 'campaign_description' then
        v_campaigns := jsonb_set(v_campaigns, '{0,provider_data,description}', '"Changed"');
      when 'campaign_start' then
        v_campaigns := jsonb_set(v_campaigns, '{0,start_time}', '1788998400');
      when 'campaign_targeting' then
        v_campaigns := jsonb_set(v_campaigns, '{0,provider_data,targeting,age}', '{"include":["18-24"]}');
      when 'campaign_product_feed' then
        v_campaigns := jsonb_set(v_campaigns, '{0,provider_data,product_feed_id}', '"feed-1"');
      when 'campaign_landing' then
        v_campaigns := jsonb_set(v_campaigns, '{0,provider_data,landing_page_configuration}', '{"query_string_template":"utm_source=openai"}');
      when 'group_context' then
        v_groups := jsonb_set(v_groups, '{0,provider_data,context_hints}', '["changed"]');
      when 'group_strategy' then
        v_groups := jsonb_set(v_groups, '{0,bid_strategy}', '"auto"');
      when 'group_max_bid' then
        v_groups := jsonb_set(v_groups, '{0,max_bid_micros}', '2000001');
      when 'group_multiplier' then
        v_groups := jsonb_set(v_groups, '{0,provider_data,bidding_config,custom_audience_bid_multipliers}', '[{"custom_audience_id":"audience-1","bid_multiplier_micros":1200000}]');
      when 'group_product_set' then
        v_groups := jsonb_set(v_groups, '{0,provider_data,product_set}', '{"product_feed_id":"feed-1","filters":[]}');
      when 'group_landing' then
        v_groups := jsonb_set(v_groups, '{0,provider_data,landing_page_configuration}', '{"query_string_template":"utm_source=openai"}');
      when 'ad_title' then
        v_ads := jsonb_set(v_ads, '{0,provider_data,creative,title}', '"Changed"');
      when 'ad_file' then
        v_ads := jsonb_set(v_ads, '{0,provider_data,creative,file_id}', '"other-file"');
      when 'ad_landing' then
        v_ads := jsonb_set(v_ads, '{0,provider_data,landing_page_configuration}', '{"query_string_template":"utm_source=openai"}');
      when 'serving_issue' then
        v_ads := jsonb_set(v_ads, '{0,provider_data,serving_issues}', '[{"code":"blocked"}]');
    end case;

    update public.ad_platform_launches
    set status = 'in_review', error_code = null
    where id = '24000000-0000-4000-8000-000000000002';
    perform pg_temp.rearm_openai_test_sync();
    perform public.replace_openai_ads_snapshot(
      '21000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000001',
      v_account,
      v_campaigns,
      v_groups,
      v_ads,
      '[]'::jsonb
    );
    select status into v_status from public.ad_platform_launches
    where id = '24000000-0000-4000-8000-000000000002';
    if v_status <> 'activation_uncertain' then
      raise exception 'Snapshot drift case % became %, expected activation_uncertain', v_case, v_status;
    end if;
  end loop;

  update public.ad_platform_launches
  set status = 'in_review', error_code = null
  where id = '24000000-0000-4000-8000-000000000002';
  perform pg_temp.rearm_openai_test_sync();
  perform public.replace_openai_ads_snapshot(
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    '{"id":"oa-account-1","name":"OpenAI One","currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active","account_integrity_review_observed":true,"account_integrity_review_status":"approved"}'::jsonb,
    v_campaigns_base,
    v_groups_base,
    v_ads_base,
    '[]'::jsonb
  );
  select status into v_status from public.ad_platform_launches
  where id = '24000000-0000-4000-8000-000000000002';
  if v_status <> 'ready_to_activate' then
    raise exception 'Valid snapshot after drift matrix was not made ready, got %', v_status;
  end if;

  update public.ad_platform_launches
  set status = 'in_review', error_code = null
  where id = '24000000-0000-4000-8000-000000000002';
  perform pg_temp.rearm_openai_test_sync();
  perform public.replace_openai_ads_snapshot(
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    '{"id":"oa-account-1","name":"OpenAI One","currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active"}'::jsonb,
    jsonb_set(v_campaigns_base, '{0,provider_data,serving_issues}', '[{"code":"campaign_not_active"}]'),
    jsonb_set(v_groups_base, '{0,provider_data,serving_issues}', '[{"code":"ad_group_not_active"}]'),
    jsonb_set(v_ads_base, '{0,provider_data,serving_issues}', '[{"code":"ad_not_active"}]'),
    '[]'::jsonb
  );
  select status into v_status from public.ad_platform_launches
  where id = '24000000-0000-4000-8000-000000000002';
  if v_status <> 'ready_to_activate' then
    raise exception 'Expected PAUSED serving issues did not remain ready, got %', v_status;
  end if;
  if public.openai_ads_serving_issues_allowed(
    '[{"code":"ad_not_active"}]'::jsonb, 'ad', 'active', 'approved'
  ) then
    raise exception 'ACTIVE chain accepted PAUSED-only serving issue';
  end if;

  foreach v_case in array array[
    'missing_impressions', 'null_impressions', 'negative_impressions',
    'fractional_clicks', 'missing_spend', 'null_spend'
  ] loop
    v_insights := '[{"campaign_id":"cmp-openai-paused","date":"2026-09-10","date_stop":"2026-09-10","impressions":10,"clicks":1,"conversions":0,"spend":2.5}]'::jsonb;
    case v_case
      when 'missing_impressions' then
        v_insights := v_insights #- '{0,impressions}';
      when 'null_impressions' then
        v_insights := jsonb_set(v_insights, '{0,impressions}', 'null');
      when 'negative_impressions' then
        v_insights := jsonb_set(v_insights, '{0,impressions}', '-1');
      when 'fractional_clicks' then
        v_insights := jsonb_set(v_insights, '{0,clicks}', '1.5');
      when 'missing_spend' then
        v_insights := v_insights #- '{0,spend}';
      when 'null_spend' then
        v_insights := jsonb_set(v_insights, '{0,spend}', 'null');
    end case;
    perform pg_temp.rearm_openai_test_sync();
    begin
      perform public.replace_openai_ads_snapshot(
        '21000000-0000-4000-8000-000000000001',
        '22000000-0000-4000-8000-000000000001',
        '23000000-0000-4000-8000-000000000001',
        '{"id":"oa-account-1","name":"OpenAI One","currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active"}'::jsonb,
        v_campaigns_base, v_groups_base, v_ads_base, v_insights
      );
      raise exception 'Malformed insight case % unexpectedly succeeded', v_case;
    exception when others then
      if sqlerrm not like '%invalid_snapshot_payload%' then raise; end if;
    end;
  end loop;
end;
$$;

set local role service_role;
set local request.jwt.claim.role = 'service_role';

do $$
declare
  v_first record;
  v_second_count integer;
  v_recovered record;
  v_wrong_finish boolean;
  v_right_finish boolean;
  v_immutable_blocked boolean := false;
begin
  select * into v_first
  from public.claim_openai_ads_launch_operation(
    '24000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    array['ready_to_activate'],
    'activating',
    300
  );
  if v_first.operation_token is null or v_first.status <> 'activating' then
    raise exception 'Atomic activation claim missing';
  end if;

  select count(*) into v_second_count
  from public.claim_openai_ads_launch_operation(
    '24000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    array['ready_to_activate'],
    'activating',
    300
  );
  if v_second_count <> 0 then
    raise exception 'Concurrent activation claim was not blocked';
  end if;

  select public.finish_openai_ads_launch_operation(
    v_first.id,
    gen_random_uuid(),
    '{"status":"ready_to_activate"}'::jsonb
  ) into v_wrong_finish;
  if v_wrong_finish then
    raise exception 'Wrong operation token changed launch state';
  end if;

  update public.ad_platform_launches
  set operation_started_at = now() - interval '10 minutes'
  where id = v_first.id;

  select * into v_recovered
  from public.claim_openai_ads_launch_operation(
    v_first.id,
    v_first.user_id,
    array['ready_to_activate'],
    'activating',
    300
  );
  if v_recovered.operation_token is null
     or v_recovered.operation_token = v_first.operation_token then
    raise exception 'Stale activation claim was not safely reclaimed';
  end if;

  begin
    update public.ad_platform_launches
    set request_payload = request_payload || '{"tampered":true}'::jsonb
    where id = v_first.id;
  exception when others then
    v_immutable_blocked := true;
  end;
  if not v_immutable_blocked then
    raise exception 'OpenAI launch contract remained mutable';
  end if;

  select public.finish_openai_ads_launch_operation(
    v_recovered.id,
    v_recovered.operation_token,
    '{"status":"ready_to_activate","error_code":null}'::jsonb
  ) into v_right_finish;
  if not v_right_finish then
    raise exception 'Correct operation token could not finish launch';
  end if;
end;
$$;

-- Browser role sees only its own connector rows and cannot read ciphertext.
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-000000000001';

do $$
declare
  v_count integer;
  v_can_execute boolean;
  v_secret_read_blocked boolean := false;
  v_launch_token_read_blocked boolean := false;
  v_sync_token_read_blocked boolean := false;
begin
  select count(*) into v_count from public.platform_accounts;
  if v_count <> 3 then
    raise exception 'RLS expected three own account rows (two OpenAI plus Meta), got %', v_count;
  end if;

  select has_function_privilege(
    'authenticated',
    'public.claim_ad_platform_sync(uuid,uuid,integer)',
    'EXECUTE'
  ) into v_can_execute;
  if v_can_execute then
    raise exception 'authenticated must not execute claim_ad_platform_sync';
  end if;

  select has_function_privilege(
    'authenticated',
    'public.claim_openai_ads_launch_operation(uuid,uuid,text[],text,integer)',
    'EXECUTE'
  ) into v_can_execute;
  if v_can_execute then
    raise exception 'authenticated must not claim OpenAI launch operations';
  end if;

  select has_function_privilege(
    'authenticated',
    'public.claim_openai_ads_account_sync(uuid,uuid,integer)',
    'EXECUTE'
  ) into v_can_execute;
  if v_can_execute then
    raise exception 'authenticated must not claim OpenAI account syncs';
  end if;

  select has_function_privilege(
    'authenticated',
    'public.fail_openai_ads_account_sync(uuid,uuid,uuid,uuid,text,timestamptz,boolean)',
    'EXECUTE'
  ) into v_can_execute;
  if v_can_execute then
    raise exception 'authenticated must not finish OpenAI account sync failures';
  end if;

  select has_function_privilege(
    'authenticated',
    'public.finish_openai_ads_launch_operation(uuid,uuid,jsonb)',
    'EXECUTE'
  ) into v_can_execute;
  if v_can_execute then
    raise exception 'authenticated must not finish OpenAI launch operations';
  end if;

  select has_function_privilege(
    'authenticated',
    'public.is_valid_openai_ads_paused_daily_contract(jsonb)',
    'EXECUTE'
  ) into v_can_execute;
  if v_can_execute then
    raise exception 'authenticated must not execute the OpenAI launch contract validator';
  end if;

  select has_function_privilege(
    'authenticated',
    'public.openai_ads_serving_issues_allowed(jsonb,text,text,text)',
    'EXECUTE'
  ) into v_can_execute;
  if v_can_execute then
    raise exception 'authenticated must not execute the OpenAI serving issue validator';
  end if;

  select has_function_privilege(
    'authenticated',
    'public.openai_ads_jsonb_nonnegative_number(jsonb,boolean)',
    'EXECUTE'
  ) into v_can_execute;
  if v_can_execute then
    raise exception 'authenticated must not execute the OpenAI numeric validator';
  end if;

  begin
    perform access_token_encrypted
    from public.platform_accounts
    limit 1;
  exception when insufficient_privilege then
    v_secret_read_blocked := true;
  end;
  if not v_secret_read_blocked then
    raise exception 'authenticated unexpectedly read encrypted credentials';
  end if;

  begin
    perform operation_token
    from public.ad_platform_launches
    limit 1;
  exception when insufficient_privilege then
    v_launch_token_read_blocked := true;
  end;
  if not v_launch_token_read_blocked then
    raise exception 'authenticated unexpectedly read OpenAI launch operation token';
  end if;

  begin
    perform credential_generation, provider_sync_claim_token
    from public.platform_accounts
    limit 1;
  exception when insufficient_privilege then
    v_sync_token_read_blocked := true;
  end;
  if not v_sync_token_read_blocked then
    raise exception 'authenticated unexpectedly read OpenAI sync fencing fields';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

rollback;

select 'OpenAI Ads connector database checks passed' as result;

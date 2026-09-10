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

-- Claim is atomic and cannot be acquired twice while fresh.
select public.claim_ad_platform_sync(
  '22000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  900
) as first_claim
\gset
\if :first_claim
\else
  \quit 1
\endif

select not public.claim_ad_platform_sync(
  '22000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  900
) as second_claim_blocked
\gset
\if :second_claim_blocked
\else
  \quit 1
\endif

insert into public.ad_platform_sync_runs (
  id, user_id, platform_account_id, platform, status
) values (
  '23000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'openai_ads',
  'running'
);

insert into public.ad_platform_launches (
  id, user_id, platform_account_id, platform, idempotency_key, status,
  request_payload, remote_campaign_id, remote_ad_group_id, remote_ad_id,
  review_status, activated_at
) values (
  '24000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'openai_ads',
  'active-launch-test',
  'in_review',
  '{"dailyBudgetMicros":25000000,"lifetimeBudgetMicros":100000000}'::jsonb,
  'cmp-openai-1',
  'ag-openai-1',
  'ad-openai-1',
  'in_review',
  now()
);

select public.replace_openai_ads_snapshot(
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '{"id":"oa-account-1","name":"OpenAI One","currency_code":"EUR","timezone":"Europe/Berlin","review_status":"approved","account_status":"active"}'::jsonb,
  '[{"id":"cmp-openai-1","name":"Launch","status":"active","objective":"clicks","bidding_type":"clicks","budget_amount_micros":100000000,"daily_budget_amount_micros":25000000,"start_time":1788998400,"end_time":1789603200,"created_at":1788998400,"updated_at":1788998400,"provider_data":{"budget":{"daily_spend_limit_micros":25000000}}}]'::jsonb,
  '[{"id":"ag-openai-1","campaign_id":"cmp-openai-1","name":"Intent","status":"active","billing_event_type":"click","max_bid_micros":2000000,"bid_strategy":"fixed","created_at":1788998400,"updated_at":1788998400,"provider_data":{}}]'::jsonb,
  '[{"id":"ad-openai-1","ad_group_id":"ag-openai-1","name":"Chat card","status":"active","review_status":"approved","creative_type":"chat_card","target_url":"https://example.com/","created_at":1788998400,"updated_at":1788998400,"provider_data":{}}]'::jsonb,
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
      and budget_amount_micros = 100000000
      and daily_budget_amount_micros = 25000000
  ) then
    raise exception 'OpenAI daily/lifetime budget normalization missing';
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
  if v_status <> 'active' then
    raise exception 'Expected approved ACTIVE launch, got %', v_status;
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
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

rollback;

select 'OpenAI Ads connector database checks passed' as result;

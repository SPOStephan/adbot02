\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'other@example.test');

insert into public.platform_accounts (
  id,
  user_id,
  platform,
  platform_account_id,
  account_name,
  access_token,
  ad_account_ids
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'meta',
  'meta-user-1',
  'Test Meta Account',
  null,
  '["act_123456789"]'::jsonb
);

insert into public.meta_assets (
  id,
  platform_account_id,
  user_id,
  asset_type,
  meta_asset_id,
  name
) values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'ad_account',
  'act_123456789',
  'Test Ad Account'
);

create temporary table meta_marketing_fixture (
  account jsonb not null,
  campaigns jsonb not null,
  ad_sets jsonb not null,
  ads jsonb not null,
  creatives jsonb not null,
  insights jsonb not null
) on commit drop;

insert into meta_marketing_fixture values (
  '{
    "meta_ad_account_id": "123456789",
    "name": "Test Ad Account",
    "currency": "EUR",
    "timezone_name": "Europe/Berlin",
    "timezone_offset_hours_utc": 2,
    "account_status": 1
  }'::jsonb,
  '[{
    "platform_campaign_id": "4001",
    "account_id": "123456789",
    "name": "Campaign One",
    "objective": "OUTCOME_TRAFFIC",
    "status": "ACTIVE",
    "effective_status": "ACTIVE",
    "daily_budget_minor": 1000,
    "lifetime_budget_minor": null,
    "budget_remaining_minor": 9000,
    "spend_cap_minor": null,
    "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
    "special_ad_categories": [],
    "start_time": "2026-06-01T00:00:00Z",
    "stop_time": null,
    "platform_created_time": "2026-06-01T00:00:00Z",
    "platform_updated_time": "2026-07-25T00:00:00Z"
  }]'::jsonb,
  '[{
    "platform_ad_set_id": "5001",
    "platform_campaign_id": "4001",
    "account_id": "123456789",
    "name": "Ad Set One",
    "status": "ACTIVE",
    "effective_status": "ACTIVE",
    "optimization_goal": "LINK_CLICKS",
    "billing_event": "IMPRESSIONS",
    "destination_type": "WEBSITE",
    "daily_budget_minor": 1000,
    "lifetime_budget_minor": null,
    "budget_remaining_minor": 9000,
    "bid_amount_minor": null,
    "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
    "start_time": "2026-06-01T00:00:00Z",
    "end_time": null,
    "platform_created_time": "2026-06-01T00:00:00Z",
    "platform_updated_time": "2026-07-25T00:00:00Z"
  }]'::jsonb,
  '[{
    "platform_ad_id": "6001",
    "platform_campaign_id": "4001",
    "platform_ad_set_id": "5001",
    "platform_creative_id": "7001",
    "account_id": "123456789",
    "name": "Ad One",
    "status": "ACTIVE",
    "effective_status": "ACTIVE",
    "platform_created_time": "2026-06-01T00:00:00Z",
    "platform_updated_time": "2026-07-25T00:00:00Z"
  }]'::jsonb,
  '[{
    "platform_creative_id": "7001",
    "account_id": "123456789",
    "name": "Creative One",
    "title": "Read-only test",
    "body": "No Meta writes",
    "call_to_action_type": "LEARN_MORE",
    "thumbnail_url": "https://cdn.example.test/creative.jpg",
    "effective_object_story_id": "page_8001",
    "effective_instagram_media_id": null,
    "instagram_permalink_url": null,
    "object_type": "SHARE",
    "status": "ACTIVE"
  }]'::jsonb,
  '[{
    "platform_campaign_id": "4001",
    "campaign_name": "Campaign One",
    "platform_ad_set_id": "5001",
    "ad_set_name": "Ad Set One",
    "platform_ad_id": "6001",
    "ad_name": "Ad One",
    "account_id": "123456789",
    "date_start": "2026-07-26",
    "date_stop": "2026-07-26",
    "impressions": 1000,
    "reach": 800,
    "frequency": 1.25,
    "clicks": 30,
    "inline_link_clicks": 2,
    "spend": 12.5,
    "cpm": 12.5,
    "cpc": 0.5,
    "ctr": 2.5,
    "actions": {"lead": 2, "purchase": 1},
    "action_values": {"purchase": 49.99},
    "cost_per_action_type": {"lead": 6.25, "purchase": 12.5},
    "attribution_setting": "7d_click_1d_view"
  }]'::jsonb
);

select *
from public.replace_meta_marketing_snapshot(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  (select account from meta_marketing_fixture),
  (select campaigns from meta_marketing_fixture),
  (select ad_sets from meta_marketing_fixture),
  (select ads from meta_marketing_fixture),
  (select creatives from meta_marketing_fixture),
  (select insights from meta_marketing_fixture),
  '2026-06-20',
  '2026-07-26',
  '{"ad_account_percent": 10, "insights_percent": 20}'::jsonb
);

do $$
begin
  if (select count(*) from public.campaigns) <> 1
    or (select count(*) from public.ad_groups) <> 1
    or (select count(*) from public.ads) <> 1
    or (select count(*) from public.creatives where source = 'meta') <> 1
    or (select count(*) from public.performance_data where platform = 'meta') <> 1
    or (select count(*) from public.campaign_recommendations where status = 'active') <> 1 then
    raise exception 'Initial Marketing snapshot counts are incorrect';
  end if;

  if (select leads from public.performance_data limit 1) <> 2
    or (select purchases from public.performance_data limit 1) <> 1
    or (select purchase_value from public.performance_data limit 1) <> 49.99 then
    raise exception 'Allowlisted Meta action metrics are incorrect';
  end if;

  if (select marketing_sync_status from public.platform_accounts limit 1) <> 'success'
    or (select marketing_campaign_count from public.platform_accounts limit 1) <> 1
    or (select marketing_insight_count from public.platform_accounts limit 1) <> 1
    or (select marketing_recommendation_count from public.platform_accounts limit 1) <> 1 then
    raise exception 'Connector Marketing status is incorrect';
  end if;

  if (select rule_key from public.campaign_recommendations where status = 'active' limit 1)
      <> 'low_link_ctr_7d'
    or (select evidence->>'threshold_percent' from public.campaign_recommendations where status = 'active' limit 1)
      <> '0.5' then
    raise exception 'Deterministic recommendation evidence is incorrect';
  end if;
end;
$$;

-- Identical complete input remains idempotent.
select *
from public.replace_meta_marketing_snapshot(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000002',
  (select account from meta_marketing_fixture),
  (select campaigns from meta_marketing_fixture),
  (select ad_sets from meta_marketing_fixture),
  (select ads from meta_marketing_fixture),
  (select creatives from meta_marketing_fixture),
  (select insights from meta_marketing_fixture),
  '2026-06-20',
  '2026-07-26',
  '{}'::jsonb
);

do $$
declare
  before_sync_id uuid;
begin
  select marketing_sync_id into before_sync_id
  from public.platform_accounts
  where id = '20000000-0000-4000-8000-000000000001';

  begin
    perform public.replace_meta_marketing_snapshot(
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000003',
      (select account from meta_marketing_fixture),
      (select campaigns from meta_marketing_fixture),
      (select ad_sets from meta_marketing_fixture),
      (select ads from meta_marketing_fixture),
      (select creatives from meta_marketing_fixture),
      jsonb_set(
        (select insights from meta_marketing_fixture),
        '{0,platform_ad_id}',
        '"unknown-ad"'::jsonb
      ),
      '2026-06-20',
      '2026-07-26',
      '{}'::jsonb
    );
    raise exception 'Invalid hierarchy was not rejected';
  exception
    when others then
      if sqlerrm = 'Invalid hierarchy was not rejected' then
        raise;
      end if;
  end;

  if (select count(*) from public.campaigns) <> 1
    or (select count(*) from public.performance_data where platform = 'meta') <> 1
    or (select marketing_sync_id from public.platform_accounts limit 1) <> before_sync_id then
    raise exception 'Failed snapshot changed previously valid data';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.campaigns', 'SELECT')
    or not has_table_privilege('authenticated', 'public.meta_account_performance_daily', 'SELECT')
    or not has_table_privilege('authenticated', 'public.meta_campaign_performance_30d', 'SELECT')
    or has_table_privilege('authenticated', 'public.campaigns', 'INSERT')
    or has_table_privilege('authenticated', 'public.campaigns', 'UPDATE')
    or has_table_privilege('authenticated', 'public.campaigns', 'DELETE')
    or has_table_privilege('authenticated', 'public.performance_data', 'INSERT')
    or has_table_privilege('authenticated', 'public.campaign_recommendations', 'UPDATE') then
    raise exception 'Browser Marketing grants are too broad';
  end if;

  if not has_column_privilege('authenticated', 'public.campaigns', 'id', 'SELECT')
    or not has_column_privilege('authenticated', 'public.performance_data', 'id', 'SELECT')
    or not has_column_privilege('authenticated', 'public.campaign_recommendations', 'id', 'SELECT')
    or has_column_privilege('authenticated', 'public.campaigns', 'last_seen_sync_id', 'SELECT')
    or has_column_privilege('authenticated', 'public.performance_data', 'last_seen_sync_id', 'SELECT')
    or has_column_privilege('authenticated', 'public.campaign_recommendations', 'evidence_hash', 'SELECT') then
    raise exception 'Authenticated column-level read-only grants are incorrect';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.replace_meta_marketing_snapshot(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,date,date,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.replace_meta_marketing_snapshot(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,date,date,jsonb)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.replace_meta_marketing_snapshot(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,date,date,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.rebuild_meta_campaign_recommendations(uuid,uuid,date,text,timestamptz)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.rebuild_meta_campaign_recommendations(uuid,uuid,date,text,timestamptz)',
      'EXECUTE'
    ) then
    raise exception 'Marketing RPC execution grants are incorrect';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(id) from public.campaigns) <> 1
    or (select count(id) from public.performance_data) <> 1
    or (select count(id) from public.campaign_recommendations) <> 1
    or (select count(*) from public.meta_account_performance_daily) <> 1
    or (select count(*) from public.meta_campaign_performance_30d) <> 1 then
    raise exception 'Owner cannot read own Marketing rows';
  end if;
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

do $$
begin
  if (select count(id) from public.campaigns) <> 0
    or (select count(id) from public.performance_data) <> 0
    or (select count(id) from public.campaign_recommendations) <> 0
    or (select count(*) from public.meta_account_performance_daily) <> 0
    or (select count(*) from public.meta_campaign_performance_30d) <> 0 then
    raise exception 'Cross-tenant Marketing rows are visible';
  end if;
end;
$$;

reset role;
rollback;

\echo 'Meta Marketing migration checks passed'

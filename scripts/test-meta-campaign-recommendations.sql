\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values ('11000000-0000-4000-8000-000000000001', 'rules@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_name, access_token,
  ad_account_ids
) values (
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'meta', 'meta-rules-user', 'Rule Test Account', null,
  '["act_987654321"]'::jsonb
);

insert into public.meta_assets (
  id, platform_account_id, user_id, asset_type, meta_asset_id, name
) values (
  '31000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'ad_account', 'act_987654321', 'Rule Test Ad Account'
);

create temporary table meta_rule_fixture as
with campaign_source as (
  select *
  from (values
    ('4101', 'No Delivery', 'OUTCOME_TRAFFIC', 'ACTIVE'),
    ('4102', 'Rising Cost', 'OUTCOME_LEADS', 'ACTIVE'),
    ('4103', 'No Results', 'OUTCOME_LEADS', 'ACTIVE'),
    ('4104', 'Low Link CTR', 'OUTCOME_TRAFFIC', 'ACTIVE')
  ) as item(id, name, objective, effective_status)
), hierarchy as (
  select
    jsonb_agg(jsonb_build_object(
      'platform_campaign_id', id,
      'account_id', '987654321',
      'name', name,
      'objective', objective,
      'status', 'ACTIVE',
      'effective_status', effective_status,
      'daily_budget_minor', 1000,
      'lifetime_budget_minor', null,
      'budget_remaining_minor', 10000,
      'spend_cap_minor', null,
      'bid_strategy', 'LOWEST_COST_WITHOUT_CAP',
      'special_ad_categories', jsonb_build_array(),
      'start_time', '2026-06-01T00:00:00Z',
      'stop_time', null,
      'platform_created_time', '2026-06-01T00:00:00Z',
      'platform_updated_time', '2026-07-26T00:00:00Z'
    ) order by id) as campaigns,
    jsonb_agg(jsonb_build_object(
      'platform_ad_set_id', '5' || right(id, 3),
      'platform_campaign_id', id,
      'account_id', '987654321',
      'name', name || ' Ad Set',
      'status', 'ACTIVE',
      'effective_status', effective_status,
      'optimization_goal', case when objective = 'OUTCOME_TRAFFIC' then 'LINK_CLICKS' else 'LEAD_GENERATION' end,
      'billing_event', 'IMPRESSIONS',
      'destination_type', 'WEBSITE',
      'daily_budget_minor', 1000,
      'lifetime_budget_minor', null,
      'budget_remaining_minor', 10000,
      'bid_amount_minor', null,
      'bid_strategy', 'LOWEST_COST_WITHOUT_CAP',
      'start_time', '2026-06-01T00:00:00Z',
      'end_time', null,
      'platform_created_time', '2026-06-01T00:00:00Z',
      'platform_updated_time', '2026-07-26T00:00:00Z'
    ) order by id) as ad_sets,
    jsonb_agg(jsonb_build_object(
      'platform_ad_id', '6' || right(id, 3),
      'platform_campaign_id', id,
      'platform_ad_set_id', '5' || right(id, 3),
      'platform_creative_id', '7' || right(id, 3),
      'account_id', '987654321',
      'name', name || ' Ad',
      'status', 'ACTIVE',
      'effective_status', effective_status,
      'platform_created_time', '2026-06-01T00:00:00Z',
      'platform_updated_time', '2026-07-26T00:00:00Z'
    ) order by id) as ads,
    jsonb_agg(jsonb_build_object(
      'platform_creative_id', '7' || right(id, 3),
      'account_id', '987654321',
      'name', name || ' Creative',
      'title', name,
      'body', 'Deterministic read-only fixture',
      'call_to_action_type', 'LEARN_MORE',
      'thumbnail_url', 'https://cdn.example.test/' || id || '.jpg',
      'effective_object_story_id', null,
      'effective_instagram_media_id', null,
      'instagram_permalink_url', null,
      'object_type', 'SHARE',
      'status', 'ACTIVE'
    ) order by id) as creatives
  from campaign_source
), insight_source as (
  select
    '4102'::text as campaign_id,
    'Rising Cost'::text as campaign_name,
    '5102'::text as ad_set_id,
    'Rising Cost Ad Set'::text as ad_set_name,
    '6102'::text as ad_id,
    'Rising Cost Ad'::text as ad_name,
    day::date,
    case when day::date <= date '2026-07-19' then 10::numeric else 20::numeric end as spend,
    1000::bigint as impressions,
    50::bigint as link_clicks,
    '{"lead": 2}'::jsonb as actions
  from generate_series(date '2026-07-13', date '2026-07-26', interval '1 day') day

  union all

  select
    '4103', 'No Results', '5103', 'No Results Ad Set', '6103', 'No Results Ad',
    day::date, 5::numeric, 100::bigint, 10::bigint, '{"lead": 0}'::jsonb
  from generate_series(date '2026-07-13', date '2026-07-26', interval '1 day') day

  union all

  select
    '4104', 'Low Link CTR', '5104', 'Low Link CTR Ad Set', '6104', 'Low Link CTR Ad',
    day::date, 4::numeric, 200::bigint, 0::bigint, '{}'::jsonb
  from generate_series(date '2026-07-20', date '2026-07-26', interval '1 day') day
), insight_payload as (
  select jsonb_agg(jsonb_build_object(
    'platform_campaign_id', campaign_id,
    'campaign_name', campaign_name,
    'platform_ad_set_id', ad_set_id,
    'ad_set_name', ad_set_name,
    'platform_ad_id', ad_id,
    'ad_name', ad_name,
    'account_id', '987654321',
    'date_start', day,
    'date_stop', day,
    'impressions', impressions,
    'reach', greatest(impressions - 20, 1),
    'frequency', 1.1,
    'clicks', link_clicks,
    'inline_link_clicks', link_clicks,
    'spend', spend,
    'cpm', spend * 1000 / impressions,
    'cpc', case when link_clicks > 0 then spend / link_clicks else null end,
    'ctr', link_clicks * 100.0 / impressions,
    'actions', actions,
    'action_values', '{}'::jsonb,
    'cost_per_action_type', '{}'::jsonb,
    'attribution_setting', '7d_click_1d_view'
  ) order by campaign_id, day) as insights
  from insight_source
)
select
  '{
    "meta_ad_account_id": "987654321",
    "name": "Rule Test Ad Account",
    "currency": "EUR",
    "timezone_name": "Europe/Berlin",
    "timezone_offset_hours_utc": 2,
    "account_status": 1
  }'::jsonb as account,
  hierarchy.campaigns,
  hierarchy.ad_sets,
  hierarchy.ads,
  hierarchy.creatives,
  insight_payload.insights
from hierarchy cross join insight_payload;

select *
from public.replace_meta_marketing_snapshot(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  (select account from meta_rule_fixture),
  (select campaigns from meta_rule_fixture),
  (select ad_sets from meta_rule_fixture),
  (select ads from meta_rule_fixture),
  (select creatives from meta_rule_fixture),
  (select insights from meta_rule_fixture),
  '2026-06-20',
  '2026-07-26',
  '{}'::jsonb
);

do $$
begin
  if (select count(*) from public.campaign_recommendations where status = 'active') <> 4
    or (select count(*) from public.campaign_recommendations where rule_key = 'active_without_delivery_3d' and status = 'active') <> 1
    or (select count(*) from public.campaign_recommendations where rule_key = 'cost_per_result_up_30pct' and status = 'active') <> 1
    or (select count(*) from public.campaign_recommendations where rule_key = 'spend_without_results_14d' and status = 'active') <> 1
    or (select count(*) from public.campaign_recommendations where rule_key = 'low_link_ctr_7d' and status = 'active') <> 1 then
    raise exception 'Expected deterministic recommendation set was not generated';
  end if;

  if exists (
    select 1
    from public.campaign_recommendations
    where status = 'active'
      and (
        evidence_hash <> md5(evidence::text)
        or window_start > window_end
        or expires_at <= generated_at
        or summary = ''
      )
  ) then
    raise exception 'Recommendation evidence or lifecycle is invalid';
  end if;

  if (select marketing_recommendation_count from public.platform_accounts where id = '21000000-0000-4000-8000-000000000001') <> 4 then
    raise exception 'Connector recommendation count is incorrect';
  end if;
end;
$$;

-- Rebuilding identical evidence remains idempotent.
select *
from public.replace_meta_marketing_snapshot(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000002',
  (select account from meta_rule_fixture),
  (select campaigns from meta_rule_fixture),
  (select ad_sets from meta_rule_fixture),
  (select ads from meta_rule_fixture),
  (select creatives from meta_rule_fixture),
  (select insights from meta_rule_fixture),
  '2026-06-20',
  '2026-07-26',
  '{}'::jsonb
);

do $$
begin
  if (select count(*) from public.campaign_recommendations where status = 'active') <> 4
    or (select count(distinct target_key || ':' || rule_key) from public.campaign_recommendations where status = 'active') <> 4 then
    raise exception 'Recommendation rebuild is not idempotent';
  end if;
end;
$$;

-- A rule that no longer applies expires instead of disappearing or remaining active.
update public.campaigns
set effective_status = 'PAUSED', updated_at = now()
where platform_account_id = '21000000-0000-4000-8000-000000000001'
  and platform_campaign_id = '4101';

select public.rebuild_meta_campaign_recommendations(
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '2026-07-26',
  'EUR',
  now() + interval '1 hour'
);

do $$
begin
  if (select count(*) from public.campaign_recommendations where status = 'active') <> 3
    or (select count(*) from public.campaign_recommendations where rule_key = 'active_without_delivery_3d' and status = 'expired') <> 1 then
    raise exception 'Recommendation expiration is incorrect';
  end if;
end;
$$;

rollback;

\echo 'Meta campaign recommendation checks passed'

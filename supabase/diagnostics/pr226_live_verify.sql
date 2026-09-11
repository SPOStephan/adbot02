-- PR #226 live verification (read-only)
-- Run after both migration files in the SQL Editor of project ref: aalmikwjyhdcmfeblofn

begin transaction read only;

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_accounts'
      and column_name = 'provider_sync_status'
  ) as has_provider_sync_status,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'daily_budget_amount_micros'
  ) as has_daily_budget_amount_micros,
  to_regclass('public.ad_platform_sync_runs') is not null
    as has_ad_platform_sync_runs,
  to_regclass('public.ad_platform_launches') is not null
    as has_ad_platform_launches,
  to_regclass('public.cross_platform_account_performance_daily') is not null
    as has_cross_platform_account_view,
  to_regclass('public.cross_platform_campaign_performance_30d') is not null
    as has_cross_platform_campaign_view,
  to_regprocedure('public.claim_ad_platform_sync(uuid,uuid,integer)') is not null
    as has_claim_sync_function,
  to_regprocedure(
    'public.replace_openai_ads_snapshot(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)'
  ) is not null as has_replace_snapshot_function,
  to_regprocedure(
    'public.invalidate_meta_marketing_state_on_connection_change()'
  ) is not null as has_meta_invalidation_function,
  to_regclass('public.brand_assets_account_sha256_upsert_uidx') is not null
    as has_brand_asset_upsert_index;

select exists (
  select 1
  from pg_trigger trigger_row
  join pg_class table_row on table_row.oid = trigger_row.tgrelid
  join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
  where schema_row.nspname = 'public'
    and table_row.relname = 'platform_accounts'
    and trigger_row.tgname = 'platform_accounts_invalidate_meta_marketing_state'
    and not trigger_row.tgisinternal
) as has_meta_invalidation_trigger;

select
  has_column_privilege(
    'authenticated', 'public.mutation_plans', 'id', 'SELECT'
  ) as authenticated_can_read_safe_plan_id,
  has_column_privilege(
    'authenticated', 'public.mutation_plans', 'planned_payload', 'SELECT'
  ) as authenticated_can_read_internal_planned_payload;

select
  count(*) filter (where platform = 'meta') as meta_rows,
  count(*) filter (
    where platform = 'meta' and revoked_at is null
  ) as active_meta_rows,
  count(*) filter (
    where platform = 'meta'
      and revoked_at is null
      and access_token_encrypted is not null
  ) as active_meta_rows_with_encrypted_token,
  count(*) filter (
    where platform = 'openai_ads'
  ) as openai_ads_rows
from public.platform_accounts;

select count(*) as users_with_multiple_meta_rows
from (
  select user_id
  from public.platform_accounts
  where platform = 'meta'
  group by user_id
  having count(*) > 1
) duplicates;

rollback;

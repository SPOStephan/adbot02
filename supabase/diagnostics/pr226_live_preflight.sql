-- PR #226 live preflight (read-only)
-- Run this first in the SQL Editor of project ref: aalmikwjyhdcmfeblofn

begin transaction read only;

select
  current_user as executing_role,
  current_database() as database_name,
  to_regclass('public.platform_accounts') is not null as has_platform_accounts,
  to_regclass('public.mutation_plans') is not null as has_mutation_plans,
  to_regclass('public.daily_budget_exposure_snapshots') is not null
    as has_budget_exposure_snapshots,
  to_regclass('public.brand_assets') is not null as has_brand_assets;

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

select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_accounts'
      and column_name = 'provider_sync_status'
  ) as openai_foundation_already_present,
  to_regprocedure(
    'public.invalidate_meta_marketing_state_on_connection_change()'
  ) is not null as integrity_forward_fix_already_present;

rollback;

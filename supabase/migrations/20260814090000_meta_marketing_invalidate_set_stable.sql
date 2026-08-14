-- Asset reconnect / OAuth rewrite must not wipe a healthy marketing snapshot
-- when the authorized ad-account *set* is unchanged (JSON order churn) or the
-- currently used marketing ad account remains authorized.
-- Also: planner ACCOUNT_UNAVAILABLE names the failed readiness checks.

begin;

create or replace function public.invalidate_meta_marketing_on_asset_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_ids text[];
  v_new_ids text[];
  v_marketing_id text;
  v_primary_still_allowed boolean := false;
begin
  if old.platform is distinct from 'meta'
    or old.ad_account_ids is not distinct from new.ad_account_ids then
    return new;
  end if;

  select coalesce(array_agg(x order by x), array[]::text[])
  into v_old_ids
  from (
    select distinct regexp_replace(value, '^act_', '') as x
    from jsonb_array_elements_text(coalesce(old.ad_account_ids, '[]'::jsonb)) as t(value)
    where nullif(trim(value), '') is not null
  ) normalized_old;

  select coalesce(array_agg(x order by x), array[]::text[])
  into v_new_ids
  from (
    select distinct regexp_replace(value, '^act_', '') as x
    from jsonb_array_elements_text(coalesce(new.ad_account_ids, '[]'::jsonb)) as t(value)
    where nullif(trim(value), '') is not null
  ) normalized_new;

  -- Same authorized set (order/format only) — keep Live-Daten.
  if v_old_ids = v_new_ids then
    return new;
  end if;

  v_marketing_id := nullif(regexp_replace(coalesce(new.marketing_meta_ad_account_id, ''), '^act_', ''), '');

  if v_marketing_id is not null then
    v_primary_still_allowed := v_marketing_id = any(v_new_ids);
  elsif cardinality(v_old_ids) > 0 then
    -- No explicit marketing account yet: keep snapshot if any previous id remains.
    v_primary_still_allowed := exists (
      select 1
      from unnest(v_old_ids) as old_id(value)
      where old_id.value = any(v_new_ids)
    );
  end if;

  -- Additive reconnect (pages/IG) or extra ad accounts while primary stays:
  -- do not blank currency / sync_id — Beitrag-Push would otherwise go ACCOUNT_UNAVAILABLE.
  if v_primary_still_allowed then
    return new;
  end if;

  update public.campaigns
  set is_current = false, updated_at = now()
  where platform_account_id = new.id;

  update public.ad_groups
  set is_current = false, updated_at = now()
  where platform_account_id = new.id;

  update public.ads
  set is_current = false, updated_at = now()
  where platform_account_id = new.id;

  update public.creatives
  set is_current = false, updated_at = now()
  where platform_account_id = new.id and source = 'meta';

  update public.campaign_recommendations
  set status = 'expired', updated_at = now()
  where platform_account_id = new.id and status = 'active';

  update public.platform_accounts
  set
    marketing_meta_ad_account_id = null,
    marketing_currency = null,
    marketing_timezone_name = null,
    marketing_timezone_offset_hours_utc = null,
    marketing_account_status = null,
    marketing_sync_status = 'idle',
    marketing_sync_error_code = null,
    marketing_last_sync_started_at = null,
    marketing_last_success_at = null,
    marketing_next_sync_at = now(),
    marketing_backoff_until = null,
    marketing_consecutive_failures = 0,
    marketing_campaign_count = 0,
    marketing_ad_set_count = 0,
    marketing_ad_count = 0,
    marketing_creative_count = 0,
    marketing_insight_count = 0,
    marketing_recommendation_count = 0,
    marketing_insights_since = null,
    marketing_insights_until = null,
    marketing_sync_id = null,
    marketing_usage = '{}'::jsonb,
    updated_at = now()
  where id = new.id;

  return new;
end;
$$;

comment on function public.invalidate_meta_marketing_on_asset_change() is
  'Wipe marketing snapshot only when the authorized ad-account set loses the active marketing account (not on JSON order churn or additive reconnects).';

commit;

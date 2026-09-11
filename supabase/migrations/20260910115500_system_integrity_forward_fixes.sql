begin;

-- Never let a successful marketing snapshot survive a Meta authorization reset
-- or a change of the granted Meta user/ad-account set.  This trigger protects
-- every current and future server-side reconnect path, not only one RPC body.
create or replace function public.invalidate_meta_marketing_state_on_connection_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.platform = 'meta'
    and new.platform = 'meta'
    and (
      old.meta_user_id is distinct from new.meta_user_id
      or old.ad_account_ids is distinct from new.ad_account_ids
      or old.revoked_at is distinct from new.revoked_at
    )
  then
    if old.marketing_sync_id is not null then
      update public.mutation_plans plan
      set
        status = 'STALE',
        blocked_reason = 'meta_authorization_changed',
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        terminal_at = coalesce(plan.terminal_at, now()),
        updated_at = now()
      where plan.platform_account_id = old.id
        and plan.source_marketing_sync_id = old.marketing_sync_id
        and plan.status in (
          'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
          'RETRYABLE', 'COMPENSATION_REQUIRED'
        );
    end if;

    new.marketing_meta_ad_account_id := null;
    new.marketing_currency := null;
    new.marketing_timezone_name := null;
    new.marketing_timezone_offset_hours_utc := null;
    new.marketing_account_status := null;
    new.marketing_sync_status := 'idle';
    new.marketing_sync_error_code := 'authorization_changed';
    new.marketing_last_sync_started_at := null;
    new.marketing_last_success_at := null;
    new.marketing_next_sync_at := null;
    new.marketing_backoff_until := null;
    new.marketing_consecutive_failures := 0;
    new.marketing_campaign_count := 0;
    new.marketing_ad_set_count := 0;
    new.marketing_ad_count := 0;
    new.marketing_creative_count := 0;
    new.marketing_insight_count := 0;
    new.marketing_recommendation_count := 0;
    new.marketing_insights_since := null;
    new.marketing_insights_until := null;
    new.marketing_sync_id := null;
    new.marketing_usage := '{}'::jsonb;
    new.marketing_spend_total := null;
    new.marketing_spend_today := null;
    new.marketing_insight_spend_rows := null;
  end if;

  return new;
end;
$$;

revoke all on function public.invalidate_meta_marketing_state_on_connection_change()
  from public, anon, authenticated;
grant execute on function public.invalidate_meta_marketing_state_on_connection_change()
  to service_role;

drop trigger if exists platform_accounts_invalidate_meta_marketing_state
  on public.platform_accounts;
create trigger platform_accounts_invalidate_meta_marketing_state
before update of meta_user_id, ad_account_ids, revoked_at
on public.platform_accounts
for each row
execute function public.invalidate_meta_marketing_state_on_connection_change();

-- Repair already-reset rows on databases where the older reset function ran
-- before this forward migration existed.
update public.platform_accounts account
set
  marketing_meta_ad_account_id = null,
  marketing_currency = null,
  marketing_timezone_name = null,
  marketing_timezone_offset_hours_utc = null,
  marketing_account_status = null,
  marketing_sync_status = 'idle',
  marketing_sync_error_code = 'authorization_changed',
  marketing_last_sync_started_at = null,
  marketing_last_success_at = null,
  marketing_next_sync_at = null,
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
  marketing_spend_total = null,
  marketing_spend_today = null,
  marketing_insight_spend_rows = null,
  updated_at = now()
where account.platform = 'meta'
  and account.revoked_at is not null
  and (
    account.marketing_sync_id is not null
    or account.marketing_last_success_at is not null
    or account.marketing_meta_ad_account_id is not null
  );

-- This definition was corrected in a historical migration after that timestamp
-- had already shipped.  Repeat it under a new version so upgraded databases and
-- fresh databases receive the same function body.
create or replace function public.enrich_meta_customer_launch_prepare_result(
  p_result jsonb,
  p_brand_asset_id uuid,
  p_budget_type text,
  p_prepared_at timestamptz default now()
)
returns jsonb
language sql
immutable
as $$
  select case
    when p_result is null or jsonb_typeof(p_result) is distinct from 'object'
      then p_result
    else p_result
      || jsonb_build_object(
        'brand_asset_ids',
        case
          when jsonb_typeof(p_result->'brand_asset_ids') = 'array'
            and jsonb_array_length(p_result->'brand_asset_ids') > 0
            then p_result->'brand_asset_ids'
          else jsonb_build_array(p_brand_asset_id)
        end,
        'prepared_at',
        coalesce(
          nullif(p_result->>'prepared_at', ''),
          p_prepared_at::text
        ),
        'budget_type',
        coalesce(
          nullif(p_result->>'budget_type', ''),
          p_budget_type
        )
      )
  end;
$$;

revoke all on function public.enrich_meta_customer_launch_prepare_result(
  jsonb, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.enrich_meta_customer_launch_prepare_result(
  jsonb, uuid, text, timestamptz
) to service_role;

comment on function public.enrich_meta_customer_launch_prepare_result(
  jsonb, uuid, text, timestamptz
) is
  'Fill brand_asset_ids / prepared_at / budget_type for customer launch prepare RPC answers.';

-- Reassert the browser-safe column contract after all feature migrations.
-- Internal planned payloads contain provider mutation details and remain
-- service-role-only even when the owning user can inspect plan status.
revoke all on table public.mutation_plans from public, anon, authenticated;
grant select (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_recommendation_id, source_rule_key, source_rule_version, action_type,
  target_type, target_key, campaign_scope_key, budget_owner_key,
  automation_target_id, status, priority, safety_action, not_before,
  attempt_count, max_attempts, blocked_reason, error_class, terminal_at,
  created_at, updated_at
) on public.mutation_plans to authenticated;
grant select on table public.mutation_plans to service_role;

-- The organic-rebind migration accidentally replaced the ordinary same-day
-- snapshot relink rule added by 20260802073000. Preserve both behaviors.
create or replace function public.guard_meta_exposure_non_decreasing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_new_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_snapshot_relink_allowed boolean := true;
begin
  if current_setting('app.meta_organic_rebind', true) = '1' then
    if new.user_id is distinct from old.user_id
      or new.platform_account_id is distinct from old.platform_account_id
      or new.campaign_scope_key is distinct from old.campaign_scope_key
      or new.budget_owner_key is distinct from old.budget_owner_key
      or new.budget_owner_type is distinct from old.budget_owner_type
      or (old.shared_budget_enabled and not new.shared_budget_enabled)
      or new.currency is distinct from old.currency
      or new.max_daily_budget_minor < old.max_daily_budget_minor
      or new.flex_spend_multiplier_bps < old.flex_spend_multiplier_bps
      or new.created_at is distinct from old.created_at then
      raise exception 'Daily budget exposure identity and maxima cannot decrease';
    end if;
    return new;
  end if;

  if new.policy_id is distinct from old.policy_id
    or new.snapshot_id is distinct from old.snapshot_id then
    v_snapshot_relink_allowed := false;

    select snapshot.* into v_old_snapshot
    from public.daily_budget_exposure_snapshots snapshot
    where snapshot.id = old.snapshot_id;

    select snapshot.* into v_new_snapshot
    from public.daily_budget_exposure_snapshots snapshot
    where snapshot.id = new.snapshot_id;

    if v_old_snapshot.id is not null
      and v_new_snapshot.id is not null
      and v_old_snapshot.user_id = old.user_id
      and v_old_snapshot.platform_account_id = old.platform_account_id
      and v_old_snapshot.policy_id = old.policy_id
      and v_old_snapshot.account_day = old.account_day
      and v_old_snapshot.currency = old.currency
      and v_new_snapshot.user_id = new.user_id
      and v_new_snapshot.platform_account_id = new.platform_account_id
      and v_new_snapshot.policy_id = new.policy_id
      and v_new_snapshot.account_day = new.account_day
      and v_new_snapshot.currency = new.currency
      and v_new_snapshot.status in ('BUILDING', 'COMPLETE')
      and v_new_snapshot.created_at >= v_old_snapshot.created_at
      and exists (
        select 1
        from public.platform_accounts account
        where account.id = new.platform_account_id
          and account.user_id = new.user_id
          and account.marketing_sync_status = 'success'
          and account.marketing_sync_id = v_new_snapshot.source_marketing_sync_id
      )
      and exists (
        select 1
        from public.automation_policies policy
        where policy.id = new.policy_id
          and policy.user_id = new.user_id
          and policy.platform_account_id = new.platform_account_id
          and policy.is_current
          and policy.status = 'ACTIVE'
          and policy.currency = new.currency
      ) then
      v_snapshot_relink_allowed := true;
    end if;
  end if;

  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or not v_snapshot_relink_allowed
    or new.account_day is distinct from old.account_day
    or new.campaign_scope_key is distinct from old.campaign_scope_key
    or new.budget_owner_key is distinct from old.budget_owner_key
    or new.budget_owner_type is distinct from old.budget_owner_type
    or (old.shared_budget_enabled and not new.shared_budget_enabled)
    or new.currency is distinct from old.currency
    or new.max_daily_budget_minor < old.max_daily_budget_minor
    or new.flex_spend_multiplier_bps < old.flex_spend_multiplier_bps
    or new.created_at is distinct from old.created_at then
    raise exception 'Daily budget exposure identity and maxima cannot decrease';
  end if;

  return new;
end;
$$;

comment on function public.guard_meta_exposure_non_decreasing() is
  'Keeps exposure identity and maxima monotone while permitting verified same-day snapshot relinks and controlled organic rebinds.';

-- complete_creative_asset_job uses ON CONFLICT (platform_account_id, sha256).
-- The later partial customer-library index cannot arbitrate that statement.
-- A regular unique index preserves account-level deduplication; PostgreSQL's
-- default NULL-distinct behavior leaves inspiration rows to their own index.
create unique index if not exists brand_assets_account_sha256_upsert_uidx
  on public.brand_assets (platform_account_id, sha256);

-- The original table constraint already owns an equivalent unique index.
drop index if exists public.platform_accounts_user_platform_remote_uidx;

commit;

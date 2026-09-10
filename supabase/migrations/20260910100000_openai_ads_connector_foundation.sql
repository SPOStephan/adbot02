begin;

-- Adbot: provider-neutral foundation for the first non-Meta connector.
-- OpenAI Ads API keys are account-scoped, so one user may own multiple
-- connections for the same platform. Meta keeps its existing single row.
drop index if exists public.platform_accounts_user_platform_uidx;

create unique index if not exists platform_accounts_user_platform_remote_uidx
  on public.platform_accounts (user_id, platform, platform_account_id);

create unique index if not exists platform_accounts_user_meta_singleton_uidx
  on public.platform_accounts (user_id)
  where platform = 'meta';

-- The prior Meta reconnect function used ON CONFLICT (user_id, platform),
-- which requires the removed global unique index. Keep Meta as a singleton
-- through the partial index above and update-or-insert its row explicitly.
create or replace function public.replace_meta_connection(
  p_user_id uuid,
  p_meta_user_id text,
  p_account_name text,
  p_access_token_encrypted text,
  p_token_iv text,
  p_token_auth_tag text,
  p_expires_at timestamptz,
  p_refresh_at timestamptz,
  p_data_access_expires_at timestamptz,
  p_scopes text[],
  p_page_ids jsonb,
  p_ad_account_ids jsonb,
  p_instagram_account_ids jsonb,
  p_assets jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_platform_account_id uuid;
begin
  if jsonb_typeof(p_assets) is distinct from 'array'
    or jsonb_typeof(p_page_ids) is distinct from 'array'
    or jsonb_typeof(p_ad_account_ids) is distinct from 'array'
    or jsonb_typeof(p_instagram_account_ids) is distinct from 'array'
  then
    raise exception 'Meta asset inputs must be JSON arrays';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':meta', 0)
  );

  select pa.id
    into v_platform_account_id
  from public.platform_accounts pa
  where pa.user_id = p_user_id
    and pa.platform = 'meta'
  for update;

  if v_platform_account_id is null then
    insert into public.platform_accounts (
      user_id,
      platform,
      platform_account_id,
      account_id,
      account_name,
      access_token,
      refresh_token,
      access_token_encrypted,
      token_iv,
      token_auth_tag,
      token_version,
      meta_user_id,
      meta_business_id,
      meta_scopes,
      page_ids,
      ad_account_ids,
      instagram_account_ids,
      expires_at,
      refresh_at,
      data_access_expires_at,
      connected_at,
      revoked_at,
      baseline_completed_at,
      last_sync_started_at,
      last_synced_at,
      next_sync_at,
      sync_lock_until,
      sync_backoff_until,
      sync_status,
      sync_error_code,
      sync_consecutive_failures,
      last_sync_seen_count,
      last_sync_new_count,
      sync_usage,
      updated_at
    ) values (
      p_user_id,
      'meta',
      p_meta_user_id,
      p_meta_user_id,
      p_account_name,
      null,
      null,
      p_access_token_encrypted,
      p_token_iv,
      p_token_auth_tag,
      1,
      p_meta_user_id,
      null,
      p_scopes,
      p_page_ids,
      p_ad_account_ids,
      p_instagram_account_ids,
      p_expires_at,
      p_refresh_at,
      p_data_access_expires_at,
      now(),
      null,
      null,
      null,
      null,
      now(),
      null,
      null,
      'idle',
      null,
      0,
      0,
      0,
      '{}'::jsonb,
      now()
    )
    returning id into v_platform_account_id;
  else
    update public.platform_accounts
    set
      platform_account_id = p_meta_user_id,
      account_id = p_meta_user_id,
      account_name = p_account_name,
      access_token = null,
      refresh_token = null,
      access_token_encrypted = p_access_token_encrypted,
      token_iv = p_token_iv,
      token_auth_tag = p_token_auth_tag,
      token_version = 1,
      meta_user_id = p_meta_user_id,
      meta_business_id = null,
      meta_scopes = p_scopes,
      page_ids = p_page_ids,
      ad_account_ids = p_ad_account_ids,
      instagram_account_ids = p_instagram_account_ids,
      expires_at = p_expires_at,
      refresh_at = p_refresh_at,
      data_access_expires_at = p_data_access_expires_at,
      connected_at = now(),
      revoked_at = null,
      next_sync_at = now(),
      sync_lock_until = null,
      sync_backoff_until = null,
      sync_status = 'idle',
      sync_error_code = null,
      sync_consecutive_failures = 0,
      updated_at = now()
    where id = v_platform_account_id;
  end if;

  insert into public.meta_assets (
    platform_account_id,
    user_id,
    asset_type,
    meta_asset_id,
    parent_meta_asset_id,
    name,
    username
  )
  select
    v_platform_account_id,
    p_user_id,
    asset.asset_type,
    asset.meta_asset_id,
    asset.parent_meta_asset_id,
    asset.name,
    asset.username
  from jsonb_to_recordset(p_assets) as asset(
    asset_type text,
    meta_asset_id text,
    parent_meta_asset_id text,
    name text,
    username text
  )
  where asset.asset_type in ('facebook_page', 'instagram_account', 'ad_account')
    and asset.meta_asset_id is not null
    and asset.name is not null
  on conflict (platform_account_id, asset_type, meta_asset_id)
  do update set
    user_id = excluded.user_id,
    parent_meta_asset_id = excluded.parent_meta_asset_id,
    name = excluded.name,
    username = excluded.username,
    updated_at = now();

  delete from public.meta_assets existing_asset
  where existing_asset.platform_account_id = v_platform_account_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_assets) as selected_asset(
        asset_type text,
        meta_asset_id text,
        parent_meta_asset_id text,
        name text,
        username text
      )
      where selected_asset.asset_type = existing_asset.asset_type
        and selected_asset.meta_asset_id = existing_asset.meta_asset_id
    );

  return v_platform_account_id;
end;
$$;

revoke all on function public.replace_meta_connection(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  timestamptz, text[], jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_meta_connection(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  timestamptz, text[], jsonb, jsonb, jsonb, jsonb
) to service_role;

alter table public.platform_accounts
  add column if not exists credential_kind text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists provider_sync_status text not null default 'idle',
  add column if not exists provider_sync_error_code text,
  add column if not exists provider_last_sync_started_at timestamptz,
  add column if not exists provider_last_success_at timestamptz,
  add column if not exists provider_next_sync_at timestamptz,
  add column if not exists provider_backoff_until timestamptz,
  add column if not exists provider_consecutive_failures integer not null default 0,
  add column if not exists provider_campaign_count integer not null default 0,
  add column if not exists provider_ad_group_count integer not null default 0,
  add column if not exists provider_ad_count integer not null default 0,
  add column if not exists provider_insight_count integer not null default 0;

alter table public.platform_accounts
  drop constraint if exists platform_accounts_credential_kind_check,
  add constraint platform_accounts_credential_kind_check
    check (
      credential_kind is null
      or credential_kind in ('oauth_access_token', 'api_key')
    ),
  drop constraint if exists platform_accounts_provider_metadata_object_check,
  add constraint platform_accounts_provider_metadata_object_check
    check (jsonb_typeof(provider_metadata) = 'object'),
  drop constraint if exists platform_accounts_provider_sync_status_check,
  add constraint platform_accounts_provider_sync_status_check
    check (provider_sync_status in ('idle', 'syncing', 'success', 'error', 'revoked')),
  drop constraint if exists platform_accounts_provider_counts_check,
  add constraint platform_accounts_provider_counts_check
    check (
      provider_consecutive_failures >= 0
      and provider_campaign_count >= 0
      and provider_ad_group_count >= 0
      and provider_ad_count >= 0
      and provider_insight_count >= 0
    );

create index if not exists platform_accounts_provider_due_idx
  on public.platform_accounts (provider_next_sync_at, provider_backoff_until)
  where platform = 'openai_ads' and revoked_at is null;

alter table public.campaigns
  add column if not exists budget_amount_micros bigint,
  add column if not exists daily_budget_amount_micros bigint,
  add column if not exists provider_data jsonb not null default '{}'::jsonb;

alter table public.campaigns
  drop constraint if exists campaigns_budget_amount_micros_check,
  add constraint campaigns_budget_amount_micros_check
    check (budget_amount_micros is null or budget_amount_micros >= 0),
  drop constraint if exists campaigns_daily_budget_amount_micros_check,
  add constraint campaigns_daily_budget_amount_micros_check
    check (
      daily_budget_amount_micros is null
      or daily_budget_amount_micros >= 0
    ),
  drop constraint if exists campaigns_provider_data_object_check,
  add constraint campaigns_provider_data_object_check
    check (jsonb_typeof(provider_data) = 'object');

alter table public.ad_groups
  add column if not exists bid_amount_micros bigint,
  add column if not exists provider_data jsonb not null default '{}'::jsonb;

alter table public.ad_groups
  drop constraint if exists ad_groups_bid_amount_micros_check,
  add constraint ad_groups_bid_amount_micros_check
    check (bid_amount_micros is null or bid_amount_micros >= 0),
  drop constraint if exists ad_groups_provider_data_object_check,
  add constraint ad_groups_provider_data_object_check
    check (jsonb_typeof(provider_data) = 'object');

alter table public.ads
  add column if not exists review_status text,
  add column if not exists creative_type text,
  add column if not exists target_url text,
  add column if not exists provider_data jsonb not null default '{}'::jsonb;

alter table public.ads
  drop constraint if exists ads_review_status_check,
  add constraint ads_review_status_check
    check (
      review_status is null
      or review_status in ('in_review', 'rejected', 'approved')
    ),
  drop constraint if exists ads_target_url_length_check,
  add constraint ads_target_url_length_check
    check (target_url is null or char_length(target_url) <= 2048),
  drop constraint if exists ads_provider_data_object_check,
  add constraint ads_provider_data_object_check
    check (jsonb_typeof(provider_data) = 'object');

alter table public.performance_data
  add column if not exists data_status text,
  add column if not exists provider_data jsonb not null default '{}'::jsonb;

alter table public.performance_data
  drop constraint if exists performance_data_provider_data_object_check,
  add constraint performance_data_provider_data_object_check
    check (jsonb_typeof(provider_data) = 'object');

create table if not exists public.ad_platform_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete cascade,
  platform text not null,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'error')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(counts) = 'object'),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists ad_platform_sync_runs_account_started_idx
  on public.ad_platform_sync_runs (platform_account_id, started_at desc);

create table if not exists public.ad_platform_launches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  platform text not null,
  idempotency_key text not null,
  status text not null default 'creating'
    check (
      status in (
        'creating',
        'paused',
        'in_review',
        'ready_to_activate',
        'activating',
        'active',
        'blocked',
        'failed',
        'activation_uncertain'
      )
    ),
  request_payload jsonb not null
    check (jsonb_typeof(request_payload) = 'object'),
  remote_campaign_id text,
  remote_ad_group_id text,
  remote_ad_id text,
  remote_file_id text,
  review_status text
    check (
      review_status is null
      or review_status in ('in_review', 'rejected', 'approved')
    ),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  constraint ad_platform_launches_account_idempotency_key
    unique (platform_account_id, idempotency_key)
);

create index if not exists ad_platform_launches_user_created_idx
  on public.ad_platform_launches (user_id, created_at desc);

alter table public.ad_platform_sync_runs enable row level security;
alter table public.ad_platform_launches enable row level security;

revoke all privileges on table public.ad_platform_sync_runs
  from public, anon, authenticated;
revoke all privileges on table public.ad_platform_launches
  from public, anon, authenticated;

grant select (
  id, user_id, platform_account_id, platform, status, started_at,
  completed_at, counts, error_code, created_at
) on public.ad_platform_sync_runs to authenticated;

grant select (
  id, user_id, platform_account_id, platform, status,
  remote_campaign_id, remote_ad_group_id, remote_ad_id,
  review_status, error_code, created_at, updated_at, activated_at
) on public.ad_platform_launches to authenticated;

grant all privileges on table public.ad_platform_sync_runs to service_role;
grant all privileges on table public.ad_platform_launches to service_role;

drop policy if exists ad_platform_sync_runs_select_own
  on public.ad_platform_sync_runs;
create policy ad_platform_sync_runs_select_own
on public.ad_platform_sync_runs
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists ad_platform_launches_select_own
  on public.ad_platform_launches;
create policy ad_platform_launches_select_own
on public.ad_platform_launches
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Safe metadata for browser reads. Ciphertext, IV, authentication tag and
-- provider usage details remain inaccessible to authenticated clients.
grant select (
  credential_kind,
  provider_metadata,
  provider_sync_status,
  provider_sync_error_code,
  provider_last_sync_started_at,
  provider_last_success_at,
  provider_next_sync_at,
  provider_backoff_until,
  provider_consecutive_failures,
  provider_campaign_count,
  provider_ad_group_count,
  provider_ad_count,
  provider_insight_count
) on public.platform_accounts to authenticated;

grant select (
  budget_amount_micros,
  daily_budget_amount_micros,
  provider_data
) on public.campaigns to authenticated;

grant select (
  bid_amount_micros,
  provider_data
) on public.ad_groups to authenticated;

grant select (
  review_status,
  creative_type,
  target_url,
  provider_data
) on public.ads to authenticated;

grant select (
  data_status,
  provider_data
) on public.performance_data to authenticated;

create or replace function public.claim_ad_platform_sync(
  p_platform_account_id uuid,
  p_user_id uuid default null,
  p_stale_after_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  if p_stale_after_seconds < 60 or p_stale_after_seconds > 3600 then
    raise exception 'invalid_stale_after_seconds';
  end if;

  update public.platform_accounts pa
  set
    provider_sync_status = 'syncing',
    provider_sync_error_code = null,
    provider_last_sync_started_at = now(),
    updated_at = now()
  where pa.id = p_platform_account_id
    and pa.platform = 'openai_ads'
    and pa.revoked_at is null
    and (p_user_id is null or pa.user_id = p_user_id)
    and (
      pa.provider_sync_status <> 'syncing'
      or pa.provider_last_sync_started_at is null
      or pa.provider_last_sync_started_at
        < now() - make_interval(secs => p_stale_after_seconds)
    )
    and (
      pa.provider_backoff_until is null
      or pa.provider_backoff_until <= now()
    )
  returning pa.id into claimed_id;

  return claimed_id is not null;
end;
$$;

revoke all on function public.claim_ad_platform_sync(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_ad_platform_sync(uuid, uuid, integer)
  to service_role;

create or replace function public.replace_openai_ads_snapshot(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_sync_run_id uuid,
  p_account jsonb,
  p_campaigns jsonb,
  p_ad_groups jsonb,
  p_ads jsonb,
  p_insights jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_count integer;
  ad_group_count integer;
  ad_count integer;
  insight_count integer;
  now_at timestamptz := now();
begin
  if jsonb_typeof(p_account) <> 'object'
    or jsonb_typeof(p_campaigns) <> 'array'
    or jsonb_typeof(p_ad_groups) <> 'array'
    or jsonb_typeof(p_ads) <> 'array'
    or jsonb_typeof(p_insights) <> 'array'
  then
    raise exception 'invalid_snapshot_payload';
  end if;

  if jsonb_array_length(p_campaigns) > 10000
    or jsonb_array_length(p_ad_groups) > 50000
    or jsonb_array_length(p_ads) > 100000
    or jsonb_array_length(p_insights) > 500000
  then
    raise exception 'snapshot_payload_limit_exceeded';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'openai_ads'
      and pa.revoked_at is null
      and pa.platform_account_id = p_account->>'id'
  ) then
    raise exception 'openai_ads_connection_not_found';
  end if;

  if (
    select count(*) <> count(distinct item->>'id')
    from jsonb_array_elements(p_campaigns) item
  ) or (
    select count(*) <> count(distinct item->>'id')
    from jsonb_array_elements(p_ad_groups) item
  ) or (
    select count(*) <> count(distinct item->>'id')
    from jsonb_array_elements(p_ads) item
  ) or (
    select count(*) <> count(distinct concat_ws(':', item->>'campaign_id', item->>'date'))
    from jsonb_array_elements(p_insights) item
  ) then
    raise exception 'duplicate_snapshot_identity';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ad_groups) ad_group
    where not exists (
      select 1
      from jsonb_array_elements(p_campaigns) campaign
      where campaign->>'id' = ad_group->>'campaign_id'
    )
  ) or exists (
    select 1
    from jsonb_array_elements(p_ads) ad_item
    where not exists (
      select 1
      from jsonb_array_elements(p_ad_groups) ad_group
      where ad_group->>'id' = ad_item->>'ad_group_id'
    )
  ) or exists (
    select 1
    from jsonb_array_elements(p_insights) insight
    where not exists (
      select 1
      from jsonb_array_elements(p_campaigns) campaign
      where campaign->>'id' = insight->>'campaign_id'
    )
  ) then
    raise exception 'invalid_snapshot_hierarchy';
  end if;

  if not exists (
    select 1
    from public.ad_platform_sync_runs sr
    where sr.id = p_sync_run_id
      and sr.user_id = p_user_id
      and sr.platform_account_id = p_platform_account_id
      and sr.platform = 'openai_ads'
      and sr.status = 'running'
  ) then
    raise exception 'openai_ads_sync_run_not_found';
  end if;

  update public.campaigns
  set is_current = false
  where user_id = p_user_id
    and platform_account_id = p_platform_account_id
    and is_current = true;

  insert into public.campaigns (
    user_id,
    platform_account_id,
    platform_campaign_id,
    name,
    status,
    effective_status,
    objective,
    budget_amount,
    budget_amount_micros,
    daily_budget_amount_micros,
    bid_strategy,
    start_time,
    stop_time,
    platform_created_time,
    platform_updated_time,
    provider_data,
    last_seen_at,
    last_seen_sync_id,
    is_current
  )
  select
    p_user_id,
    p_platform_account_id,
    item->>'id',
    item->>'name',
    item->>'status',
    item->>'status',
    coalesce(item->>'objective', item->>'bidding_type'),
    case
      when nullif(item->>'budget_amount_micros', '') is null then null
      else (item->>'budget_amount_micros')::numeric / 1000000
    end,
    nullif(item->>'budget_amount_micros', '')::bigint,
    nullif(item->>'daily_budget_amount_micros', '')::bigint,
    item->>'bidding_type',
    case
      when nullif(item->>'start_time', '') is null then null
      else to_timestamp((item->>'start_time')::double precision)
    end,
    case
      when nullif(item->>'end_time', '') is null then null
      else to_timestamp((item->>'end_time')::double precision)
    end,
    to_timestamp((item->>'created_at')::double precision),
    to_timestamp((item->>'updated_at')::double precision),
    coalesce(item->'provider_data', '{}'::jsonb),
    now_at,
    p_sync_run_id,
    true
  from jsonb_array_elements(p_campaigns) item
  where nullif(item->>'id', '') is not null
    and nullif(item->>'name', '') is not null
  on conflict (platform_account_id, platform_campaign_id)
  do update set
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    objective = excluded.objective,
    budget_amount = excluded.budget_amount,
    budget_amount_micros = excluded.budget_amount_micros,
    daily_budget_amount_micros = excluded.daily_budget_amount_micros,
    bid_strategy = excluded.bid_strategy,
    start_time = excluded.start_time,
    stop_time = excluded.stop_time,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    provider_data = excluded.provider_data,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true;

  update public.ad_groups
  set is_current = false
  where user_id = p_user_id
    and platform_account_id = p_platform_account_id
    and is_current = true;

  insert into public.ad_groups (
    user_id,
    platform_account_id,
    campaign_id,
    platform_ad_group_id,
    name,
    status,
    effective_status,
    billing_event,
    bid_amount_micros,
    bid_strategy,
    platform_created_time,
    platform_updated_time,
    provider_data,
    last_seen_at,
    last_seen_sync_id,
    is_current
  )
  select
    p_user_id,
    p_platform_account_id,
    campaign.id,
    item->>'id',
    item->>'name',
    item->>'status',
    item->>'status',
    item->>'billing_event_type',
    nullif(item->>'max_bid_micros', '')::bigint,
    item->>'bid_strategy',
    to_timestamp((item->>'created_at')::double precision),
    to_timestamp((item->>'updated_at')::double precision),
    coalesce(item->'provider_data', '{}'::jsonb),
    now_at,
    p_sync_run_id,
    true
  from jsonb_array_elements(p_ad_groups) item
  join public.campaigns campaign
    on campaign.platform_account_id = p_platform_account_id
   and campaign.platform_campaign_id = item->>'campaign_id'
  where nullif(item->>'id', '') is not null
    and nullif(item->>'name', '') is not null
  on conflict (platform_account_id, platform_ad_group_id)
  do update set
    campaign_id = excluded.campaign_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    billing_event = excluded.billing_event,
    bid_amount_micros = excluded.bid_amount_micros,
    bid_strategy = excluded.bid_strategy,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    provider_data = excluded.provider_data,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true;

  update public.ads
  set is_current = false
  where user_id = p_user_id
    and platform_account_id = p_platform_account_id
    and is_current = true;

  insert into public.ads (
    user_id,
    platform_account_id,
    ad_group_id,
    platform_ad_id,
    name,
    status,
    effective_status,
    review_status,
    creative_type,
    target_url,
    provider_data,
    platform_created_time,
    platform_updated_time,
    last_seen_at,
    last_seen_sync_id,
    is_current
  )
  select
    p_user_id,
    p_platform_account_id,
    ad_group.id,
    item->>'id',
    item->>'name',
    item->>'status',
    item->>'status',
    item->>'review_status',
    item->>'creative_type',
    item->>'target_url',
    coalesce(item->'provider_data', '{}'::jsonb),
    to_timestamp((item->>'created_at')::double precision),
    to_timestamp((item->>'updated_at')::double precision),
    now_at,
    p_sync_run_id,
    true
  from jsonb_array_elements(p_ads) item
  join public.ad_groups ad_group
    on ad_group.platform_account_id = p_platform_account_id
   and ad_group.platform_ad_group_id = item->>'ad_group_id'
  where nullif(item->>'id', '') is not null
    and nullif(item->>'name', '') is not null
  on conflict (platform_account_id, platform_ad_id)
  do update set
    ad_group_id = excluded.ad_group_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    review_status = excluded.review_status,
    creative_type = excluded.creative_type,
    target_url = excluded.target_url,
    provider_data = excluded.provider_data,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true;

  update public.ad_platform_launches launch
  set
    review_status = item->>'review_status',
    status = case
      when launch.status = 'in_review' and item->>'review_status' = 'approved'
        then 'active'
      when launch.status = 'in_review' and item->>'review_status' = 'rejected'
        then 'blocked'
      else launch.status
    end,
    error_code = case
      when item->>'review_status' = 'rejected' then 'ad_review_rejected'
      when item->>'review_status' = 'approved' then null
      else launch.error_code
    end,
    activated_at = case
      when item->>'review_status' = 'approved'
        then coalesce(launch.activated_at, now_at)
      else launch.activated_at
    end,
    updated_at = now_at
  from jsonb_array_elements(p_ads) item
  where launch.user_id = p_user_id
    and launch.platform_account_id = p_platform_account_id
    and launch.platform = 'openai_ads'
    and launch.remote_ad_id = item->>'id'
    and launch.status in ('in_review', 'active', 'blocked');

  insert into public.performance_data (
    entity_id,
    entity_type,
    date,
    date_stop,
    impressions,
    clicks,
    conversions,
    spend,
    platform,
    user_id,
    platform_account_id,
    campaign_id,
    currency,
    data_status,
    provider_data,
    last_seen_sync_id,
    updated_at
  )
  select
    campaign.id,
    'campaign',
    (item->>'date')::date,
    coalesce(nullif(item->>'date_stop', '')::date, (item->>'date')::date),
    coalesce(nullif(item->>'impressions', '')::bigint, 0),
    coalesce(nullif(item->>'clicks', '')::bigint, 0),
    nullif(item->>'conversions', '')::bigint,
    coalesce(nullif(item->>'spend', '')::numeric, 0),
    'openai_ads',
    p_user_id,
    p_platform_account_id,
    campaign.id,
    p_account->>'currency_code',
    item->>'data_status',
    coalesce(item->'provider_data', '{}'::jsonb),
    p_sync_run_id,
    now_at
  from jsonb_array_elements(p_insights) item
  join public.campaigns campaign
    on campaign.platform_account_id = p_platform_account_id
   and campaign.platform_campaign_id = item->>'campaign_id'
  where nullif(item->>'date', '') is not null
  on conflict (entity_id, date)
  do update set
    date_stop = excluded.date_stop,
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    conversions = excluded.conversions,
    spend = excluded.spend,
    currency = excluded.currency,
    data_status = excluded.data_status,
    provider_data = excluded.provider_data,
    last_seen_sync_id = excluded.last_seen_sync_id,
    updated_at = excluded.updated_at;

  select count(*) into campaign_count from jsonb_array_elements(p_campaigns);
  select count(*) into ad_group_count from jsonb_array_elements(p_ad_groups);
  select count(*) into ad_count from jsonb_array_elements(p_ads);
  select count(*) into insight_count from jsonb_array_elements(p_insights);

  update public.platform_accounts
  set
    account_id = p_account->>'id',
    account_name = p_account->>'name',
    provider_metadata = p_account,
    provider_sync_status = 'success',
    provider_sync_error_code = null,
    provider_last_success_at = now_at,
    provider_next_sync_at = now_at + interval '1 hour',
    provider_backoff_until = null,
    provider_consecutive_failures = 0,
    provider_campaign_count = campaign_count,
    provider_ad_group_count = ad_group_count,
    provider_ad_count = ad_count,
    provider_insight_count = insight_count,
    updated_at = now_at
  where id = p_platform_account_id
    and user_id = p_user_id;

  update public.ad_platform_sync_runs
  set
    status = 'success',
    completed_at = now_at,
    counts = jsonb_build_object(
      'campaigns', campaign_count,
      'ad_groups', ad_group_count,
      'ads', ad_count,
      'insights', insight_count
    ),
    error_code = null
  where id = p_sync_run_id
    and user_id = p_user_id
    and platform_account_id = p_platform_account_id;

  return jsonb_build_object(
    'campaigns', campaign_count,
    'ad_groups', ad_group_count,
    'ads', ad_count,
    'insights', insight_count
  );
end;
$$;

revoke all on function public.replace_openai_ads_snapshot(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_openai_ads_snapshot(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;

create or replace view public.cross_platform_account_performance_daily
with (security_invoker = true)
as
select
  pd.user_id,
  pd.platform_account_id,
  pd.platform,
  pd.date,
  min(pd.currency) as currency,
  sum(pd.spend) as spend,
  sum(pd.impressions) as impressions,
  case
    when pd.platform = 'meta'
      then coalesce(sum(pd.inline_link_clicks), sum(pd.clicks))
    else sum(pd.clicks)
  end as clicks,
  sum(pd.conversions) as conversions,
  sum(pd.leads) as leads,
  sum(pd.purchases) as purchases,
  sum(pd.purchase_value) as conversion_value
from public.performance_data pd
where pd.platform in ('meta', 'openai_ads')
group by
  pd.user_id,
  pd.platform_account_id,
  pd.platform,
  pd.date;

create or replace view public.cross_platform_campaign_performance_30d
with (security_invoker = true)
as
with account_anchor as (
  select
    pd.user_id,
    pd.platform_account_id,
    pd.platform,
    max(pd.date) as window_end
  from public.performance_data pd
  where pd.platform in ('meta', 'openai_ads')
  group by pd.user_id, pd.platform_account_id, pd.platform
), totals as (
  select
    pd.user_id,
    pd.platform_account_id,
    pd.platform,
    pd.campaign_id,
    anchor.window_end - 29 as window_start,
    anchor.window_end,
    min(pd.currency) as currency,
    sum(pd.spend) as spend,
    sum(pd.impressions) as impressions,
    case
      when pd.platform = 'meta'
        then coalesce(sum(pd.inline_link_clicks), sum(pd.clicks))
      else sum(pd.clicks)
    end as clicks,
    sum(pd.conversions) as conversions,
    sum(pd.leads) as leads,
    sum(pd.purchases) as purchases,
    sum(pd.purchase_value) as conversion_value
  from public.performance_data pd
  join account_anchor anchor
    on anchor.user_id = pd.user_id
   and anchor.platform_account_id = pd.platform_account_id
   and anchor.platform = pd.platform
  where pd.date between anchor.window_end - 29 and anchor.window_end
  group by
    pd.user_id,
    pd.platform_account_id,
    pd.platform,
    pd.campaign_id,
    anchor.window_end
)
select
  totals.user_id,
  totals.platform_account_id,
  totals.platform,
  totals.campaign_id,
  c.platform_campaign_id,
  c.name as campaign_name,
  c.objective,
  c.status,
  c.effective_status,
  c.budget_amount_micros,
  c.daily_budget_amount_micros,
  totals.window_start,
  totals.window_end,
  totals.currency,
  totals.spend,
  totals.impressions,
  totals.clicks,
  totals.conversions,
  totals.leads,
  totals.purchases,
  totals.conversion_value,
  case
    when totals.impressions > 0
      then round(totals.clicks::numeric * 100 / totals.impressions, 4)
    else null
  end as ctr,
  case
    when totals.clicks > 0
      then round(totals.spend / totals.clicks, 6)
    else null
  end as cpc,
  case
    when totals.conversions > 0
      then round(totals.spend / totals.conversions, 6)
    else null
  end as cost_per_conversion,
  case
    when totals.spend > 0 and totals.conversion_value is not null
      then round(totals.conversion_value / totals.spend, 6)
    else null
  end as roas
from totals
join public.campaigns c on c.id = totals.campaign_id;

revoke all privileges on table public.cross_platform_account_performance_daily
  from public, anon, authenticated;
revoke all privileges on table public.cross_platform_campaign_performance_30d
  from public, anon, authenticated;
grant select on table public.cross_platform_account_performance_daily
  to authenticated, service_role;
grant select on table public.cross_platform_campaign_performance_30d
  to authenticated, service_role;

comment on column public.platform_accounts.access_token_encrypted is
  'AES-256-GCM ciphertext for an OAuth token or account-scoped API key; plaintext credentials must never be stored.';
comment on table public.ad_platform_launches is
  'Auditable provider launch records. New OpenAI Ads chains are explicitly confirmed and created ACTIVE; PAUSED states remain valid for safety rollback and legacy recovery.';
comment on view public.cross_platform_campaign_performance_30d is
  'Comparable 30-day delivery metrics for Meta and OpenAI Ads; currencies must not be summed across unlike currency codes.';

commit;

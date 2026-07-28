-- Read-only Meta asset and content synchronization for the isolated staging branch.
-- This migration intentionally stores no plaintext access tokens, page tokens,
-- comments, messages, audiences, insights, or ad-creation state.

alter table if exists public.platform_accounts
  add column if not exists meta_scopes text[] not null default '{}'::text[],
  add column if not exists data_access_expires_at timestamptz,
  add column if not exists baseline_completed_at timestamptz,
  add column if not exists last_sync_started_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists next_sync_at timestamptz,
  add column if not exists sync_lock_until timestamptz,
  add column if not exists sync_backoff_until timestamptz,
  add column if not exists sync_status text not null default 'idle'
    check (sync_status in (
      'idle',
      'syncing',
      'success',
      'partial',
      'error',
      'rate_limited',
      'reconnect_required'
    )),
  add column if not exists sync_error_code text,
  add column if not exists sync_consecutive_failures integer not null default 0
    check (sync_consecutive_failures >= 0),
  add column if not exists last_sync_seen_count integer not null default 0
    check (last_sync_seen_count >= 0),
  add column if not exists last_sync_new_count integer not null default 0
    check (last_sync_new_count >= 0),
  add column if not exists sync_usage jsonb not null default '{}'::jsonb;

create index if not exists platform_accounts_meta_sync_due_idx
  on public.platform_accounts (next_sync_at)
  where platform = 'meta' and revoked_at is null;

create table if not exists public.meta_assets (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  asset_type text not null
    check (asset_type in ('facebook_page', 'instagram_account', 'ad_account')),
  meta_asset_id text not null,
  parent_meta_asset_id text,
  name text not null,
  username text,
  baseline_completed_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_assets_connector_type_asset_key
    unique (platform_account_id, asset_type, meta_asset_id),
  constraint meta_assets_meta_asset_id_length
    check (char_length(meta_asset_id) between 1 and 255),
  constraint meta_assets_name_length
    check (char_length(name) between 1 and 255),
  constraint meta_assets_username_length
    check (username is null or char_length(username) <= 255)
);

create index if not exists meta_assets_user_idx
  on public.meta_assets (user_id, asset_type);

create index if not exists meta_assets_connector_idx
  on public.meta_assets (platform_account_id);

create table if not exists public.meta_content_candidates (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete cascade,
  meta_asset_id uuid not null
    references public.meta_assets(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  source text not null
    check (source in ('facebook', 'instagram')),
  content_type text not null
    check (content_type in ('post', 'image', 'video', 'carousel', 'reel', 'unknown')),
  meta_content_id text not null,
  caption_excerpt text,
  permalink_url text,
  preview_url text,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_new boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_content_connector_source_id_key
    unique (platform_account_id, source, meta_content_id),
  constraint meta_content_id_length
    check (char_length(meta_content_id) between 1 and 255),
  constraint meta_content_caption_length
    check (caption_excerpt is null or char_length(caption_excerpt) <= 500),
  constraint meta_content_permalink_length
    check (permalink_url is null or char_length(permalink_url) <= 2048),
  constraint meta_content_preview_length
    check (preview_url is null or char_length(preview_url) <= 2048)
);

create index if not exists meta_content_candidates_user_published_idx
  on public.meta_content_candidates (user_id, published_at desc);

create index if not exists meta_content_candidates_asset_idx
  on public.meta_content_candidates (meta_asset_id, last_seen_at desc);

alter table public.meta_assets enable row level security;
alter table public.meta_content_candidates enable row level security;

-- Browser clients may only read their own safe metadata. All writes stay behind
-- the server-side service-role client used by the OAuth and sync routes.
revoke all on public.meta_assets from anon, authenticated;
revoke all on public.meta_content_candidates from anon, authenticated;

grant select (
  id,
  platform_account_id,
  user_id,
  asset_type,
  meta_asset_id,
  parent_meta_asset_id,
  name,
  username,
  baseline_completed_at,
  last_synced_at,
  created_at,
  updated_at
) on public.meta_assets to authenticated;

grant select (
  id,
  platform_account_id,
  meta_asset_id,
  user_id,
  source,
  content_type,
  meta_content_id,
  caption_excerpt,
  permalink_url,
  preview_url,
  published_at,
  first_seen_at,
  last_seen_at,
  is_new,
  created_at,
  updated_at
) on public.meta_content_candidates to authenticated;

grant all on public.meta_assets to service_role;
grant all on public.meta_content_candidates to service_role;

drop policy if exists meta_assets_select_own on public.meta_assets;
create policy meta_assets_select_own
on public.meta_assets
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists meta_content_candidates_select_own
  on public.meta_content_candidates;
create policy meta_content_candidates_select_own
on public.meta_content_candidates
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Re-grant only safe connector metadata added by this migration. Secret token,
-- lock, backoff, failure-counter, and usage columns remain server-only.
grant select (
  meta_scopes,
  data_access_expires_at,
  baseline_completed_at,
  last_sync_started_at,
  last_synced_at,
  next_sync_at,
  sync_status,
  sync_error_code,
  last_sync_seen_count,
  last_sync_new_count
) on public.platform_accounts to authenticated;

comment on table public.meta_assets is
  'Read-only Meta assets selected through OAuth; page access tokens are never persisted.';
comment on table public.meta_content_candidates is
  'Minimal Facebook and Instagram post metadata detected as future advertising candidates; no ad mutations.';
comment on column public.platform_accounts.sync_usage is
  'Server-only aggregate Meta rate-limit usage snapshot; contains no tokens or asset content.';

-- Server-only transactional helpers. These functions are not executable by
-- browser roles and never accept or persist page access tokens.
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
    or jsonb_typeof(p_instagram_account_ids) is distinct from 'array' then
    raise exception 'Meta asset inputs must be JSON arrays';
  end if;

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
  on conflict (user_id, platform)
  do update set
    platform_account_id = excluded.platform_account_id,
    account_id = excluded.account_id,
    account_name = excluded.account_name,
    access_token = null,
    refresh_token = null,
    access_token_encrypted = excluded.access_token_encrypted,
    token_iv = excluded.token_iv,
    token_auth_tag = excluded.token_auth_tag,
    token_version = excluded.token_version,
    meta_user_id = excluded.meta_user_id,
    meta_business_id = null,
    meta_scopes = excluded.meta_scopes,
    page_ids = excluded.page_ids,
    ad_account_ids = excluded.ad_account_ids,
    instagram_account_ids = excluded.instagram_account_ids,
    expires_at = excluded.expires_at,
    refresh_at = excluded.refresh_at,
    data_access_expires_at = excluded.data_access_expires_at,
    connected_at = excluded.connected_at,
    revoked_at = null,
    baseline_completed_at = null,
    last_sync_started_at = null,
    last_synced_at = null,
    next_sync_at = now(),
    sync_lock_until = null,
    sync_backoff_until = null,
    sync_status = 'idle',
    sync_error_code = null,
    sync_consecutive_failures = 0,
    last_sync_seen_count = 0,
    last_sync_new_count = 0,
    sync_usage = '{}'::jsonb,
    updated_at = now()
  returning id into v_platform_account_id;

  delete from public.meta_assets
  where platform_account_id = v_platform_account_id;

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
    and asset.name is not null;

  return v_platform_account_id;
end;
$$;

create or replace function public.claim_meta_sync(
  p_platform_account_id uuid,
  p_lock_seconds integer default 300,
  p_min_interval_seconds integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.platform_accounts
  set
    sync_lock_until = now() + make_interval(
      secs => greatest(30, least(900, p_lock_seconds))
    ),
    last_sync_started_at = now(),
    sync_status = 'syncing',
    sync_error_code = null,
    updated_at = now()
  where id = p_platform_account_id
    and platform = 'meta'
    and revoked_at is null
    and (sync_lock_until is null or sync_lock_until <= now())
    and (sync_backoff_until is null or sync_backoff_until <= now())
    and (
      p_min_interval_seconds <= 0
      or last_sync_started_at is null
      or last_sync_started_at <= now() - make_interval(
        secs => least(3600, p_min_interval_seconds)
      )
    );

  return found;
end;
$$;

create or replace function public.record_meta_content_candidates(
  p_platform_account_id uuid,
  p_meta_asset_id uuid,
  p_user_id uuid,
  p_is_baseline boolean,
  p_items jsonb
)
returns table (
  seen_count integer,
  inserted_count integer,
  new_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_rows integer;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_new integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  if not exists (
    select 1
    from public.meta_assets
    where id = p_meta_asset_id
      and platform_account_id = p_platform_account_id
      and user_id = p_user_id
      and asset_type in ('facebook_page', 'instagram_account')
  ) then
    raise exception 'Meta asset does not belong to connector';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_seen := v_seen + 1;

    insert into public.meta_content_candidates (
      platform_account_id,
      meta_asset_id,
      user_id,
      source,
      content_type,
      meta_content_id,
      caption_excerpt,
      permalink_url,
      preview_url,
      published_at,
      first_seen_at,
      last_seen_at,
      is_new,
      updated_at
    ) values (
      p_platform_account_id,
      p_meta_asset_id,
      p_user_id,
      v_item->>'source',
      coalesce(v_item->>'content_type', 'unknown'),
      v_item->>'meta_content_id',
      nullif(v_item->>'caption_excerpt', ''),
      nullif(v_item->>'permalink_url', ''),
      nullif(v_item->>'preview_url', ''),
      nullif(v_item->>'published_at', '')::timestamptz,
      now(),
      now(),
      not p_is_baseline,
      now()
    )
    on conflict (platform_account_id, source, meta_content_id)
    do nothing;

    get diagnostics v_rows = row_count;

    if v_rows = 1 then
      v_inserted := v_inserted + 1;
      if not p_is_baseline then
        v_new := v_new + 1;
      end if;
    else
      update public.meta_content_candidates
      set
        meta_asset_id = p_meta_asset_id,
        caption_excerpt = nullif(v_item->>'caption_excerpt', ''),
        permalink_url = nullif(v_item->>'permalink_url', ''),
        preview_url = nullif(v_item->>'preview_url', ''),
        content_type = coalesce(v_item->>'content_type', 'unknown'),
        published_at = nullif(v_item->>'published_at', '')::timestamptz,
        last_seen_at = now(),
        updated_at = now()
      where platform_account_id = p_platform_account_id
        and source = v_item->>'source'
        and meta_content_id = v_item->>'meta_content_id';
    end if;
  end loop;

  update public.meta_assets
  set
    baseline_completed_at = case
      when p_is_baseline then coalesce(baseline_completed_at, now())
      else baseline_completed_at
    end,
    last_synced_at = now(),
    updated_at = now()
  where id = p_meta_asset_id;

  return query select v_seen, v_inserted, v_new;
end;
$$;

revoke all on function public.replace_meta_connection(
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text[],
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
revoke all on function public.claim_meta_sync(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.record_meta_content_candidates(
  uuid,
  uuid,
  uuid,
  boolean,
  jsonb
) from public, anon, authenticated;

grant execute on function public.replace_meta_connection(
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text[],
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to service_role;
grant execute on function public.claim_meta_sync(uuid, integer, integer)
  to service_role;
grant execute on function public.record_meta_content_candidates(
  uuid,
  uuid,
  uuid,
  boolean,
  jsonb
) to service_role;

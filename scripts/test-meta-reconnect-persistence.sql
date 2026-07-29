\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$
begin
  create role anon noinherit;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  create role authenticated noinherit;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  create role service_role noinherit;
exception when duplicate_object then null;
end;
$$;

create table public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  platform text not null,
  platform_account_id text,
  account_id text,
  account_name text,
  access_token text,
  refresh_token text,
  access_token_encrypted text,
  token_iv text,
  token_auth_tag text,
  token_version integer,
  meta_user_id text,
  meta_business_id text,
  meta_scopes text[],
  page_ids jsonb,
  ad_account_ids jsonb,
  instagram_account_ids jsonb,
  expires_at timestamptz,
  refresh_at timestamptz,
  data_access_expires_at timestamptz,
  connected_at timestamptz,
  revoked_at timestamptz,
  baseline_completed_at timestamptz,
  last_sync_started_at timestamptz,
  last_synced_at timestamptz,
  next_sync_at timestamptz,
  sync_lock_until timestamptz,
  sync_backoff_until timestamptz,
  sync_status text,
  sync_error_code text,
  sync_consecutive_failures integer,
  last_sync_seen_count integer,
  last_sync_new_count integer,
  sync_usage jsonb,
  updated_at timestamptz,
  unique (user_id, platform)
);

create table public.meta_assets (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references public.platform_accounts(id) on delete cascade,
  user_id uuid not null,
  asset_type text not null,
  meta_asset_id text not null,
  parent_meta_asset_id text,
  name text not null,
  username text,
  baseline_completed_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_account_id, asset_type, meta_asset_id)
);

create table public.meta_content_candidates (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references public.platform_accounts(id) on delete cascade,
  meta_asset_id uuid not null constraint meta_content_candidates_meta_asset_id_fkey
    references public.meta_assets(id) on delete cascade,
  user_id uuid not null,
  source text not null,
  content_type text not null,
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
  unique (platform_account_id, source, meta_content_id)
);

insert into public.platform_accounts (
  id,
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
  meta_scopes,
  page_ids,
  ad_account_ids,
  instagram_account_ids,
  expires_at,
  connected_at,
  baseline_completed_at,
  last_sync_started_at,
  last_synced_at,
  next_sync_at,
  sync_status,
  sync_error_code,
  sync_consecutive_failures,
  last_sync_seen_count,
  last_sync_new_count,
  sync_usage,
  updated_at
) values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'meta',
  'meta-user-old',
  'meta-user-old',
  'Old account',
  null,
  null,
  'old-ciphertext',
  'old-iv',
  'old-tag',
  1,
  'meta-user-old',
  array['ads_read'],
  '["page-1", "page-removed"]'::jsonb,
  '["ad-1"]'::jsonb,
  '["ig-1"]'::jsonb,
  '2026-09-26T00:00:00Z',
  '2026-07-27T00:00:00Z',
  '2026-07-27T00:10:00Z',
  '2026-07-29T04:40:00Z',
  '2026-07-29T04:40:10Z',
  '2026-07-29T05:00:00Z',
  'reconnect_required',
  'token_expired',
  0,
  100,
  2,
  '{"appPercent": 12}'::jsonb,
  '2026-07-29T04:49:00Z'
);

insert into public.meta_assets (
  id,
  platform_account_id,
  user_id,
  asset_type,
  meta_asset_id,
  parent_meta_asset_id,
  name,
  username,
  baseline_completed_at,
  last_synced_at
) values
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'facebook_page',
    'page-1',
    null,
    'Old Page Name',
    null,
    '2026-07-27T00:10:00Z',
    '2026-07-29T04:40:10Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'instagram_account',
    'ig-1',
    'page-1',
    'Old Instagram Name',
    'old_username',
    '2026-07-27T00:10:00Z',
    '2026-07-29T04:40:10Z'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'ad_account',
    'ad-1',
    null,
    'Old Ad Account',
    null,
    null,
    null
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'facebook_page',
    'page-removed',
    null,
    'Removed Page',
    null,
    '2026-07-27T00:10:00Z',
    '2026-07-29T04:40:10Z'
  );

insert into public.meta_content_candidates (
  id,
  platform_account_id,
  meta_asset_id,
  user_id,
  source,
  content_type,
  meta_content_id,
  caption_excerpt,
  published_at,
  is_new
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'facebook',
    'post',
    'facebook-post-1',
    'Historical Facebook post',
    '2026-07-28T00:00:00Z',
    false
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'instagram',
    'image',
    'instagram-post-1',
    'New Instagram post',
    '2026-07-29T04:22:00Z',
    true
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000002',
    'facebook',
    'post',
    'removed-page-post-1',
    'Historical post from removed page',
    '2026-07-20T00:00:00Z',
    false
  );

\ir ../supabase/migrations/20260729070000_preserve_meta_history_on_reconnect.sql

select public.replace_meta_connection(
  '00000000-0000-4000-8000-000000000002',
  'meta-user-new',
  'Updated account',
  'new-ciphertext',
  'new-iv',
  'new-tag',
  '2026-10-01T00:00:00Z',
  null,
  '2026-10-15T00:00:00Z',
  array['ads_read', 'pages_show_list'],
  '["page-1"]'::jsonb,
  '["ad-1"]'::jsonb,
  '["ig-1"]'::jsonb,
  '[
    {
      "asset_type": "facebook_page",
      "meta_asset_id": "page-1",
      "parent_meta_asset_id": null,
      "name": "Updated Page Name",
      "username": null
    },
    {
      "asset_type": "instagram_account",
      "meta_asset_id": "ig-1",
      "parent_meta_asset_id": "page-1",
      "name": "Updated Instagram Name",
      "username": "updated_username"
    },
    {
      "asset_type": "ad_account",
      "meta_asset_id": "ad-1",
      "parent_meta_asset_id": null,
      "name": "Updated Ad Account",
      "username": null
    }
  ]'::jsonb
);

do $$
declare
  v_count integer;
  v_timestamp timestamptz;
begin
  select count(*) into v_count from public.platform_accounts;
  if v_count <> 1 then
    raise exception 'Expected one connector, got %', v_count;
  end if;

  if not exists (
    select 1
    from public.platform_accounts
    where id = '00000000-0000-4000-8000-000000000001'
      and platform_account_id = 'meta-user-new'
      and account_name = 'Updated account'
      and access_token is null
      and refresh_token is null
      and access_token_encrypted = 'new-ciphertext'
      and sync_status = 'idle'
      and sync_error_code is null
      and baseline_completed_at = '2026-07-27T00:10:00Z'
      and last_sync_started_at = '2026-07-29T04:40:00Z'
      and last_synced_at = '2026-07-29T04:40:10Z'
      and last_sync_seen_count = 100
      and last_sync_new_count = 2
      and sync_usage = '{"appPercent": 12}'::jsonb
  ) then
    raise exception 'Connector history or encrypted token replacement was not preserved correctly';
  end if;

  select count(*) into v_count from public.meta_assets;
  if v_count <> 3 then
    raise exception 'Expected three selected assets, got %', v_count;
  end if;

  if not exists (
    select 1
    from public.meta_assets
    where id = '10000000-0000-4000-8000-000000000001'
      and name = 'Updated Page Name'
      and baseline_completed_at = '2026-07-27T00:10:00Z'
      and last_synced_at = '2026-07-29T04:40:10Z'
  ) then
    raise exception 'Unchanged Facebook asset identity or baseline was not preserved';
  end if;

  if not exists (
    select 1
    from public.meta_assets
    where id = '10000000-0000-4000-8000-000000000002'
      and name = 'Updated Instagram Name'
      and username = 'updated_username'
      and baseline_completed_at = '2026-07-27T00:10:00Z'
  ) then
    raise exception 'Unchanged Instagram asset identity or baseline was not preserved';
  end if;

  if exists (
    select 1 from public.meta_assets where meta_asset_id = 'page-removed'
  ) then
    raise exception 'Removed asset still exists';
  end if;

  select count(*) into v_count from public.meta_content_candidates;
  if v_count <> 3 then
    raise exception 'Expected three preserved candidates, got %', v_count;
  end if;

  select count(*) into v_count
  from public.meta_content_candidates
  where is_new;
  if v_count <> 1 then
    raise exception 'Expected one preserved new candidate, got %', v_count;
  end if;

  if not exists (
    select 1
    from public.meta_content_candidates
    where meta_content_id = 'removed-page-post-1'
      and meta_asset_id is null
  ) then
    raise exception 'Historical candidate from removed asset was not retained with a null asset reference';
  end if;

  if not exists (
    select 1
    from public.meta_content_candidates
    where meta_content_id = 'instagram-post-1'
      and meta_asset_id = '10000000-0000-4000-8000-000000000002'
      and is_new
  ) then
    raise exception 'Candidate relationship to unchanged asset was not preserved';
  end if;
end;
$$;

select 'Meta reconnect persistence integration checks passed' as result;

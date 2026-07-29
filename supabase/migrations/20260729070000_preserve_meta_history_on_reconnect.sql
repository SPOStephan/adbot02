begin;

-- Historical content candidates must outlive an asset selection change or OAuth
-- reconnect. A later sync can relink the row to the current asset by its stable
-- connector/source/content uniqueness key.
alter table public.meta_content_candidates
  alter column meta_asset_id drop not null;

alter table public.meta_content_candidates
  drop constraint if exists meta_content_candidates_meta_asset_id_fkey;

alter table public.meta_content_candidates
  add constraint meta_content_candidates_meta_asset_id_fkey
  foreign key (meta_asset_id)
  references public.meta_assets(id)
  on delete set null;

comment on column public.meta_content_candidates.meta_asset_id is
  'Current Meta asset reference when available; nullable so historical candidates survive asset removal or OAuth reconnect.';

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

  insert into public.platform_accounts as existing (
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
    baseline_completed_at = existing.baseline_completed_at,
    last_sync_started_at = existing.last_sync_started_at,
    last_synced_at = existing.last_synced_at,
    next_sync_at = now(),
    sync_lock_until = null,
    sync_backoff_until = null,
    sync_status = 'idle',
    sync_error_code = null,
    sync_consecutive_failures = 0,
    last_sync_seen_count = existing.last_sync_seen_count,
    last_sync_new_count = existing.last_sync_new_count,
    sync_usage = existing.sync_usage,
    updated_at = now()
  returning id into v_platform_account_id;

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

  -- Remove only assets no longer returned by Meta. Candidate history survives
  -- because the foreign key now uses ON DELETE SET NULL.
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

commit;

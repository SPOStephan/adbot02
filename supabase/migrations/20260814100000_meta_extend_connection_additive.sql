-- Additive Meta asset extend: merge newly granted assets into the existing
-- connection without deleting already-connected pages/IG/ad accounts and
-- without blanking marketing snapshot fields.

begin;

create or replace function public.extend_meta_connection(
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
  if p_user_id is null
    or nullif(p_meta_user_id, '') is null
    or nullif(p_account_name, '') is null
    or nullif(p_access_token_encrypted, '') is null
    or nullif(p_token_iv, '') is null
    or nullif(p_token_auth_tag, '') is null
    or p_expires_at is null
    or p_refresh_at is null
    or p_scopes is null
    or jsonb_typeof(p_page_ids) is distinct from 'array'
    or jsonb_typeof(p_ad_account_ids) is distinct from 'array'
    or jsonb_typeof(p_instagram_account_ids) is distinct from 'array'
    or jsonb_typeof(p_assets) is distinct from 'array'
  then
    raise exception 'extend_meta_connection_invalid_input';
  end if;

  select account.id
  into v_platform_account_id
  from public.platform_accounts as account
  where account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null
  for update;

  if v_platform_account_id is null then
    raise exception 'extend_meta_connection_not_connected';
  end if;

  update public.platform_accounts
  set
    meta_user_id = p_meta_user_id,
    account_name = p_account_name,
    access_token_encrypted = p_access_token_encrypted,
    token_iv = p_token_iv,
    token_auth_tag = p_token_auth_tag,
    expires_at = p_expires_at,
    refresh_at = p_refresh_at,
    data_access_expires_at = p_data_access_expires_at,
    meta_scopes = p_scopes,
    page_ids = (
      select coalesce(jsonb_agg(to_jsonb(value) order by value), '[]'::jsonb)
      from (
        select distinct trim(value) as value
        from (
          select jsonb_array_elements_text(page_ids) as value
          union
          select jsonb_array_elements_text(p_page_ids) as value
        ) merged
        where nullif(trim(value), '') is not null
      ) distinct_ids
    ),
    ad_account_ids = (
      select coalesce(jsonb_agg(to_jsonb(value) order by value), '[]'::jsonb)
      from (
        select distinct trim(value) as value
        from (
          select jsonb_array_elements_text(ad_account_ids) as value
          union
          select jsonb_array_elements_text(p_ad_account_ids) as value
        ) merged
        where nullif(trim(value), '') is not null
      ) distinct_ids
    ),
    instagram_account_ids = (
      select coalesce(jsonb_agg(to_jsonb(value) order by value), '[]'::jsonb)
      from (
        select distinct trim(value) as value
        from (
          select jsonb_array_elements_text(instagram_account_ids) as value
          union
          select jsonb_array_elements_text(p_instagram_account_ids) as value
        ) merged
        where nullif(trim(value), '') is not null
      ) distinct_ids
    ),
    revoked_at = null,
    sync_status = 'idle',
    sync_error_code = null,
    sync_lock_until = null,
    sync_backoff_until = null,
    next_sync_at = now(),
    updated_at = now()
  where id = v_platform_account_id
    and user_id = p_user_id;

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

  -- Intentionally no DELETE of assets missing from p_assets.
  return v_platform_account_id;
end;
$$;

comment on function public.extend_meta_connection(
  uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text[], jsonb, jsonb, jsonb, jsonb
) is
  'Merge newly granted Meta assets into an existing connection; never deletes prior assets; leaves marketing snapshot columns untouched.';

revoke all on function public.extend_meta_connection(
  uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text[], jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.extend_meta_connection(
  uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text[], jsonb, jsonb, jsonb, jsonb
) to service_role;

commit;

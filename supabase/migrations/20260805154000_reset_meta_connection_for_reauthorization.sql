create or replace function public.reset_meta_connection_for_reauthorization(
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_platform_account_id uuid;
  v_reset_at timestamptz := now();
begin
  select id
    into v_platform_account_id
  from public.platform_accounts
  where user_id = p_user_id
    and platform = 'meta'
  for update;

  if v_platform_account_id is null then
    return null;
  end if;

  delete from public.meta_assets
  where platform_account_id = v_platform_account_id;

  update public.platform_accounts
  set
    access_token = null,
    refresh_token = null,
    access_token_encrypted = null,
    token_iv = null,
    token_auth_tag = null,
    meta_scopes = '{}'::text[],
    page_ids = '[]'::jsonb,
    ad_account_ids = '[]'::jsonb,
    instagram_account_ids = '[]'::jsonb,
    expires_at = null,
    refresh_at = null,
    data_access_expires_at = null,
    next_sync_at = null,
    sync_lock_until = null,
    sync_backoff_until = null,
    sync_status = 'reconnect_required',
    sync_error_code = 'authorization_reset',
    revoked_at = v_reset_at,
    updated_at = v_reset_at
  where id = v_platform_account_id
    and user_id = p_user_id
    and platform = 'meta';

  return v_platform_account_id;
end;
$$;

revoke all on function public.reset_meta_connection_for_reauthorization(uuid)
  from public, anon, authenticated;
grant execute on function public.reset_meta_connection_for_reauthorization(uuid)
  to service_role;

comment on function public.reset_meta_connection_for_reauthorization(uuid) is
  'Server-only reset before Meta reauthorization: removes current connector tokens and selected asset rows while preserving historical reporting data.';

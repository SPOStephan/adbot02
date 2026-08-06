begin;

-- Drop a single selected Meta asset from Adbot's active connection without
-- touching OAuth tokens or Meta's Business Integration. Sync and brand flows
-- only read remaining meta_assets (+ instagram_account_ids), so pruned assets
-- stop contributing new content immediately.
create or replace function public.prune_meta_connection_asset(
  p_user_id uuid,
  p_asset_row_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_platform_account_id uuid;
  v_asset_type text;
  v_meta_asset_id text;
  v_remaining integer;
  v_id_column text;
begin
  if p_user_id is null or p_asset_row_id is null then
    raise exception 'prune_meta_asset_invalid_input';
  end if;

  select
    account.id,
    asset.asset_type,
    asset.meta_asset_id
  into
    v_platform_account_id,
    v_asset_type,
    v_meta_asset_id
  from public.meta_assets as asset
  inner join public.platform_accounts as account
    on account.id = asset.platform_account_id
  where asset.id = p_asset_row_id
    and asset.user_id = p_user_id
    and account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null
  for update;

  if v_platform_account_id is null then
    raise exception 'prune_meta_asset_not_found';
  end if;

  if v_asset_type not in ('facebook_page', 'instagram_account', 'ad_account') then
    raise exception 'prune_meta_asset_unsupported_type';
  end if;

  select count(*)::integer
    into v_remaining
  from public.meta_assets
  where platform_account_id = v_platform_account_id
    and user_id = p_user_id
    and asset_type = v_asset_type;

  -- Keep at least one asset per type so content/marketing sync stays viable.
  if v_remaining <= 1 then
    raise exception 'prune_meta_asset_last_of_type';
  end if;

  v_id_column := case v_asset_type
    when 'facebook_page' then 'page_ids'
    when 'instagram_account' then 'instagram_account_ids'
    else 'ad_account_ids'
  end;

  if v_id_column = 'page_ids' then
    update public.platform_accounts
    set
      page_ids = coalesce(
        (
          select jsonb_agg(to_jsonb(value))
          from jsonb_array_elements_text(page_ids) as entries(value)
          where value is distinct from v_meta_asset_id
        ),
        '[]'::jsonb
      ),
      updated_at = now()
    where id = v_platform_account_id
      and user_id = p_user_id;
  elsif v_id_column = 'instagram_account_ids' then
    update public.platform_accounts
    set
      instagram_account_ids = coalesce(
        (
          select jsonb_agg(to_jsonb(value))
          from jsonb_array_elements_text(instagram_account_ids) as entries(value)
          where value is distinct from v_meta_asset_id
        ),
        '[]'::jsonb
      ),
      updated_at = now()
    where id = v_platform_account_id
      and user_id = p_user_id;
  else
    update public.platform_accounts
    set
      ad_account_ids = coalesce(
        (
          select jsonb_agg(to_jsonb(value))
          from jsonb_array_elements_text(ad_account_ids) as entries(value)
          where value is distinct from v_meta_asset_id
        ),
        '[]'::jsonb
      ),
      updated_at = now()
    where id = v_platform_account_id
      and user_id = p_user_id;
  end if;

  -- Stop surfacing historical rows from the pruned asset as "new".
  update public.meta_content_candidates
  set
    is_new = false,
    updated_at = now()
  where meta_asset_id = p_asset_row_id
    and user_id = p_user_id;

  delete from public.meta_assets
  where id = p_asset_row_id
    and user_id = p_user_id
    and platform_account_id = v_platform_account_id;

  return jsonb_build_object(
    'ok', true,
    'assetType', v_asset_type,
    'metaAssetId', v_meta_asset_id,
    'remainingOfType', v_remaining - 1
  );
end;
$$;

revoke all on function public.prune_meta_connection_asset(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prune_meta_connection_asset(uuid, uuid)
  to service_role;

comment on function public.prune_meta_connection_asset(uuid, uuid) is
  'Removes one Meta asset from Adbot active selection only; does not revoke Meta OAuth or alter Business Integration assignments.';

commit;

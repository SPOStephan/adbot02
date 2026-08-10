-- Allow rebinding CUSTOMER library assets onto the launch brand profile.
-- Previously only null-profile assets were bound; already-bound assets then
-- failed materialize when a different/auto-created profile was used.

begin;

create or replace function public.bind_unbound_customer_brand_asset_for_launch(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_brand_profile_id uuid,
  p_brand_asset_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.brand_profiles%rowtype;
  v_asset_id uuid;
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_brand_profile_id is null
    or p_brand_asset_id is null then
    raise exception 'Brand asset launch bind identity is incomplete';
  end if;

  select profile.*
  into v_profile
  from public.brand_profiles profile
  where profile.id = p_brand_profile_id
    and profile.user_id = p_user_id
    and profile.platform_account_id = p_platform_account_id
    and profile.status = 'ACTIVE'
    and profile.customer_confirmed_at is not null
    and profile.activated_at is not null;

  if not found then
    raise exception 'Active confirmed brand profile is required';
  end if;

  update public.brand_assets asset
  set brand_profile_id = v_profile.id,
      brand_policy_version = v_profile.version,
      updated_at = now()
  where asset.id = p_brand_asset_id
    and asset.user_id = p_user_id
    and asset.platform_account_id = p_platform_account_id
    and asset.library_scope = 'CUSTOMER'
    and (
      asset.brand_profile_id is null
      or asset.brand_profile_id is distinct from v_profile.id
    )
    and asset.status = 'READY'
    and asset.moderation_status = 'APPROVED'
    and asset.reviewed_at is not null
  returning asset.id into v_asset_id;

  if v_asset_id is not null then
    return;
  end if;

  -- Already correctly bound to this profile.
  select asset.id
  into v_asset_id
  from public.brand_assets asset
  where asset.id = p_brand_asset_id
    and asset.user_id = p_user_id
    and asset.platform_account_id = p_platform_account_id
    and asset.library_scope = 'CUSTOMER'
    and asset.brand_profile_id = v_profile.id
    and asset.status = 'READY'
    and asset.moderation_status = 'APPROVED'
    and asset.reviewed_at is not null;

  if v_asset_id is null then
    raise exception 'READY approved customer brand asset is required for launch bind';
  end if;
end;
$$;

revoke all on function public.bind_unbound_customer_brand_asset_for_launch(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.bind_unbound_customer_brand_asset_for_launch(
  uuid, uuid, uuid, uuid
) to service_role;

comment on function public.bind_unbound_customer_brand_asset_for_launch(
  uuid, uuid, uuid, uuid
) is
  'Binds or rebinds a READY CUSTOMER brand asset to the ACTIVE launch brand profile.';

commit;

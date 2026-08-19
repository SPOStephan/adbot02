-- Creative Generation Phase 4: customer LOCKED_PHOTO role toggle.
-- Allows Media Library UI to mark UPLOAD_EDITABLE ↔ LOCKED_PHOTO for compose.
-- Does not touch organic boost / launch materialize.

begin;

create or replace function public.set_brand_asset_locked_photo_role(
  p_asset_id uuid,
  p_locked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.brand_assets%rowtype;
  v_next_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_asset_id is null then
    raise exception 'Asset id is required';
  end if;

  select asset.*
  into v_asset
  from public.brand_assets asset
  where asset.id = p_asset_id
    and asset.user_id = v_user_id
    and asset.library_scope = 'CUSTOMER'
  for update;

  if not found then
    raise exception 'Brand asset not found or not in customer Media Library';
  end if;

  if v_asset.status = 'REVOKED' then
    raise exception 'Revoked assets cannot change asset role';
  end if;

  if v_asset.status is distinct from 'READY'
    or v_asset.moderation_status is distinct from 'APPROVED' then
    raise exception 'Only READY and APPROVED assets can become LOCKED_PHOTO';
  end if;

  -- GENERATED and STYLE_REFERENCE cannot become locked photos.
  if v_asset.asset_role not in ('UPLOAD_EDITABLE', 'LOCKED_PHOTO') then
    raise exception 'Only UPLOAD_EDITABLE or LOCKED_PHOTO assets can toggle lock';
  end if;

  v_next_role := case when p_locked then 'LOCKED_PHOTO' else 'UPLOAD_EDITABLE' end;

  if v_asset.asset_role = v_next_role then
    return true;
  end if;

  update public.brand_assets
  set asset_role = v_next_role,
      updated_at = now()
  where id = v_asset.id;

  return true;
end;
$$;

revoke all on function public.set_brand_asset_locked_photo_role(uuid, boolean)
  from public, anon;
grant execute on function public.set_brand_asset_locked_photo_role(uuid, boolean)
  to authenticated, service_role;

comment on function public.set_brand_asset_locked_photo_role(uuid, boolean) is
  'Phase 4: customer toggle UPLOAD_EDITABLE ↔ LOCKED_PHOTO for READY/APPROVED CUSTOMER assets.';

commit;

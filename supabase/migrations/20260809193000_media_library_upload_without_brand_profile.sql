-- Media Library uploads must not require an active brand profile.
-- Brand profile remains optional at upload and is bound lazily at launch.

create or replace function public.register_uploaded_brand_asset(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_brand_profile_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id uuid := gen_random_uuid();
  v_existing public.brand_assets%rowtype;
  v_profile public.brand_profiles%rowtype;
  v_bucket text := nullif(btrim(coalesce(p_storage_bucket, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_file_name text := btrim(coalesce(p_original_filename, ''));
  v_sha256 text := lower(btrim(coalesce(p_sha256, '')));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_expected_prefix text := p_user_id::text || '/' || p_platform_account_id::text || '/';
  v_brand_profile_id uuid := null;
  v_brand_policy_version integer := 1;
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Uploaded brand asset identity is incomplete';
  end if;

  if v_sha256 !~ '^[0-9a-f]{64}$'
    or v_mime_type not in ('image/png', 'image/jpeg')
    or p_byte_size is null
    or p_byte_size <= 0
    or p_byte_size > 10485760
    or p_width is null
    or p_width not between 256 and 4096
    or p_height is null
    or p_height not between 256 and 4096
    or char_length(v_file_name) not between 1 and 255
    or v_bucket is null
    or char_length(v_bucket) > 63
    or v_path is null
    or char_length(v_path) > 1024
    or v_path not like v_expected_prefix || '%'
    or v_path like '%..%' then
    raise exception 'Uploaded brand asset metadata is invalid';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Uploaded brand asset metadata is invalid or unsafe';
  end if;

  perform 1
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null;

  if not found then
    raise exception 'Meta platform account is required for Media Library upload';
  end if;

  if p_brand_profile_id is not null then
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

    v_brand_profile_id := v_profile.id;
    v_brand_policy_version := v_profile.version;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'upload-brand-asset:' || p_platform_account_id::text || ':' || v_sha256,
      0
    )
  );

  select asset.*
  into v_existing
  from public.brand_assets asset
  where asset.library_scope = 'CUSTOMER'
    and asset.platform_account_id = p_platform_account_id
    and asset.sha256 = v_sha256
  for update;

  if found then
    if v_existing.user_id <> p_user_id
      or v_existing.library_scope <> 'CUSTOMER'
      or v_existing.status = 'REVOKED' then
      raise exception 'Brand asset hash conflicts with another asset identity';
    end if;

    -- Soft-bind an unbound library asset when the customer later chooses a profile.
    if v_existing.brand_profile_id is null and v_brand_profile_id is not null then
      update public.brand_assets
      set brand_profile_id = v_brand_profile_id,
          brand_policy_version = v_brand_policy_version,
          updated_at = now()
      where id = v_existing.id;
    end if;

    return v_existing.id;
  end if;

  insert into public.brand_assets (
    id, user_id, platform_account_id, brand_profile_id, source_type,
    library_scope, storage_bucket, storage_path, original_filename,
    sha256, mime_type, byte_size, width, height, brand_policy_version,
    moderation_status, status, metadata, reviewed_at, reviewed_by,
    created_at, updated_at
  ) values (
    v_asset_id, p_user_id, p_platform_account_id, v_brand_profile_id,
    'UPLOADED', 'CUSTOMER', v_bucket, v_path, v_file_name, v_sha256,
    v_mime_type, p_byte_size, p_width, p_height, v_brand_policy_version,
    'APPROVED', 'READY', v_metadata, now(), p_user_id, now(), now()
  );

  return v_asset_id;
end;
$$;

revoke all on function public.register_uploaded_brand_asset(
  uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.register_uploaded_brand_asset(
  uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) to service_role;

-- Bind library uploads without profile when they are first used in Active Launch.
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
    and asset.brand_profile_id is null
    and asset.status = 'READY'
    and asset.moderation_status = 'APPROVED'
    and asset.reviewed_at is not null;
end;
$$;

revoke all on function public.bind_unbound_customer_brand_asset_for_launch(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.bind_unbound_customer_brand_asset_for_launch(
  uuid, uuid, uuid, uuid
) to service_role;

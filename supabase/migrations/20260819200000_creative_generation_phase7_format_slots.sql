-- Creative Generation Phase 7: register Meta format-slot crops of GENERATED masters.
-- Children keep source_type/asset_role GENERATED and point at parent via metadata.

begin;

create or replace function public.register_generated_meta_crop_asset(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_parent_asset_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_meta_format_key text,
  p_provider_asset_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.brand_assets%rowtype;
  v_asset_id uuid := gen_random_uuid();
  v_existing public.brand_assets%rowtype;
  v_bucket text := nullif(btrim(coalesce(p_storage_bucket, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_file_name text := btrim(coalesce(p_original_filename, ''));
  v_sha256 text := lower(btrim(coalesce(p_sha256, '')));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_format_key text := nullif(btrim(coalesce(p_meta_format_key, '')), '');
  v_provider_asset_id text := nullif(btrim(coalesce(p_provider_asset_id, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_expected_prefix text := p_user_id::text || '/' || p_platform_account_id::text || '/';
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_parent_asset_id is null then
    raise exception 'Generated meta crop identity is incomplete';
  end if;

  if v_format_key not in (
      'meta_feed_1x1', 'meta_feed_4x5', 'meta_story_9x16'
    )
    or v_provider_asset_id is null
    or char_length(v_provider_asset_id) > 255
    or v_sha256 !~ '^[0-9a-f]{64}$'
    or v_mime_type not in ('image/png', 'image/jpeg')
    or p_byte_size is null
    or p_byte_size <= 0
    or p_byte_size > 10485760
    or p_width is null
    or p_width not between 256 and 4096
    or p_height is null
    or p_height not between 256 and 4096
    or char_length(v_file_name) not between 1 and 160
    or v_bucket is null
    or char_length(v_bucket) > 63
    or v_path is null
    or char_length(v_path) > 1024
    or v_path not like v_expected_prefix || '%'
    or v_path like '%..%'
    or v_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{2}/[0-9a-f]{64}\.(png|jpg)$'
  then
    raise exception 'Generated meta crop metadata is invalid';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Generated meta crop metadata is invalid or unsafe';
  end if;

  select parent.*
  into v_parent
  from public.brand_assets parent
  where parent.id = p_parent_asset_id
    and parent.user_id = p_user_id
    and parent.platform_account_id = p_platform_account_id
    and parent.library_scope = 'CUSTOMER'
    and parent.source_type = 'GENERATED'
    and parent.asset_role = 'GENERATED'
    and parent.status in ('READY', 'PENDING')
  for update;

  if v_parent.id is null then
    raise exception 'Parent GENERATED brand asset is missing or not owned';
  end if;

  -- Enforce parent linkage + format role in metadata.
  v_metadata := v_metadata || jsonb_build_object(
    'contract_version', 1,
    'library', 'customer',
    'source_kind', 'generated_meta_crop',
    'role', v_format_key,
    'meta_format_key', v_format_key,
    'parent_asset_id', p_parent_asset_id,
    'generation_job_id', v_parent.generation_job_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'generated-meta-crop:' || p_platform_account_id::text || ':' || v_sha256,
      0
    )
  );

  select asset.*
  into v_existing
  from public.brand_assets asset
  where asset.platform_account_id = p_platform_account_id
    and asset.sha256 = v_sha256
  for update;

  if found then
    if v_existing.user_id <> p_user_id
      or v_existing.library_scope <> 'CUSTOMER'
      or v_existing.status = 'REVOKED' then
      raise exception 'Generated meta crop hash conflicts with another asset identity';
    end if;
    return v_existing.id;
  end if;

  insert into public.brand_assets (
    id, user_id, platform_account_id, brand_profile_id, source_type,
    library_scope, provider_key, provider_model, provider_version,
    provider_asset_id, storage_bucket, storage_path, original_filename,
    sha256, mime_type, byte_size, width, height, brand_policy_version,
    generation_input_hash, generation_job_id, moderation_status, status,
    metadata, reviewed_at, reviewed_by, asset_role, created_at, updated_at
  ) values (
    v_asset_id, p_user_id, p_platform_account_id, v_parent.brand_profile_id,
    'GENERATED', 'CUSTOMER', v_parent.provider_key, v_parent.provider_model,
    v_parent.provider_version, v_provider_asset_id, v_bucket, v_path,
    v_file_name, v_sha256, v_mime_type, p_byte_size, p_width, p_height,
    v_parent.brand_policy_version, v_parent.generation_input_hash,
    v_parent.generation_job_id, v_parent.moderation_status, v_parent.status,
    v_metadata, v_parent.reviewed_at, v_parent.reviewed_by, 'GENERATED',
    now(), now()
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'SYSTEM', 'creative-asset-format-slots', 'CREATIVE_ASSET_META_CROP_REGISTERED',
    '{}'::jsonb,
    jsonb_build_object(
      'parent_asset_id', p_parent_asset_id,
      'crop_asset_id', v_asset_id,
      'meta_format_key', v_format_key,
      'sha256', v_sha256,
      'generation_job_id', v_parent.generation_job_id
    ),
    '{}'::jsonb,
    jsonb_build_object('status', v_parent.status),
    '{}'::jsonb,
    v_parent.provider_key, v_parent.provider_model, v_parent.provider_version,
    null, null, now()
  );

  return v_asset_id;
end;
$$;

revoke all on function public.register_generated_meta_crop_asset(
  uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer,
  text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.register_generated_meta_crop_asset(
  uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer,
  text, text, jsonb
) to service_role;

comment on function public.register_generated_meta_crop_asset(
  uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer,
  text, text, jsonb
) is
  'Phase 7: register GENERATED Meta format-slot crop child of a GENERATED master.';

commit;

-- Creative Generation Phase 1: schema + input contract (no live provider calls).
-- Model-open: provider_key + model_id ready for OpenRouter (and others) in Phase 2.

begin;

-- ---------------------------------------------------------------------------
-- brand_assets: asset_role, training_status, style notes
-- ---------------------------------------------------------------------------

alter table public.brand_assets
  add column if not exists asset_role text not null default 'UPLOAD_EDITABLE';

alter table public.brand_assets
  drop constraint if exists brand_assets_asset_role_check;

alter table public.brand_assets
  add constraint brand_assets_asset_role_check
  check (asset_role in (
    'LOCKED_PHOTO',
    'UPLOAD_EDITABLE',
    'GENERATED',
    'STYLE_REFERENCE'
  ));

alter table public.brand_assets
  add column if not exists training_status text not null default 'none';

alter table public.brand_assets
  drop constraint if exists brand_assets_training_status_check;

alter table public.brand_assets
  add constraint brand_assets_training_status_check
  check (training_status in ('none', 'marked_good', 'performance_winner'));

alter table public.brand_assets
  add column if not exists marked_good_at timestamptz null;

alter table public.brand_assets
  add column if not exists marked_good_by uuid null
    references public.users (id) on delete restrict;

alter table public.brand_assets
  add column if not exists style_notes text null;

alter table public.brand_assets
  drop constraint if exists brand_assets_style_notes_len_check;

alter table public.brand_assets
  add constraint brand_assets_style_notes_len_check
  check (style_notes is null or char_length(style_notes) <= 500);

-- Backfill inspiration vault → STYLE_REFERENCE before role/scope constraints.
update public.brand_assets
set asset_role = 'STYLE_REFERENCE'
where library_scope = 'INSPIRATION'
  and asset_role is distinct from 'STYLE_REFERENCE';

-- LOCKED_PHOTO is customer Media Library only (never Inspiration vault).
alter table public.brand_assets
  drop constraint if exists brand_assets_locked_photo_customer_check;

alter table public.brand_assets
  add constraint brand_assets_locked_photo_customer_check
  check (
    asset_role <> 'LOCKED_PHOTO'
    or library_scope = 'CUSTOMER'
  );

-- Inspiration vault rows are style corpus (STYLE_REFERENCE).
alter table public.brand_assets
  drop constraint if exists brand_assets_inspiration_style_reference_check;

alter table public.brand_assets
  add constraint brand_assets_inspiration_style_reference_check
  check (
    library_scope <> 'INSPIRATION'
    or asset_role = 'STYLE_REFERENCE'
  );

-- marked_good requires audit fields; clear them for none; performance_winner is system-set.
alter table public.brand_assets
  drop constraint if exists brand_assets_marked_good_fields_check;

alter table public.brand_assets
  add constraint brand_assets_marked_good_fields_check
  check (
    (
      training_status = 'marked_good'
      and marked_good_at is not null
      and marked_good_by is not null
    )
    or (
      training_status = 'none'
      and marked_good_at is null
      and marked_good_by is null
    )
    or (
      training_status = 'performance_winner'
    )
  );

-- Product rule: GENERATED role implies source_type GENERATED.
-- Safe for current writers (uploads use UPLOAD_EDITABLE).
alter table public.brand_assets
  drop constraint if exists brand_assets_generated_role_source_check;

alter table public.brand_assets
  add constraint brand_assets_generated_role_source_check
  check (
    asset_role <> 'GENERATED'
    or source_type = 'GENERATED'
  );

comment on column public.brand_assets.asset_role is
  'LOCKED_PHOTO = embed-only, never alter; UPLOAD_EDITABLE = normal customer upload; GENERATED = AI output; STYLE_REFERENCE = style/inspiration corpus.';

comment on column public.brand_assets.training_status is
  'Customer/system training label: none | marked_good | performance_winner. Phase 1 stores labels only.';

comment on column public.brand_assets.style_notes is
  'Optional short style notes (max 500). Secret-free; not provider credentials.';
create index if not exists brand_assets_asset_role_idx
  on public.brand_assets (library_scope, asset_role, created_at desc);

create index if not exists brand_assets_training_status_idx
  on public.brand_assets (user_id, training_status, updated_at desc)
  where library_scope = 'CUSTOMER';

-- Customers need these columns in Media Library SELECT (PostgREST column grants).
grant select (
  asset_role,
  training_status,
  marked_good_at,
  marked_good_by,
  style_notes
) on table public.brand_assets to authenticated;

-- ---------------------------------------------------------------------------
-- Inspiration vault writer: always STYLE_REFERENCE
-- ---------------------------------------------------------------------------

create or replace function public.register_inspiration_vault_asset(
  p_uploader_user_id uuid,
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
  v_bucket text := nullif(btrim(coalesce(p_storage_bucket, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_file_name text := btrim(coalesce(p_original_filename, ''));
  v_sha256 text := lower(btrim(coalesce(p_sha256, '')));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_expected_prefix text := 'inspiration/' || p_uploader_user_id::text || '/';
begin
  if p_uploader_user_id is null then
    raise exception 'Inspiration vault uploader is required';
  end if;

  if not exists (
    select 1 from public.site_admins sa where sa.user_id = p_uploader_user_id
  ) then
    raise exception 'Only site admins may write to the inspiration vault';
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
    raise exception 'Inspiration vault asset metadata is invalid';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Inspiration vault metadata is invalid or unsafe';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('inspiration-vault:' || v_sha256, 0)
  );

  select asset.*
  into v_existing
  from public.brand_assets asset
  where asset.library_scope = 'INSPIRATION'
    and asset.sha256 = v_sha256
  for update;

  if found then
    return v_existing.id;
  end if;

  insert into public.brand_assets (
    id, user_id, platform_account_id, brand_profile_id, source_type,
    library_scope, asset_role, storage_bucket, storage_path, original_filename,
    sha256, mime_type, byte_size, width, height, brand_policy_version,
    moderation_status, status, metadata, reviewed_at, reviewed_by,
    created_at, updated_at
  ) values (
    v_asset_id, p_uploader_user_id, null, null,
    'UPLOADED', 'INSPIRATION', 'STYLE_REFERENCE', v_bucket, v_path, v_file_name, v_sha256,
    v_mime_type, p_byte_size, p_width, p_height, 1,
    'APPROVED', 'READY', v_metadata, now(), p_uploader_user_id, now(), now()
  );

  return v_asset_id;
end;
$$;

revoke all on function public.register_inspiration_vault_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.register_inspiration_vault_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- Generation input contract validator (Phase 1 shape only; no HTTP)
-- ---------------------------------------------------------------------------

create or replace function public.creative_generation_input_contract_valid(p_input jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_provider text;
  v_model text;
  v_refs jsonb;
  v_locked jsonb;
  v_output jsonb;
  v_mime text;
  v_aspect text;
  v_id text;
  v_ref_count integer := 0;
  v_locked_count integer := 0;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    return false;
  end if;

  if public.meta_jsonb_has_sensitive_key(p_input) then
    return false;
  end if;

  if coalesce(p_input->>'contract_version', '') <> 'adbot-creative-generation-v1' then
    return false;
  end if;

  v_mode := p_input->>'mode';
  if v_mode is distinct from 'free' and v_mode is distinct from 'locked_photo' then
    return false;
  end if;

  v_provider := p_input->>'provider_key';
  if v_provider is null or v_provider !~ '^[a-z][a-z0-9_-]{1,63}$' then
    return false;
  end if;

  v_model := p_input->>'model_id';
  if v_model is null or char_length(v_model) not between 1 and 160 then
    return false;
  end if;

  if p_input ? 'prompt' then
    if jsonb_typeof(p_input->'prompt') <> 'string' then
      return false;
    end if;
    if char_length(coalesce(p_input->>'prompt', '')) > 8000 then
      return false;
    end if;
  end if;

  if not (p_input ? 'reference_asset_ids')
    or jsonb_typeof(p_input->'reference_asset_ids') <> 'array' then
    return false;
  end if;

  v_refs := p_input->'reference_asset_ids';
  v_ref_count := jsonb_array_length(v_refs);
  if v_ref_count > 32 then
    return false;
  end if;

  for v_id in
    select value
    from jsonb_array_elements_text(v_refs) as t(value)
  loop
    if v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
  end loop;

  if not (p_input ? 'locked_photo_asset_ids')
    or jsonb_typeof(p_input->'locked_photo_asset_ids') <> 'array' then
    return false;
  end if;

  v_locked := p_input->'locked_photo_asset_ids';
  v_locked_count := jsonb_array_length(v_locked);
  if v_locked_count > 16 then
    return false;
  end if;

  for v_id in
    select value
    from jsonb_array_elements_text(v_locked) as t(value)
  loop
    if v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
  end loop;

  if v_mode = 'locked_photo' and v_locked_count < 1 then
    return false;
  end if;

  if v_mode = 'free' and v_locked_count <> 0 then
    return false;
  end if;

  if not (p_input ? 'output') or jsonb_typeof(p_input->'output') <> 'object' then
    return false;
  end if;

  v_output := p_input->'output';
  v_mime := v_output->>'mime_type';
  if v_mime is distinct from 'image/png' and v_mime is distinct from 'image/jpeg' then
    return false;
  end if;

  if v_output ? 'aspect_hint' then
    if jsonb_typeof(v_output->'aspect_hint') <> 'string' then
      return false;
    end if;
    v_aspect := v_output->>'aspect_hint';
    if v_aspect is null or char_length(v_aspect) not between 1 and 32 then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function public.creative_generation_input_contract_valid(jsonb) is
  'Phase 1 shape validator for adbot-creative-generation-v1. Provider-open (provider_key regex). No external API calls.';

revoke all on function public.creative_generation_input_contract_valid(jsonb)
  from public, anon, authenticated;
grant execute on function public.creative_generation_input_contract_valid(jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Customer RPC: mark / clear training_status (CUSTOMER scope, own assets)
-- ---------------------------------------------------------------------------

create or replace function public.mark_brand_asset_training_status(
  p_asset_id uuid,
  p_training_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text := lower(btrim(coalesce(p_training_status, '')));
  v_asset public.brand_assets%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_status not in ('none', 'marked_good') then
    raise exception 'Customers may only set marked_good or clear to none';
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
    raise exception 'Revoked assets cannot change training status';
  end if;

  if v_status = 'marked_good' then
    update public.brand_assets
    set training_status = 'marked_good',
        marked_good_at = now(),
        marked_good_by = v_user_id,
        updated_at = now()
    where id = v_asset.id;
  else
    update public.brand_assets
    set training_status = 'none',
        marked_good_at = null,
        marked_good_by = null,
        updated_at = now()
    where id = v_asset.id;
  end if;

  return true;
end;
$$;

revoke all on function public.mark_brand_asset_training_status(uuid, text)
  from public, anon;
grant execute on function public.mark_brand_asset_training_status(uuid, text)
  to authenticated, service_role;

commit;

-- Customer-authorized Meta onboarding and launch commands.
--
-- Browser sessions remain read-only. Every mutation is authenticated by the
-- application server and reaches one of these narrow service-role-only RPCs.
-- Activating a write-capable prerequisite, importing a launch-ready asset, or
-- materializing a launch additionally requires the account-local
-- ads_management scope at the database boundary.

create or replace function public.register_meta_allowed_domain(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_hostname text,
  p_registrable_domain text,
  p_verification_method text,
  p_verification_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain_id uuid := gen_random_uuid();
  v_existing public.allowed_domains%rowtype;
  v_hostname text := lower(trim(trailing '.' from btrim(coalesce(p_hostname, ''))));
  v_registrable_domain text := lower(
    trim(trailing '.' from btrim(coalesce(p_registrable_domain, '')))
  );
  v_method text := upper(btrim(coalesce(p_verification_method, '')));
  v_evidence jsonb := coalesce(p_verification_evidence, '{}'::jsonb);
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Domain command identity is incomplete';
  end if;

  if char_length(v_hostname) not between 3 and 253
    or char_length(v_registrable_domain) not between 3 and 253
    or position('.' in v_hostname) = 0
    or position('.' in v_registrable_domain) = 0
    or v_hostname !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    or v_registrable_domain !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    or v_hostname like '%.%.%.'
    or v_hostname like '%..%'
    or v_registrable_domain like '%..%'
    or v_hostname ~ '(^|\.)-'
    or v_hostname ~ '-(\.|$)'
    or v_registrable_domain ~ '(^|\.)-'
    or v_registrable_domain ~ '-(\.|$)'
    or exists (
      select 1
      from pg_catalog.regexp_split_to_table(v_hostname, '\.') as label(value)
      where char_length(label.value) not between 1 and 63
    )
    or exists (
      select 1
      from pg_catalog.regexp_split_to_table(v_registrable_domain, '\.') as label(value)
      where char_length(label.value) not between 1 and 63
    ) then
    raise exception 'Domain hostname is invalid';
  end if;

  if v_hostname <> v_registrable_domain
    and v_hostname not like '%.' || v_registrable_domain then
    raise exception 'Hostname is not covered by registrable domain';
  end if;

  if v_method not in ('CUSTOMER_CONFIRMATION', 'DNS_TXT', 'HTTPS_FILE') then
    raise exception 'Domain verification method is invalid';
  end if;

  if jsonb_typeof(v_evidence) <> 'object'
    or pg_catalog.octet_length(v_evidence::text) > 8192
    or public.meta_jsonb_has_sensitive_key(v_evidence) then
    raise exception 'Domain verification evidence is invalid or unsafe';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Active customer Meta account is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'customer-domain:' || p_platform_account_id::text || ':' || v_hostname,
      0
    )
  );

  select domain_row.*
  into v_existing
  from public.allowed_domains domain_row
  where domain_row.user_id = p_user_id
    and domain_row.platform_account_id = p_platform_account_id
    and domain_row.hostname = v_hostname
    and domain_row.status in ('PENDING', 'VERIFIED')
    and domain_row.revoked_at is null
  order by domain_row.created_at desc
  limit 1
  for update;

  if found then
    if v_existing.registrable_domain <> v_registrable_domain
      or v_existing.verification_method <> v_method then
      raise exception 'Active domain registration conflicts with supplied identity';
    end if;
    return v_existing.id;
  end if;

  insert into public.allowed_domains (
    id, user_id, platform_account_id, hostname, registrable_domain,
    verification_method, verification_evidence, status, created_at, updated_at
  ) values (
    v_domain_id, p_user_id, p_platform_account_id, v_hostname,
    v_registrable_domain, v_method, v_evidence, 'PENDING', now(), now()
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'ALLOWED_DOMAIN_REGISTERED',
    '{}'::jsonb,
    jsonb_build_object(
      'hostname', v_hostname,
      'registrable_domain', v_registrable_domain,
      'verification_method', v_method
    ),
    '{}'::jsonb,
    jsonb_build_object('domain_id', v_domain_id, 'status', 'PENDING'),
    jsonb_build_object(
      'verification_evidence_hash', public.meta_sha256(v_evidence::text)
    ),
    null, null, null, null, null, now()
  );

  return v_domain_id;
end;
$$;

create or replace function public.confirm_meta_allowed_domain(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_domain_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain public.allowed_domains%rowtype;
begin
  if p_user_id is null or p_platform_account_id is null or p_domain_id is null then
    raise exception 'Domain confirmation identity is incomplete';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and pa.marketing_currency = 'EUR'
      and 'ads_management' = any(pa.meta_scopes)
  ) then
    raise exception 'Domain activation requires ads_management on an active EUR Meta account';
  end if;

  select domain_row.*
  into v_domain
  from public.allowed_domains domain_row
  where domain_row.id = p_domain_id
    and domain_row.user_id = p_user_id
    and domain_row.platform_account_id = p_platform_account_id
  for update;

  if not found then
    raise exception 'Customer domain was not found';
  end if;

  if v_domain.status = 'VERIFIED'
    and v_domain.customer_confirmed_at is not null
    and v_domain.customer_confirmed_by = p_user_id
    and v_domain.verified_at is not null
    and v_domain.revoked_at is null then
    return v_domain.id;
  end if;

  if v_domain.status <> 'PENDING' or v_domain.revoked_at is not null then
    raise exception 'Only an active pending domain can be confirmed';
  end if;

  update public.allowed_domains
  set status = 'VERIFIED',
      verified_at = now(),
      customer_confirmed_at = now(),
      customer_confirmed_by = p_user_id,
      updated_at = now()
  where id = v_domain.id;

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'ALLOWED_DOMAIN_CONFIRMED',
    jsonb_build_object('domain_id', v_domain.id, 'status', v_domain.status),
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('domain_id', v_domain.id, 'status', 'VERIFIED'),
    jsonb_build_object(
      'hostname', v_domain.hostname,
      'registrable_domain', v_domain.registrable_domain,
      'verification_method', v_domain.verification_method
    ),
    null, null, null, null, null, now()
  );

  return v_domain.id;
end;
$$;

create or replace function public.put_meta_objective_blueprint(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_objective text,
  p_name text,
  p_payload_template jsonb,
  p_required_inputs jsonb default '["destination_url"]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blueprint_id uuid := gen_random_uuid();
  v_existing public.objective_blueprints%rowtype;
  v_objective text := upper(btrim(coalesce(p_objective, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_payload jsonb := coalesce(p_payload_template, '{}'::jsonb);
  v_required_inputs jsonb := coalesce(p_required_inputs, '[]'::jsonb);
  v_version integer;
  v_hash text;
  v_objective_allowlist constant text[] := array[
    'APP_INSTALLS', 'BRAND_AWARENESS', 'CONVERSIONS', 'EVENT_RESPONSES',
    'LEAD_GENERATION', 'LINK_CLICKS', 'LOCAL_AWARENESS', 'MESSAGES',
    'OFFER_CLAIMS', 'OUTCOME_APP_PROMOTION', 'OUTCOME_AWARENESS',
    'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES',
    'OUTCOME_TRAFFIC', 'PAGE_LIKES', 'POST_ENGAGEMENT',
    'PRODUCT_CATALOG_SALES', 'REACH', 'STORE_VISITS', 'VIDEO_VIEWS'
  ]::text[];
  v_required_allowlist constant text[] := array[
    'destination_url', 'campaign_name', 'ad_set_name', 'creative_name', 'ad_name'
  ]::text[];
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Blueprint command identity is incomplete';
  end if;

  if not (v_objective = any(v_objective_allowlist)) then
    raise exception 'Meta objective is not allowlisted';
  end if;

  if char_length(v_name) not between 1 and 255 then
    raise exception 'Blueprint name is invalid';
  end if;

  if jsonb_typeof(v_payload) <> 'object'
    or jsonb_typeof(v_payload->'campaign') <> 'object'
    or jsonb_typeof(v_payload->'ad_set') <> 'object'
    or jsonb_typeof(v_payload->'creative') <> 'object'
    or jsonb_typeof(v_payload->'ad') <> 'object'
    or pg_catalog.octet_length(v_payload::text) > 262144
    or public.meta_jsonb_has_sensitive_key(v_payload) then
    raise exception 'Objective blueprint payload is invalid or unsafe';
  end if;

  if not public.meta_launch_payload_keys_allowed('CAMPAIGN', v_payload->'campaign')
    or not public.meta_launch_payload_keys_allowed('AD_SET', v_payload->'ad_set')
    or not public.meta_launch_payload_keys_allowed('CREATIVE', v_payload->'creative')
    or not public.meta_launch_payload_keys_allowed('AD', v_payload->'ad') then
    raise exception 'Objective blueprint contains a non-allowlisted Meta field';
  end if;

  if v_payload->'campaign' ? 'objective'
    and v_payload#>>'{campaign,objective}' <> v_objective then
    raise exception 'Blueprint campaign objective conflicts with blueprint identity';
  end if;

  if jsonb_typeof(v_required_inputs) <> 'array'
    or pg_catalog.jsonb_array_length(v_required_inputs) > 5 then
    raise exception 'Blueprint required inputs are invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_required_inputs) entry(value)
    where jsonb_typeof(entry.value) <> 'string'
      or not (trim(both '"' from entry.value::text) = any(v_required_allowlist))
  ) or (
    select count(*)
    from pg_catalog.jsonb_array_elements_text(v_required_inputs) entry(value)
  ) <> (
    select count(distinct entry.value)
    from pg_catalog.jsonb_array_elements_text(v_required_inputs) entry(value)
  ) then
    raise exception 'Blueprint required inputs are not allowlisted or unique';
  end if;

  if not (
    v_required_inputs ? 'destination_url'
    or nullif(v_payload#>>'{creative,link_url}', '') is not null
    or nullif(v_payload#>>'{creative,object_url}', '') is not null
    or nullif(v_payload#>>'{creative,template_url}', '') is not null
    or nullif(v_payload#>>'{creative,object_story_spec,link_data,link}', '') is not null
    or nullif(
      v_payload#>>'{creative,object_story_spec,video_data,call_to_action,value,link}',
      ''
    ) is not null
  ) then
    raise exception 'Blueprint requires an HTTPS destination source';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Active customer Meta account is required';
  end if;

  v_hash := public.meta_sha256(
    jsonb_build_object(
      'contract_version', 1,
      'objective', v_objective,
      'name', v_name,
      'payload_template', v_payload,
      'required_inputs', v_required_inputs
    )::text
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'customer-blueprint:' || p_platform_account_id::text || ':' || v_objective,
      0
    )
  );

  select blueprint.*
  into v_existing
  from public.objective_blueprints blueprint
  where blueprint.user_id = p_user_id
    and blueprint.platform_account_id = p_platform_account_id
    and blueprint.objective = v_objective
    and blueprint.blueprint_hash = v_hash
    and blueprint.status in ('DRAFT', 'ACTIVE')
  order by blueprint.version desc
  limit 1
  for update;

  if found then
    return v_existing.id;
  end if;

  select coalesce(max(blueprint.version), 0) + 1
  into v_version
  from public.objective_blueprints blueprint
  where blueprint.user_id = p_user_id
    and blueprint.platform_account_id = p_platform_account_id
    and blueprint.objective = v_objective;

  insert into public.objective_blueprints (
    id, user_id, platform_account_id, objective, version, name, status,
    payload_template, required_inputs, compliance_rules, blueprint_hash,
    created_at, updated_at
  ) values (
    v_blueprint_id, p_user_id, p_platform_account_id, v_objective, v_version,
    v_name, 'DRAFT', v_payload, v_required_inputs,
    jsonb_build_object(
      'contract_version', 1,
      'destination', 'CUSTOMER_VERIFIED_DOMAIN',
      'initial_remote_status', 'PAUSED_SHADOW_THEN_ACTIVE',
      'final_remote_status', 'ACTIVE'
    ),
    v_hash, now(), now()
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'OBJECTIVE_BLUEPRINT_DRAFTED',
    '{}'::jsonb,
    jsonb_build_object(
      'objective', v_objective,
      'name', v_name,
      'version', v_version,
      'required_inputs', v_required_inputs
    ),
    '{}'::jsonb,
    jsonb_build_object('blueprint_id', v_blueprint_id, 'status', 'DRAFT'),
    jsonb_build_object('blueprint_hash', v_hash),
    null, null, null, null, null, now()
  );

  return v_blueprint_id;
end;
$$;

create or replace function public.activate_meta_objective_blueprint(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_blueprint_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blueprint public.objective_blueprints%rowtype;
  v_retired_ids uuid[] := '{}'::uuid[];
begin
  if p_user_id is null or p_platform_account_id is null or p_blueprint_id is null then
    raise exception 'Blueprint activation identity is incomplete';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and pa.marketing_currency = 'EUR'
      and 'ads_management' = any(pa.meta_scopes)
  ) then
    raise exception 'Blueprint activation requires ads_management on an active EUR Meta account';
  end if;

  select blueprint.*
  into v_blueprint
  from public.objective_blueprints blueprint
  where blueprint.id = p_blueprint_id
    and blueprint.user_id = p_user_id
    and blueprint.platform_account_id = p_platform_account_id
  for update;

  if not found then
    raise exception 'Customer objective blueprint was not found';
  end if;

  if v_blueprint.status = 'ACTIVE'
    and v_blueprint.customer_confirmed_at is not null
    and v_blueprint.customer_confirmed_by = p_user_id
    and v_blueprint.activated_at is not null then
    return v_blueprint.id;
  end if;

  if v_blueprint.status <> 'DRAFT' then
    raise exception 'Only a draft objective blueprint can be activated';
  end if;

  with retired as (
    update public.objective_blueprints
    set status = 'RETIRED', retired_at = now(), updated_at = now()
    where user_id = p_user_id
      and platform_account_id = p_platform_account_id
      and objective = v_blueprint.objective
      and status = 'ACTIVE'
      and id <> v_blueprint.id
    returning id
  )
  select coalesce(array_agg(retired.id), '{}'::uuid[])
  into v_retired_ids
  from retired;

  update public.objective_blueprints
  set status = 'ACTIVE',
      customer_confirmed_at = now(),
      customer_confirmed_by = p_user_id,
      activated_at = now(),
      retired_at = null,
      updated_at = now()
  where id = v_blueprint.id;

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'OBJECTIVE_BLUEPRINT_ACTIVATED',
    jsonb_build_object(
      'blueprint_id', v_blueprint.id,
      'status', v_blueprint.status
    ),
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('blueprint_id', v_blueprint.id, 'status', 'ACTIVE'),
    jsonb_build_object(
      'objective', v_blueprint.objective,
      'version', v_blueprint.version,
      'blueprint_hash', v_blueprint.blueprint_hash,
      'retired_blueprint_ids', pg_catalog.to_jsonb(v_retired_ids)
    ),
    null, null, null, null, null, now()
  );

  return v_blueprint.id;
end;
$$;

create or replace function public.import_meta_brand_asset_from_creative(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_brand_profile_id uuid,
  p_source_meta_asset_id text,
  p_source_marketing_sync_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_meta_image_hash text default null,
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
  v_source_id text := btrim(coalesce(p_source_meta_asset_id, ''));
  v_bucket text := nullif(btrim(coalesce(p_storage_bucket, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_file_name text := btrim(coalesce(p_original_filename, ''));
  v_sha256 text := lower(btrim(coalesce(p_sha256, '')));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_meta_image_hash text := nullif(lower(btrim(coalesce(p_meta_image_hash, ''))), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_expected_prefix text := p_user_id::text || '/' || p_platform_account_id::text || '/';
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_brand_profile_id is null
    or p_source_marketing_sync_id is null then
    raise exception 'Brand asset import identity is incomplete';
  end if;

  if v_source_id !~ '^[0-9]{1,64}$' then
    raise exception 'Source Meta Creative ID is invalid';
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
    or char_length(v_file_name) not between 1 and 255 then
    raise exception 'Imported brand asset metadata is invalid';
  end if;

  if v_meta_image_hash is not null
    and v_meta_image_hash !~ '^[0-9a-f]{16,128}$' then
    raise exception 'Imported Meta image hash is invalid';
  end if;

  if v_meta_image_hash is null and (
    v_bucket is null
    or char_length(v_bucket) > 63
    or v_path is null
    or char_length(v_path) > 1024
    or v_path not like v_expected_prefix || '%'
    or v_path like '%..%'
  ) then
    raise exception 'Private storage evidence is required for an unhashed Meta asset';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Imported brand asset metadata is invalid or unsafe';
  end if;

  perform 1
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
    and pa.marketing_currency = 'EUR'
    and 'ads_management' = any(pa.meta_scopes)
    and pa.marketing_sync_status = 'success'
    and pa.marketing_sync_id = p_source_marketing_sync_id
    and pa.marketing_last_success_at >= now() - interval '2 hours'
    and pa.marketing_last_success_at <= now() + interval '1 minute';

  if not found then
    raise exception 'Brand asset import requires ads_management and a fresh successful EUR Meta sync';
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

  if not exists (
    select 1
    from public.creatives creative
    where creative.user_id = p_user_id
      and creative.platform_account_id = p_platform_account_id
      and creative.platform_creative_id = v_source_id
      and creative.source = 'meta'
      and creative.is_current
      and creative.last_seen_sync_id = p_source_marketing_sync_id
  ) then
    raise exception 'Tenant-owned synced Meta Creative is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'customer-brand-asset:' || p_platform_account_id::text || ':' || v_sha256,
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
      or v_existing.brand_profile_id <> p_brand_profile_id
      or v_existing.source_type <> 'EXISTING_META'
      or v_existing.source_meta_asset_id is distinct from v_source_id
      or v_existing.status <> 'READY'
      or v_existing.moderation_status <> 'APPROVED' then
      raise exception 'Brand asset hash conflicts with another asset identity';
    end if;
    return v_existing.id;
  end if;

  insert into public.brand_assets (
    id, user_id, platform_account_id, brand_profile_id, source_type,
    provider_key, provider_model, provider_version, provider_asset_id,
    source_meta_asset_id, storage_bucket, storage_path, original_filename,
    sha256, mime_type, byte_size, width, height, brand_policy_version,
    moderation_status, status, meta_image_hash, metadata, reviewed_at,
    reviewed_by, created_at, updated_at
  ) values (
    v_asset_id, p_user_id, p_platform_account_id, p_brand_profile_id,
    'EXISTING_META', 'meta-marketing-api', 'ad-creative', 'v25.0',
    v_source_id, v_source_id, v_bucket, v_path, v_file_name, v_sha256,
    v_mime_type, p_byte_size, p_width, p_height, v_profile.version,
    'APPROVED', 'READY', v_meta_image_hash, v_metadata, now(), p_user_id,
    now(), now()
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'BRAND_ASSET_IMPORTED_FROM_META',
    '{}'::jsonb,
    jsonb_build_object(
      'brand_profile_id', p_brand_profile_id,
      'source_meta_creative_id', v_source_id
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'asset_id', v_asset_id,
      'status', 'READY',
      'moderation_status', 'APPROVED'
    ),
    jsonb_build_object(
      'sha256', v_sha256,
      'mime_type', v_mime_type,
      'byte_size', p_byte_size,
      'width', p_width,
      'height', p_height,
      'meta_image_hash_present', v_meta_image_hash is not null
    ),
    'meta-marketing-api', 'ad-creative', 'v25.0', null, null, now()
  );

  return v_asset_id;
end;
$$;

create or replace function public.list_current_meta_creatives_for_import(
  p_platform_account_id uuid
)
returns table (
  creative_id text,
  creative_name text,
  has_importable_image boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_marketing_sync_id uuid;
begin
  if v_user_id is null or p_platform_account_id is null then
    raise exception 'Authenticated Meta account identity is required'
      using errcode = '42501';
  end if;

  select account.marketing_sync_id
  into v_marketing_sync_id
  from public.platform_accounts account
  where account.id = p_platform_account_id
    and account.user_id = v_user_id
    and account.platform = 'meta'
    and account.revoked_at is null
    and account.marketing_currency = 'EUR'
    and 'ads_management' = any(account.meta_scopes)
    and account.marketing_sync_status = 'success'
    and account.marketing_sync_id is not null
    and account.marketing_last_success_at >= now() - interval '2 hours'
    and account.marketing_last_success_at <= now() + interval '1 minute';

  if not found then
    return;
  end if;

  return query
  select
    creative.platform_creative_id,
    coalesce(nullif(btrim(creative.name), ''), 'Meta-Creative'),
    case
      when coalesce(creative.content->>'image_url', '') <> '' then
        creative.content->>'image_url' ~*
          '^https://[a-z0-9-]+(?:[.][a-z0-9-]+)*[.](?:fbcdn[.]net|fbsbx[.]com|cdninstagram[.]com)(?:[/?#]|$)'
      else
        coalesce(creative.content->>'thumbnail_url', '') ~*
          '^https://[a-z0-9-]+(?:[.][a-z0-9-]+)*[.](?:fbcdn[.]net|fbsbx[.]com|cdninstagram[.]com)(?:[/?#]|$)'
    end
  from public.creatives creative
  where creative.user_id = v_user_id
    and creative.platform_account_id = p_platform_account_id
    and creative.source = 'meta'
    and creative.is_current
    and creative.last_seen_sync_id = v_marketing_sync_id
    and creative.platform_creative_id ~ '^[0-9]{1,64}$'
  order by creative.last_seen_at desc, creative.platform_creative_id
  limit 100;
end;
$$;

create or replace function public.materialize_meta_customer_launch_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_read_lease_token uuid,
  p_blueprint_id uuid,
  p_brand_profile_id uuid,
  p_brand_asset_id uuid,
  p_allowed_domain_id uuid,
  p_budget_owner_type text,
  p_daily_budget_minor bigint,
  p_launch_inputs jsonb default '{}'::jsonb,
  p_planned_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_domain public.allowed_domains%rowtype;
  v_destination_url text;
  v_destination_host text;
  v_result jsonb;
  v_plan_id uuid;
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_read_lease_token is null
    or p_blueprint_id is null
    or p_brand_profile_id is null
    or p_brand_asset_id is null
    or p_allowed_domain_id is null
    or p_planned_at is null
    or p_daily_budget_minor is null
    or p_daily_budget_minor <= 0
    or p_budget_owner_type not in ('CAMPAIGN', 'AD_SET')
    or jsonb_typeof(coalesce(p_launch_inputs, '{}'::jsonb)) <> 'object'
    or pg_catalog.octet_length(coalesce(p_launch_inputs, '{}'::jsonb)::text) > 32768
    or public.meta_jsonb_has_sensitive_key(coalesce(p_launch_inputs, '{}'::jsonb)) then
    raise exception 'Customer launch command is invalid or unsafe';
  end if;

  select account.*
  into v_account
  from public.platform_accounts account
  where account.id = p_platform_account_id
    and account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null
    and account.marketing_currency = 'EUR'
    and account.marketing_sync_status = 'success'
    and account.marketing_sync_id is not null
    and account.marketing_last_success_at >= p_planned_at - interval '2 hours'
    and account.marketing_timezone_name is not null
    and 'ads_management' = any(account.meta_scopes)
  for update;

  if not found then
    raise exception 'Customer launch requires ads_management and a current EUR Meta snapshot';
  end if;

  select policy.*
  into v_policy
  from public.automation_policies policy
  where policy.user_id = p_user_id
    and policy.platform_account_id = p_platform_account_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.currency = 'EUR'
    and policy.allow_new_launches
    and policy.allow_status_changes
  for update;

  if not found then
    raise exception 'Active launch- and status-enabled customer policy is required';
  end if;

  select domain_row.*
  into v_domain
  from public.allowed_domains domain_row
  where domain_row.id = p_allowed_domain_id
    and domain_row.user_id = p_user_id
    and domain_row.platform_account_id = p_platform_account_id
    and domain_row.status = 'VERIFIED'
    and domain_row.verified_at is not null
    and domain_row.customer_confirmed_at is not null
    and domain_row.customer_confirmed_by = p_user_id
    and domain_row.revoked_at is null
  for update;

  if not found then
    raise exception 'Verified customer-confirmed exact launch host is required';
  end if;

  v_destination_url := nullif(
    btrim(coalesce(p_launch_inputs->>'destination_url', '')),
    ''
  );
  v_destination_host := lower(
    substring(v_destination_url from '^https://([^/:?#]+)')
  );

  if v_destination_host is null or v_destination_host <> v_domain.hostname then
    raise exception 'Customer launch destination must exactly match the confirmed hostname';
  end if;

  select snapshot.*
  into v_snapshot
  from public.daily_budget_exposure_snapshots snapshot
  where snapshot.user_id = p_user_id
    and snapshot.platform_account_id = p_platform_account_id
    and snapshot.policy_id = v_policy.id
    and snapshot.source_marketing_sync_id = v_account.marketing_sync_id
    and snapshot.account_day = (
      p_planned_at at time zone v_account.marketing_timezone_name
    )::date
    and snapshot.status = 'COMPLETE'
    and snapshot.currency = 'EUR'
  order by snapshot.completed_at desc nulls last, snapshot.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Current complete customer exposure snapshot is required';
  end if;

  v_result := public.materialize_meta_launch_chain_plan(
    p_user_id,
    p_platform_account_id,
    v_policy.id,
    v_snapshot.id,
    v_account.marketing_sync_id,
    p_read_lease_token,
    p_blueprint_id,
    p_brand_profile_id,
    array[p_brand_asset_id]::uuid[],
    p_allowed_domain_id,
    p_budget_owner_type,
    p_daily_budget_minor,
    coalesce(p_launch_inputs, '{}'::jsonb),
    p_planned_at
  );

  if v_result->>'outcome' = 'CREATED' then
    v_plan_id := (v_result->>'plan_id')::uuid;
    perform public.append_meta_mutation_audit_event(
      p_user_id, p_platform_account_id, v_policy.id, v_plan_id,
      null, null, 'CUSTOMER', p_user_id::text, 'CUSTOMER_LAUNCH_AUTHORIZED',
      jsonb_build_object(
        'kill_switch_gate', 'ALLOW',
        'source_marketing_sync_id', v_account.marketing_sync_id,
        'exposure_snapshot_id', v_snapshot.id
      ),
      jsonb_build_object(
        'blueprint_id', p_blueprint_id,
        'brand_profile_id', p_brand_profile_id,
        'brand_asset_id', p_brand_asset_id,
        'allowed_domain_id', p_allowed_domain_id,
        'budget_owner_type', p_budget_owner_type,
        'daily_budget_minor', p_daily_budget_minor
      ),
      '{}'::jsonb,
      jsonb_build_object('plan_id', v_plan_id, 'status', 'PENDING'),
      jsonb_build_object(
        'idempotency_key', v_result->>'idempotency_key',
        'step_count', v_result->'step_count'
      ),
      null, null, null, null, null, p_planned_at
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.register_meta_allowed_domain(
  uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.confirm_meta_allowed_domain(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.put_meta_objective_blueprint(
  uuid, uuid, text, text, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.activate_meta_objective_blueprint(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.import_meta_brand_asset_from_creative(
  uuid, uuid, uuid, text, uuid, text, text, text, text, text, bigint, integer,
  integer, text, jsonb
) from public, anon, authenticated;
revoke all on function public.list_current_meta_creatives_for_import(
  uuid
) from public, anon, authenticated;
revoke all on function public.materialize_meta_customer_launch_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, jsonb, timestamptz
) from public, anon, authenticated;

grant execute on function public.register_meta_allowed_domain(
  uuid, uuid, text, text, text, jsonb
) to service_role;
grant execute on function public.confirm_meta_allowed_domain(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.put_meta_objective_blueprint(
  uuid, uuid, text, text, jsonb, jsonb
) to service_role;
grant execute on function public.activate_meta_objective_blueprint(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.import_meta_brand_asset_from_creative(
  uuid, uuid, uuid, text, uuid, text, text, text, text, text, bigint, integer,
  integer, text, jsonb
) to service_role;
grant execute on function public.list_current_meta_creatives_for_import(
  uuid
) to authenticated;
grant execute on function public.materialize_meta_customer_launch_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, jsonb, timestamptz
) to service_role;

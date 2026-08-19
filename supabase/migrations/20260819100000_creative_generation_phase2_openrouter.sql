-- Creative Generation Phase 2: OpenRouter-ready completion + enqueue contract gate.
-- Sets asset_role = GENERATED on successful completion; validates generation contract
-- when input carries contract_version = adbot-creative-generation-v1.

begin;

create or replace function public.enqueue_creative_asset_job(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_brand_profile_id uuid,
  p_provider_key text,
  p_provider_model text,
  p_provider_version text,
  p_input_payload jsonb,
  p_max_attempts integer default 3
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_input_hash text;
  v_idempotency_key text;
  v_created boolean := false;
begin
  if p_provider_key !~ '^[a-z][a-z0-9_-]{1,63}$'
    or nullif(btrim(p_provider_model), '') is null
    or jsonb_typeof(p_input_payload) <> 'object'
    or p_max_attempts not between 1 and 5 then
    raise exception 'Creative asset job request is invalid';
  end if;

  if pg_catalog.octet_length(p_input_payload::text) > 65536
    or public.meta_jsonb_has_sensitive_key(p_input_payload) then
    raise exception 'Sensitive or oversized creative asset input rejected';
  end if;

  -- Phase 2: when the generation contract is present, enforce SQL shape validator.
  if coalesce(p_input_payload->>'contract_version', '') = 'adbot-creative-generation-v1'
    and not public.creative_generation_input_contract_valid(p_input_payload) then
    raise exception 'Creative generation input contract is invalid';
  end if;

  if not exists (
    select 1 from public.brand_profiles bp
    where bp.id = p_brand_profile_id
      and bp.user_id = p_user_id
      and bp.platform_account_id = p_platform_account_id
      and bp.status = 'ACTIVE'
  ) then
    raise exception 'Active brand profile is required';
  end if;

  if not exists (
    select 1
    from public.automation_policies ap
    join public.platform_accounts pa
      on pa.id = ap.platform_account_id
     and pa.user_id = ap.user_id
     and pa.platform = 'meta'
     and pa.revoked_at is null
    where ap.user_id = p_user_id
      and ap.platform_account_id = p_platform_account_id
      and ap.status = 'ACTIVE'
      and ap.is_current
      and ap.allow_new_launches
  ) or not exists (
    select 1
    from public.get_effective_meta_kill_switch(
      p_user_id, p_platform_account_id, null
    ) ks
    where ks.mode = 'ALLOW'
  ) then
    raise exception 'Active autonomous launch policy and open kill-switch are required';
  end if;

  v_input_hash := public.meta_sha256(p_input_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_platform_account_id::text || ':' || p_brand_profile_id::text || ':'
    || p_provider_key || ':' || p_provider_model || ':'
    || coalesce(p_provider_version, '') || ':' || v_input_hash
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_idempotency_key, 0)
  );

  select caj.id into v_job_id
  from public.creative_asset_jobs caj
  where caj.platform_account_id = p_platform_account_id
    and caj.idempotency_key = v_idempotency_key;

  if v_job_id is null then
    v_job_id := gen_random_uuid();
    insert into public.creative_asset_jobs (
      id, user_id, platform_account_id, brand_profile_id, provider_key,
      provider_model, provider_version, idempotency_key, input_payload,
      input_hash, max_attempts
    ) values (
      v_job_id, p_user_id, p_platform_account_id, p_brand_profile_id,
      p_provider_key, btrim(p_provider_model), nullif(btrim(coalesce(p_provider_version, '')), ''),
      v_idempotency_key, p_input_payload, v_input_hash, p_max_attempts
    );
    v_created := true;
  end if;

  if v_created then
    perform public.append_meta_mutation_audit_event(
      p_user_id, p_platform_account_id, null, null, null, null,
      'SYSTEM', 'creative-asset-planner', 'CREATIVE_ASSET_JOB_QUEUED',
      '{}'::jsonb,
      jsonb_build_object(
        'job_id', v_job_id,
        'input_hash', v_input_hash,
        'idempotency_key', v_idempotency_key
      ),
      '{}'::jsonb,
      jsonb_build_object('status', 'PENDING'),
      '{}'::jsonb, p_provider_key, btrim(p_provider_model),
      nullif(btrim(coalesce(p_provider_version, '')), ''), null, null, now()
    );
  end if;

  return v_job_id;
end;
$$;

create or replace function public.complete_creative_asset_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_provider_request_id text,
  p_provider_asset_id text,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_moderation_status text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.creative_asset_jobs%rowtype;
  v_profile public.brand_profiles%rowtype;
  v_asset_id uuid;
begin
  select * into v_job
  from public.creative_asset_jobs
  where id = p_job_id
    and status = 'CLAIMED'
    and lease_token = p_lease_token
    and lease_expires_at > now()
    and dispatch_state = 'DISPATCHED'
  for update;

  if v_job.id is null then
    raise exception 'Creative asset job lease is invalid or expired';
  end if;

  select * into v_profile
  from public.brand_profiles
  where id = v_job.brand_profile_id
    and status = 'ACTIVE';

  if v_profile.id is null then
    raise exception 'Brand profile is no longer active';
  end if;

  if nullif(btrim(p_provider_asset_id), '') is null
    or char_length(btrim(p_provider_asset_id)) > 255
    or (
      nullif(btrim(coalesce(p_provider_request_id, '')), '') is not null
      and char_length(btrim(p_provider_request_id)) > 255
    )
    or btrim(p_storage_bucket) !~ '^[a-z0-9][a-z0-9_-]{1,62}$'
    or btrim(p_storage_path) !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{2}/[0-9a-f]{64}\.(png|jpg)$'
    or (
      nullif(btrim(coalesce(p_original_filename, '')), '') is not null
      and char_length(btrim(p_original_filename)) > 160
    )
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_mime_type not in ('image/png', 'image/jpeg')
    or p_byte_size <= 0 or p_byte_size > 10485760
    or p_width < 256 or p_width > 4096
    or p_height < 256 or p_height > 4096
    or p_moderation_status not in ('PENDING', 'APPROVED', 'REJECTED')
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
    or pg_catalog.octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 32768
    or public.meta_jsonb_has_sensitive_key(coalesce(p_metadata, '{}'::jsonb)) then
    raise exception 'Creative asset result is invalid';
  end if;

  insert into public.brand_assets (
    user_id, platform_account_id, source_type, provider_key, provider_model,
    provider_version, provider_asset_id, storage_bucket, storage_path,
    original_filename, sha256, mime_type, byte_size, width, height,
    brand_policy_version, generation_input_hash, moderation_status, status,
    metadata, brand_profile_id, generation_job_id, reviewed_at,
    asset_role
  ) values (
    v_job.user_id, v_job.platform_account_id, 'GENERATED', v_job.provider_key,
    v_job.provider_model, v_job.provider_version, btrim(p_provider_asset_id),
    btrim(p_storage_bucket), btrim(p_storage_path),
    nullif(btrim(coalesce(p_original_filename, '')), ''), p_sha256,
    p_mime_type, p_byte_size, p_width, p_height, v_profile.version,
    v_job.input_hash, p_moderation_status,
    case
      when p_moderation_status = 'REJECTED' then 'REJECTED'
      when p_moderation_status = 'APPROVED'
        and v_profile.generated_asset_approval_mode = 'AUTONOMOUS_POLICY'
        then 'READY'
      else 'PENDING'
    end,
    coalesce(p_metadata, '{}'::jsonb), v_profile.id, v_job.id,
    case
      when p_moderation_status = 'APPROVED'
        and v_profile.generated_asset_approval_mode = 'AUTONOMOUS_POLICY'
        then now()
      else null
    end,
    'GENERATED'
  ) on conflict (platform_account_id, sha256) do update
    set updated_at = now(),
        asset_role = case
          when public.brand_assets.source_type = 'GENERATED'
            then 'GENERATED'
          else public.brand_assets.asset_role
        end
  returning id into v_asset_id;

  update public.creative_asset_jobs
  set status = 'SUCCEEDED',
      provider_request_id = nullif(btrim(coalesce(p_provider_request_id, '')), ''),
      provider_asset_id = btrim(p_provider_asset_id),
      result_asset_id = v_asset_id,
      lease_token = null,
      lease_owner = null,
      lease_acquired_at = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = v_job.id;

  perform public.append_meta_mutation_audit_event(
    v_job.user_id, v_job.platform_account_id, null, null, null, null,
    'PROVIDER', v_job.provider_key, 'CREATIVE_ASSET_JOB_COMPLETED',
    jsonb_build_object('status', 'CLAIMED'), '{}'::jsonb,
    jsonb_build_object(
      'provider_asset_id', btrim(p_provider_asset_id),
      'asset_sha256', p_sha256,
      'moderation_status', p_moderation_status,
      'approval_mode', v_profile.generated_asset_approval_mode,
      'asset_role', 'GENERATED'
    ),
    jsonb_build_object(
      'status', 'SUCCEEDED',
      'asset_id', v_asset_id,
      'asset_ready', p_moderation_status = 'APPROVED'
        and v_profile.generated_asset_approval_mode = 'AUTONOMOUS_POLICY'
    ),
    jsonb_build_object('job_id', v_job.id, 'input_hash', v_job.input_hash),
    v_job.provider_key, v_job.provider_model, v_job.provider_version,
    nullif(btrim(coalesce(p_provider_request_id, '')), ''), null, now()
  );

  return v_asset_id;
end;
$$;

revoke all on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
) from public, anon, authenticated;

revoke all on function public.complete_creative_asset_job(
  uuid, uuid, text, text, text, text, text, text, text, bigint, integer, integer, text, jsonb
) from public, anon, authenticated;

grant execute on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
) to service_role;

grant execute on function public.complete_creative_asset_job(
  uuid, uuid, text, text, text, text, text, text, text, bigint, integer, integer, text, jsonb
) to service_role;

comment on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
) is
  'Enqueue creative asset job. When input.contract_version = adbot-creative-generation-v1, requires creative_generation_input_contract_valid.';

comment on function public.complete_creative_asset_job(
  uuid, uuid, text, text, text, text, text, text, text, bigint, integer, integer, text, jsonb
) is
  'Complete creative asset job and insert brand_assets with asset_role = GENERATED (Phase 2).';

commit;

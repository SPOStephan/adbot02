-- Creative Generation Phase 3: locked_photo enqueue ownership gate.
-- Validates locked_photo_asset_ids resolve to CUSTOMER LOCKED_PHOTO READY/APPROVED rows.
-- Does not change organic boost / launch materialize paths.

begin;

create or replace function public.creative_generation_locked_photos_owned(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_locked_photo_asset_ids jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  if jsonb_typeof(p_locked_photo_asset_ids) is distinct from 'array' then
    return false;
  end if;

  if jsonb_array_length(p_locked_photo_asset_ids) < 1
    or jsonb_array_length(p_locked_photo_asset_ids) > 1 then
    -- Phase 3: exactly one locked photo.
    return false;
  end if;

  begin
    select array_agg(distinct (value #>> '{}')::uuid)
      into v_ids
    from jsonb_array_elements(p_locked_photo_asset_ids) as t(value);
  exception
    when others then
      return false;
  end;

  if v_ids is null or cardinality(v_ids) is distinct from 1 then
    return false;
  end if;

  select count(*)::integer into v_count
  from public.brand_assets ba
  where ba.id = any (v_ids)
    and ba.user_id = p_user_id
    and ba.platform_account_id = p_platform_account_id
    and ba.library_scope = 'CUSTOMER'
    and ba.asset_role = 'LOCKED_PHOTO'
    and ba.status = 'READY'
    and ba.moderation_status = 'APPROVED';

  return v_count = cardinality(v_ids);
end;
$$;

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
  v_mode text;
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

  if coalesce(p_input_payload->>'contract_version', '') = 'adbot-creative-generation-v1'
    and not public.creative_generation_input_contract_valid(p_input_payload) then
    raise exception 'Creative generation input contract is invalid';
  end if;

  -- Phase 3: locked_photo ownership + PNG output gate at enqueue.
  if coalesce(p_input_payload->>'contract_version', '') = 'adbot-creative-generation-v1' then
    v_mode := p_input_payload->>'mode';
    if v_mode = 'locked_photo' then
      if coalesce(p_input_payload #>> '{output,mime_type}', '') is distinct from 'image/png' then
        raise exception 'locked_photo compose requires output.mime_type image/png';
      end if;
      if not public.creative_generation_locked_photos_owned(
        p_user_id,
        p_platform_account_id,
        coalesce(p_input_payload->'locked_photo_asset_ids', '[]'::jsonb)
      ) then
        raise exception 'locked_photo assets are missing or not owned LOCKED_PHOTO READY/APPROVED';
      end if;
    end if;
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

revoke all on function public.creative_generation_locked_photos_owned(
  uuid, uuid, jsonb
) from public, anon, authenticated;

revoke all on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
) from public, anon, authenticated;

grant execute on function public.creative_generation_locked_photos_owned(
  uuid, uuid, jsonb
) to service_role;

grant execute on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
) to service_role;

comment on function public.creative_generation_locked_photos_owned(
  uuid, uuid, jsonb
) is
  'Phase 3: true iff locked_photo_asset_ids is exactly one owned CUSTOMER LOCKED_PHOTO READY/APPROVED asset.';

comment on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
) is
  'Enqueue creative asset job. Phase 3: locked_photo requires PNG output and owned LOCKED_PHOTO assets.';

commit;

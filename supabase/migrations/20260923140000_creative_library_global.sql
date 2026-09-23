-- Creative generation is library-global: not a Meta write.
-- Enqueue/claim no longer require launch policy or kill-switch ALLOW.
-- Customer assets may exist before any ad platform is connected.
-- Training runs gain tags + brief. Funnel→Adbot creative handoff is idempotent.

begin;

-- 1) Customer library without a connected platform account.
alter table public.brand_assets
  drop constraint if exists brand_assets_scope_identity_check;

alter table public.brand_assets
  add constraint brand_assets_scope_identity_check
  check (
    (
      library_scope = 'CUSTOMER'
    )
    or (
      library_scope = 'INSPIRATION'
      and platform_account_id is null
      and brand_profile_id is null
      and source_type = 'UPLOADED'
      and source_meta_asset_id is null
      and generation_job_id is null
      and meta_image_hash is null
    )
  );

create unique index if not exists brand_assets_customer_user_unbound_sha256_uidx
  on public.brand_assets (user_id, sha256)
  where library_scope = 'CUSTOMER' and platform_account_id is null;

create or replace function public.register_unbound_customer_library_asset(
  p_user_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_metadata jsonb default '{}'::jsonb,
  p_source_type text default 'UPLOADED',
  p_asset_role text default 'UPLOAD_EDITABLE'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id uuid := gen_random_uuid();
  v_existing uuid;
  v_bucket text := nullif(btrim(coalesce(p_storage_bucket, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_file_name text := btrim(coalesce(p_original_filename, ''));
  v_sha256 text := lower(btrim(coalesce(p_sha256, '')));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_source text := upper(btrim(coalesce(p_source_type, 'UPLOADED')));
  v_role text := upper(btrim(coalesce(p_asset_role, 'UPLOAD_EDITABLE')));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_expected_prefix text := p_user_id::text || '/library/';
begin
  if p_user_id is null then
    raise exception 'Unbound library asset identity is incomplete';
  end if;

  if v_source not in ('UPLOADED', 'GENERATED')
    or v_role not in ('UPLOAD_EDITABLE', 'GENERATED', 'LOCKED_PHOTO', 'STYLE_REFERENCE')
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
  then
    raise exception 'Unbound library asset metadata is invalid';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Unbound library asset metadata is invalid or unsafe';
  end if;

  select asset.id
    into v_existing
  from public.brand_assets asset
  where asset.user_id = p_user_id
    and asset.library_scope = 'CUSTOMER'
    and asset.platform_account_id is null
    and asset.sha256 = v_sha256
    and asset.status is distinct from 'REVOKED'
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.brand_assets (
    id, user_id, platform_account_id, brand_profile_id, source_type,
    library_scope, asset_role, storage_bucket, storage_path, original_filename,
    sha256, mime_type, byte_size, width, height,
    moderation_status, status, metadata, reviewed_at, reviewed_by,
    created_at, updated_at
  ) values (
    v_asset_id, p_user_id, null, null, v_source,
    'CUSTOMER', v_role, v_bucket, v_path, v_file_name, v_sha256,
    v_mime_type, p_byte_size, p_width, p_height,
    'APPROVED', 'READY', v_metadata, now(), p_user_id, now(), now()
  );

  return v_asset_id;
end;
$$;

revoke all on function public.register_unbound_customer_library_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.register_unbound_customer_library_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb, text, text
) to service_role;

comment on function public.register_unbound_customer_library_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb, text, text
) is
  'Store a customer library image before any ad platform is connected. Never a Meta write.';

-- 2) Enqueue: drop launch-policy + kill-switch coupling.
create or replace function public.enqueue_creative_asset_job(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_brand_profile_id uuid,
  p_provider_key text,
  p_provider_model text,
  p_provider_version text,
  p_input_payload jsonb,
  p_max_attempts integer default 3,
  p_credit_reservation_id uuid default null
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
  v_existing_reservation uuid;
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

    if not public.creative_generation_style_references_allowed(
      p_user_id,
      p_platform_account_id,
      coalesce(p_input_payload->'reference_asset_ids', '[]'::jsonb)
    ) then
      raise exception 'style reference_asset_ids are missing or not allowed';
    end if;
  end if;

  if p_credit_reservation_id is not null
    and not exists (
      select 1
      from public.credit_reservations cr
      where cr.id = p_credit_reservation_id
        and cr.user_id = p_user_id
        and cr.status = 'PENDING'
    ) then
    raise exception 'Credit reservation is missing or not pending for user';
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

  -- Generation is not a Meta write: do not read kill-switch or launch policy.

  v_input_hash := public.meta_sha256(p_input_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_platform_account_id::text || ':' || p_brand_profile_id::text || ':'
    || p_provider_key || ':' || p_provider_model || ':'
    || coalesce(p_provider_version, '') || ':' || v_input_hash
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_idempotency_key, 0)
  );

  select caj.id, caj.credit_reservation_id
    into v_job_id, v_existing_reservation
  from public.creative_asset_jobs caj
  where caj.platform_account_id = p_platform_account_id
    and caj.idempotency_key = v_idempotency_key;

  if v_job_id is null then
    v_job_id := gen_random_uuid();
    insert into public.creative_asset_jobs (
      id, user_id, platform_account_id, brand_profile_id, provider_key,
      provider_model, provider_version, idempotency_key, input_payload,
      input_hash, max_attempts, credit_reservation_id
    ) values (
      v_job_id, p_user_id, p_platform_account_id, p_brand_profile_id,
      p_provider_key, btrim(p_provider_model), nullif(btrim(coalesce(p_provider_version, '')), ''),
      v_idempotency_key, p_input_payload, v_input_hash, p_max_attempts,
      p_credit_reservation_id
    );
    v_created := true;
  elsif v_existing_reservation is null
    and p_credit_reservation_id is not null then
    update public.creative_asset_jobs
    set credit_reservation_id = p_credit_reservation_id,
        updated_at = now()
    where id = v_job_id
      and credit_reservation_id is null;
  end if;

  if v_created then
    perform public.append_meta_mutation_audit_event(
      p_user_id, p_platform_account_id, null, null, null, null,
      'SYSTEM', 'creative-asset-planner', 'CREATIVE_ASSET_JOB_QUEUED',
      '{}'::jsonb,
      jsonb_build_object(
        'job_id', v_job_id,
        'input_hash', v_input_hash,
        'idempotency_key', v_idempotency_key,
        'mode', coalesce(p_input_payload->>'mode', ''),
        'model_id', btrim(p_provider_model),
        'provider_key', p_provider_key,
        'reference_asset_ids', coalesce(p_input_payload->'reference_asset_ids', '[]'::jsonb),
        'locked_photo_asset_ids', coalesce(p_input_payload->'locked_photo_asset_ids', '[]'::jsonb),
        'credit_action_key', 'creative.generate_image_master',
        'credit_reservation_id', p_credit_reservation_id
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

comment on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer, uuid
) is
  'Enqueue creative generation. Not a Meta write — no launch policy or kill-switch gate.';

-- 3) Claim: any connected platform account, no launch/kill-switch gate.
create or replace function public.claim_creative_asset_job(
  p_owner_id text,
  p_lease_seconds integer default 180
)
returns table (
  job_id uuid,
  user_id uuid,
  platform_account_id uuid,
  brand_profile_id uuid,
  provider_key text,
  provider_model text,
  provider_version text,
  idempotency_key text,
  input_payload jsonb,
  input_hash text,
  attempt_count integer,
  lease_token uuid,
  credit_reservation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.creative_asset_jobs%rowtype;
  v_expired public.creative_asset_jobs%rowtype;
  v_previous_status text;
  v_token uuid := gen_random_uuid();
begin
  if nullif(btrim(p_owner_id), '') is null then
    raise exception 'Creative asset lease owner is required';
  end if;

  select caj.* into v_expired
  from public.creative_asset_jobs caj
  where caj.status = 'CLAIMED'
    and caj.lease_expires_at <= now()
  order by caj.lease_expires_at, caj.created_at
  for update skip locked
  limit 1;

  if v_expired.id is not null then
    update public.creative_asset_jobs
    set status = case
          when v_expired.dispatch_state = 'DISPATCHED' then 'AMBIGUOUS'
          else 'RETRYABLE'
        end,
        next_attempt_at = case
          when v_expired.dispatch_state = 'NOT_DISPATCHED' then now()
          else next_attempt_at
        end,
        error_class = 'expired_worker_lease',
        safe_error_message = case
          when v_expired.dispatch_state = 'DISPATCHED'
            then 'Providerdispatch wurde begonnen; Remote-Ergebnis muss manuell reconciliert werden.'
          else 'Worker-Lease lief vor dem Providerdispatch ab; sicherer Retry ist erlaubt.'
        end,
        failure_mode = case
          when v_expired.dispatch_state = 'DISPATCHED'
            then 'AMBIGUOUS_TRANSPORT'
          else 'PRE_DISPATCH'
        end,
        lease_token = null,
        lease_owner = null,
        lease_acquired_at = null,
        lease_expires_at = null,
        completed_at = case
          when v_expired.dispatch_state = 'DISPATCHED' then now()
          else null
        end,
        updated_at = now()
    where id = v_expired.id;

    perform public.append_meta_mutation_audit_event(
      v_expired.user_id, v_expired.platform_account_id,
      null, null, null, null, 'SYSTEM', 'creative-asset-reaper',
      'CREATIVE_ASSET_JOB_LEASE_EXPIRED',
      jsonb_build_object(
        'status', 'CLAIMED',
        'dispatch_state', v_expired.dispatch_state
      ),
      '{}'::jsonb, '{}'::jsonb,
      jsonb_build_object(
        'status', case
          when v_expired.dispatch_state = 'DISPATCHED' then 'AMBIGUOUS'
          else 'RETRYABLE'
        end
      ),
      jsonb_build_object(
        'job_id', v_expired.id,
        'credit_reservation_id', v_expired.credit_reservation_id
      ),
      v_expired.provider_key, v_expired.provider_model,
      v_expired.provider_version, v_expired.provider_request_id,
      'expired_worker_lease', now()
    );
  end if;

  select caj.* into v_job
  from public.creative_asset_jobs caj
  join public.brand_profiles bp on bp.id = caj.brand_profile_id
  join public.platform_accounts pa
    on pa.id = caj.platform_account_id
   and pa.user_id = caj.user_id
   and pa.revoked_at is null
  where caj.status in ('PENDING', 'RETRYABLE')
    and caj.next_attempt_at <= now()
    and caj.attempt_count < caj.max_attempts
    and bp.status = 'ACTIVE'
  order by caj.next_attempt_at, caj.created_at
  for update of caj skip locked
  limit 1;

  if v_job.id is null then
    return;
  end if;

  v_previous_status := v_job.status;

  update public.creative_asset_jobs as claimed_job
  set status = 'CLAIMED',
      attempt_count = claimed_job.attempt_count + 1,
      lease_token = v_token,
      lease_owner = btrim(p_owner_id),
      lease_acquired_at = now(),
      lease_expires_at = now() + make_interval(
        secs => greatest(30, least(900, p_lease_seconds))
      ),
      dispatch_state = 'NOT_DISPATCHED',
      dispatched_at = null,
      error_class = null,
      safe_error_message = null,
      failure_mode = null,
      updated_at = now()
  where claimed_job.id = v_job.id
  returning claimed_job.* into v_job;

  perform public.append_meta_mutation_audit_event(
    v_job.user_id, v_job.platform_account_id, null, null, null, null,
    'CRON', btrim(p_owner_id), 'CREATIVE_ASSET_JOB_CLAIMED',
    jsonb_build_object('status', v_previous_status),
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object('status', 'CLAIMED', 'attempt_count', v_job.attempt_count),
    jsonb_build_object(
      'job_id', v_job.id,
      'credit_reservation_id', v_job.credit_reservation_id
    ),
    v_job.provider_key, v_job.provider_model, v_job.provider_version,
    null, null, now()
  );

  return query select
    v_job.id, v_job.user_id, v_job.platform_account_id,
    v_job.brand_profile_id, v_job.provider_key, v_job.provider_model,
    v_job.provider_version, v_job.idempotency_key, v_job.input_payload,
    v_job.input_hash, v_job.attempt_count, v_token,
    v_job.credit_reservation_id;
end;
$$;

comment on function public.claim_creative_asset_job(text, integer) is
  'Claim next creative job. Library-global — no Meta platform, launch policy, or kill-switch gate.';

-- 4) Training tags + brief
alter table public.adbot_training_runs
  add column if not exists tags text[] not null default '{}'::text[];

alter table public.adbot_training_runs
  add column if not exists brief text not null default '';

create index if not exists adbot_training_runs_tags_idx
  on public.adbot_training_runs using gin (tags);

-- 5) Funnel → creative handoff (idempotent per funnel + destination)
create table if not exists public.funnel_creative_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  funnel_id text not null,
  destination_url text not null,
  title text not null default '',
  tags text[] not null default '{}'::text[],
  job_title text not null default '',
  job_description text not null default '',
  status text not null default 'PENDING'
    check (status in ('PENDING', 'QUEUED', 'SUCCEEDED', 'SKIPPED', 'FAILED')),
  job_id uuid,
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funnel_creative_handoffs_url_https check (destination_url like 'https://%'),
  constraint funnel_creative_handoffs_funnel_url_key unique (funnel_id, destination_url)
);

create index if not exists funnel_creative_handoffs_user_idx
  on public.funnel_creative_handoffs (user_id, created_at desc);

alter table public.funnel_creative_handoffs enable row level security;

revoke all on table public.funnel_creative_handoffs from public;
revoke all on table public.funnel_creative_handoffs from anon;
revoke all on table public.funnel_creative_handoffs from authenticated;
grant select, insert, update, delete on table public.funnel_creative_handoffs to service_role;

commit;

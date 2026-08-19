-- Creative Generation Phase 6: credit reservation on creative_asset_jobs.
-- Reserve creative.generate_image_master at enqueue; worker commits/releases.
-- Does not change organic boost / launch materialize.

begin;

alter table public.creative_asset_jobs
  add column if not exists credit_reservation_id uuid
    references public.credit_reservations (id) on delete restrict;

create index if not exists creative_asset_jobs_credit_reservation_idx
  on public.creative_asset_jobs (credit_reservation_id)
  where credit_reservation_id is not null;

comment on column public.creative_asset_jobs.credit_reservation_id is
  'Phase 6: reserved credits (creative.generate_image_master) settled by worker commit/release.';

-- Recreate claim to return credit_reservation_id.
drop function if exists public.claim_creative_asset_job(text, integer);

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
   and pa.platform = 'meta'
   and pa.revoked_at is null
  join public.automation_policies ap
    on ap.platform_account_id = caj.platform_account_id
   and ap.user_id = caj.user_id
   and ap.status = 'ACTIVE'
   and ap.is_current
   and ap.allow_new_launches
  where caj.status in ('PENDING', 'RETRYABLE')
    and caj.next_attempt_at <= now()
    and caj.attempt_count < caj.max_attempts
    and bp.status = 'ACTIVE'
    and exists (
      select 1
      from public.get_effective_meta_kill_switch(
        caj.user_id, caj.platform_account_id, null
      ) ks
      where ks.mode = 'ALLOW'
    )
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

-- Enqueue with optional credit reservation (Phase 5 gates kept).
drop function if exists public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
);

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

revoke all on function public.claim_creative_asset_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer, uuid
) from public, anon, authenticated;

grant execute on function public.claim_creative_asset_job(text, integer)
  to service_role;
grant execute on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer, uuid
) to service_role;

comment on function public.claim_creative_asset_job(text, integer) is
  'Claim next creative asset job; Phase 6 returns credit_reservation_id.';

comment on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer, uuid
) is
  'Enqueue creative asset job with optional Phase 6 credit_reservation_id and audit payload.';

commit;

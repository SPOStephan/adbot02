begin;

-- Runtime-independent creative asset control plane. Provider credentials remain
-- in server-side environment variables; this schema stores only provider/model
-- provenance, canonical request hashes and sanitized operational diagnostics.

create table public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  previous_profile_id uuid references public.brand_profiles(id) on delete restrict,
  version integer not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'ACTIVE', 'RETIRED', 'BLOCKED')),
  display_name text not null,
  brand_name text not null,
  facebook_page_id text,
  instagram_actor_id text,
  guidelines jsonb not null default '{}'::jsonb,
  forbidden_content jsonb not null default '[]'::jsonb,
  generation_defaults jsonb not null default '{}'::jsonb,
  generated_asset_approval_mode text not null default 'AUTONOMOUS_POLICY'
    check (generated_asset_approval_mode in (
      'AUTONOMOUS_POLICY', 'CUSTOMER_REVIEW'
    )),
  profile_hash text not null,
  customer_confirmed_at timestamptz,
  customer_confirmed_by uuid references public.users(id) on delete restrict,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_profiles_account_version_key
    unique (platform_account_id, version),
  constraint brand_profiles_version_check check (version > 0),
  constraint brand_profiles_name_check check (
    char_length(display_name) between 1 and 160
    and char_length(brand_name) between 1 and 160
  ),
  constraint brand_profiles_actor_check check (
    (facebook_page_id is null or facebook_page_id ~ '^[0-9]{1,64}$')
    and (instagram_actor_id is null or instagram_actor_id ~ '^[0-9]{1,64}$')
  ),
  constraint brand_profiles_json_check check (
    jsonb_typeof(guidelines) = 'object'
    and jsonb_typeof(forbidden_content) = 'array'
    and jsonb_typeof(generation_defaults) = 'object'
  ),
  constraint brand_profiles_hash_check
    check (profile_hash ~ '^[0-9a-f]{64}$'),
  constraint brand_profiles_active_gate_check check (
    status <> 'ACTIVE'
    or (
      customer_confirmed_at is not null
      and customer_confirmed_by is not null
      and activated_at is not null
    )
  )
);

create or replace function public.meta_jsonb_has_sensitive_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
  v_normalized_key text;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from pg_catalog.jsonb_each(p_value)
    loop
      v_normalized_key := pg_catalog.regexp_replace(
        pg_catalog.lower(v_key), '[^a-z0-9]', '', 'g'
      );
      if v_normalized_key in (
          'authorization', 'password', 'privatekey', 'apikey'
        )
        or v_normalized_key ~ '(token|secret|password|privatekey)$'
        or public.meta_jsonb_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from pg_catalog.jsonb_array_elements(p_value)
    loop
      if public.meta_jsonb_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

alter table public.brand_profiles
  add constraint brand_profiles_payload_size_check check (
    pg_catalog.octet_length(guidelines::text)
      + pg_catalog.octet_length(forbidden_content::text)
      + pg_catalog.octet_length(generation_defaults::text) <= 65536
  ),
  add constraint brand_profiles_no_sensitive_keys_check check (
    not public.meta_jsonb_has_sensitive_key(guidelines)
    and not public.meta_jsonb_has_sensitive_key(forbidden_content)
    and not public.meta_jsonb_has_sensitive_key(generation_defaults)
  );

create unique index brand_profiles_active_account_key
  on public.brand_profiles (platform_account_id)
  where status = 'ACTIVE';
create index brand_profiles_user_status_idx
  on public.brand_profiles (user_id, status, updated_at desc);
create index brand_profiles_previous_profile_idx
  on public.brand_profiles (previous_profile_id)
  where previous_profile_id is not null;
create index brand_profiles_confirmer_idx
  on public.brand_profiles (customer_confirmed_by)
  where customer_confirmed_by is not null;

create table public.creative_asset_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  brand_profile_id uuid not null references public.brand_profiles(id) on delete restrict,
  provider_key text not null,
  provider_model text not null,
  provider_version text,
  idempotency_key text not null,
  input_payload jsonb not null,
  input_hash text not null,
  status text not null default 'PENDING'
    check (status in (
      'PENDING', 'CLAIMED', 'RETRYABLE', 'SUCCEEDED', 'FAILED',
      'AMBIGUOUS', 'CANCELLED'
    )),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_owner text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  dispatch_state text not null default 'NOT_DISPATCHED'
    check (dispatch_state in ('NOT_DISPATCHED', 'DISPATCHED')),
  dispatched_at timestamptz,
  provider_request_id text,
  provider_asset_id text,
  result_asset_id uuid,
  error_class text,
  safe_error_message text,
  failure_mode text check (
    failure_mode is null
    or failure_mode in (
      'PRE_DISPATCH', 'REMOTE_REJECTED', 'AMBIGUOUS_TRANSPORT',
      'POST_PROCESSING', 'POLICY_REJECTED'
    )
  ),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creative_asset_jobs_account_idempotency_key
    unique (platform_account_id, idempotency_key),
  constraint creative_asset_jobs_provider_key_check
    check (provider_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint creative_asset_jobs_provider_model_check check (
    char_length(provider_model) between 1 and 160
    and (provider_version is null or char_length(provider_version) between 1 and 160)
    and (provider_request_id is null or char_length(provider_request_id) between 1 and 255)
    and (provider_asset_id is null or char_length(provider_asset_id) between 1 and 255)
  ),
  constraint creative_asset_jobs_idempotency_check
    check (idempotency_key ~ '^[0-9a-f]{64}$'),
  constraint creative_asset_jobs_input_object_check check (
    jsonb_typeof(input_payload) = 'object'
    and pg_catalog.octet_length(input_payload::text) <= 65536
  ),
  constraint creative_asset_jobs_input_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint creative_asset_jobs_attempts_check check (
    attempt_count between 0 and max_attempts
    and max_attempts between 1 and 5
  ),
  constraint creative_asset_jobs_safe_error_check check (
    safe_error_message is null
    or char_length(safe_error_message) between 1 and 500
  ),
  constraint creative_asset_jobs_no_secret_keys_check check (
    not public.meta_jsonb_has_sensitive_key(input_payload)
  ),
  constraint creative_asset_jobs_lease_check check (
    (
      status = 'CLAIMED'
      and lease_token is not null
      and nullif(lease_owner, '') is not null
      and lease_acquired_at is not null
      and lease_expires_at is not null
    )
    or (
      status <> 'CLAIMED'
      and lease_token is null
      and lease_owner is null
      and lease_acquired_at is null
      and lease_expires_at is null
    )
  ),
  constraint creative_asset_jobs_dispatch_check check (
    (dispatch_state = 'NOT_DISPATCHED' and dispatched_at is null)
    or (dispatch_state = 'DISPATCHED' and dispatched_at is not null)
  ),
  constraint creative_asset_jobs_terminal_check check (
    (
      status in ('SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'CANCELLED')
      and completed_at is not null
    )
    or (
      status not in ('SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'CANCELLED')
      and completed_at is null
    )
  ),
  constraint creative_asset_jobs_success_check check (
    status <> 'SUCCEEDED'
    or (
      result_asset_id is not null
      and nullif(provider_asset_id, '') is not null
    )
  )
);

create index creative_asset_jobs_claim_idx
  on public.creative_asset_jobs (next_attempt_at, created_at)
  where status in ('PENDING', 'RETRYABLE');
create index creative_asset_jobs_user_status_idx
  on public.creative_asset_jobs (user_id, status, updated_at desc);
create index creative_asset_jobs_profile_idx
  on public.creative_asset_jobs (brand_profile_id, status);
create index creative_asset_jobs_result_asset_idx
  on public.creative_asset_jobs (result_asset_id)
  where result_asset_id is not null;

alter table public.brand_assets
  add column brand_profile_id uuid references public.brand_profiles(id) on delete restrict,
  add column generation_job_id uuid references public.creative_asset_jobs(id) on delete restrict;

alter table public.creative_asset_jobs
  add constraint creative_asset_jobs_result_asset_fkey
  foreign key (result_asset_id) references public.brand_assets(id) on delete restrict;

alter table public.brand_assets
  add constraint brand_assets_generated_profile_check check (
    source_type <> 'GENERATED'
    or (brand_profile_id is not null and generation_job_id is not null)
  ) not valid;

create index brand_assets_profile_status_idx
  on public.brand_assets (brand_profile_id, status, updated_at desc)
  where brand_profile_id is not null;
create index brand_assets_generation_job_idx
  on public.brand_assets (generation_job_id)
  where generation_job_id is not null;

create or replace function public.guard_creative_asset_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = new.platform_account_id
      and pa.user_id = new.user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Creative asset account scope is invalid';
  end if;

  if tg_table_name = 'brand_profiles' then
    if new.previous_profile_id is not null and not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.previous_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Previous brand profile scope is invalid';
    end if;

    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Brand profile confirmer must be the owning customer';
    end if;
  elsif tg_table_name = 'creative_asset_jobs' then
    if not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.brand_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Creative asset job profile scope is invalid';
    end if;

    if new.result_asset_id is not null and not exists (
      select 1 from public.brand_assets ba
      where ba.id = new.result_asset_id
        and ba.user_id = new.user_id
        and ba.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Creative asset job result scope is invalid';
    end if;
  elsif tg_table_name = 'brand_assets' then
    if new.brand_profile_id is not null and not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.brand_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
        and bp.version = new.brand_policy_version
    ) then
      raise exception 'Brand asset profile scope is invalid';
    end if;

    if new.generation_job_id is not null and not exists (
      select 1 from public.creative_asset_jobs caj
      where caj.id = new.generation_job_id
        and caj.user_id = new.user_id
        and caj.platform_account_id = new.platform_account_id
        and caj.brand_profile_id = new.brand_profile_id
    ) then
      raise exception 'Brand asset generation job scope is invalid';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_brand_profiles_creative_tenant_scope
  before insert or update on public.brand_profiles
  for each row execute function public.guard_creative_asset_tenant_scope();
create trigger guard_creative_asset_jobs_tenant_scope
  before insert or update on public.creative_asset_jobs
  for each row execute function public.guard_creative_asset_tenant_scope();
create trigger guard_brand_assets_creative_tenant_scope
  before insert or update on public.brand_assets
  for each row execute function public.guard_creative_asset_tenant_scope();

create or replace function public.guard_brand_profile_intent_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.previous_profile_id is distinct from old.previous_profile_id
    or new.version is distinct from old.version
    or new.display_name is distinct from old.display_name
    or new.brand_name is distinct from old.brand_name
    or new.facebook_page_id is distinct from old.facebook_page_id
    or new.instagram_actor_id is distinct from old.instagram_actor_id
    or new.guidelines is distinct from old.guidelines
    or new.forbidden_content is distinct from old.forbidden_content
    or new.generation_defaults is distinct from old.generation_defaults
    or new.generated_asset_approval_mode is distinct from old.generated_asset_approval_mode
    or new.profile_hash is distinct from old.profile_hash
    or new.customer_confirmed_at is distinct from old.customer_confirmed_at
    or new.customer_confirmed_by is distinct from old.customer_confirmed_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Brand profile intent is immutable';
  end if;

  return new;
end;
$$;

create trigger guard_brand_profile_intent_update
  before update on public.brand_profiles
  for each row execute function public.guard_brand_profile_intent_update();

create or replace function public.guard_creative_asset_job_intent_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.brand_profile_id is distinct from old.brand_profile_id
    or new.provider_key is distinct from old.provider_key
    or new.provider_model is distinct from old.provider_model
    or new.provider_version is distinct from old.provider_version
    or new.idempotency_key is distinct from old.idempotency_key
    or new.input_payload is distinct from old.input_payload
    or new.input_hash is distinct from old.input_hash
    or new.max_attempts is distinct from old.max_attempts
    or new.created_at is distinct from old.created_at then
    raise exception 'Creative asset job intent is immutable';
  end if;

  return new;
end;
$$;

create trigger guard_creative_asset_job_intent_update
  before update on public.creative_asset_jobs
  for each row execute function public.guard_creative_asset_job_intent_update();

create or replace function public.put_brand_profile_version(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_display_name text,
  p_brand_name text,
  p_facebook_page_id text default null,
  p_instagram_actor_id text default null,
  p_guidelines jsonb default '{}'::jsonb,
  p_forbidden_content jsonb default '[]'::jsonb,
  p_generation_defaults jsonb default '{}'::jsonb,
  p_activate boolean default false,
  p_generated_asset_approval_mode text default 'AUTONOMOUS_POLICY'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := gen_random_uuid();
  v_previous_profile_id uuid;
  v_version integer;
  v_payload jsonb;
  v_profile_hash text;
begin
  if nullif(btrim(p_display_name), '') is null
    or nullif(btrim(p_brand_name), '') is null
    or jsonb_typeof(coalesce(p_guidelines, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_forbidden_content, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_generation_defaults, '{}'::jsonb)) <> 'object'
    or p_generated_asset_approval_mode not in (
      'AUTONOMOUS_POLICY', 'CUSTOMER_REVIEW'
    ) then
    raise exception 'Brand profile payload is invalid';
  end if;

  if not exists (
    select 1 from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Brand profile account scope is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('brand-profile:' || p_platform_account_id::text, 0)
  );

  select bp.id into v_previous_profile_id
  from public.brand_profiles bp
  where bp.platform_account_id = p_platform_account_id
    and bp.status = 'ACTIVE'
  limit 1;

  select coalesce(max(bp.version), 0) + 1 into v_version
  from public.brand_profiles bp
  where bp.platform_account_id = p_platform_account_id;

  v_payload := jsonb_build_object(
    'display_name', btrim(p_display_name),
    'brand_name', btrim(p_brand_name),
    'facebook_page_id', nullif(btrim(coalesce(p_facebook_page_id, '')), ''),
    'instagram_actor_id', nullif(btrim(coalesce(p_instagram_actor_id, '')), ''),
    'guidelines', coalesce(p_guidelines, '{}'::jsonb),
    'forbidden_content', coalesce(p_forbidden_content, '[]'::jsonb),
    'generation_defaults', coalesce(p_generation_defaults, '{}'::jsonb),
    'generated_asset_approval_mode', p_generated_asset_approval_mode
  );
  if pg_catalog.octet_length(v_payload::text) > 65536
    or public.meta_jsonb_has_sensitive_key(v_payload) then
    raise exception 'Sensitive or oversized brand profile rejected';
  end if;
  v_profile_hash := public.meta_sha256(v_payload::text);

  if p_activate and v_previous_profile_id is not null then
    update public.brand_profiles
    set status = 'RETIRED', retired_at = now(), updated_at = now()
    where id = v_previous_profile_id;
  end if;

  insert into public.brand_profiles (
    id, user_id, platform_account_id, previous_profile_id, version, status,
    display_name, brand_name, facebook_page_id, instagram_actor_id,
    guidelines, forbidden_content, generation_defaults,
    generated_asset_approval_mode, profile_hash,
    customer_confirmed_at, customer_confirmed_by, activated_at
  ) values (
    v_profile_id, p_user_id, p_platform_account_id, v_previous_profile_id,
    v_version, case when p_activate then 'ACTIVE' else 'DRAFT' end,
    btrim(p_display_name), btrim(p_brand_name),
    nullif(btrim(coalesce(p_facebook_page_id, '')), ''),
    nullif(btrim(coalesce(p_instagram_actor_id, '')), ''),
    coalesce(p_guidelines, '{}'::jsonb),
    coalesce(p_forbidden_content, '[]'::jsonb),
    coalesce(p_generation_defaults, '{}'::jsonb),
    p_generated_asset_approval_mode, v_profile_hash,
    case when p_activate then now() else null end,
    case when p_activate then p_user_id else null end,
    case when p_activate then now() else null end
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text,
    case when p_activate then 'BRAND_PROFILE_ACTIVATED' else 'BRAND_PROFILE_DRAFTED' end,
    '{}'::jsonb,
    jsonb_build_object('profile_hash', v_profile_hash),
    '{}'::jsonb,
    jsonb_build_object('profile_id', v_profile_id, 'version', v_version),
    '{}'::jsonb, null, null, null, null, null, now()
  );

  return v_profile_id;
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

create or replace function public.claim_creative_asset_job(
  p_owner_id text,
  p_lease_seconds integer default 300
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
  lease_token uuid
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
      jsonb_build_object('job_id', v_expired.id),
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
    jsonb_build_object('job_id', v_job.id),
    v_job.provider_key, v_job.provider_model, v_job.provider_version,
    null, null, now()
  );

  return query select
    v_job.id, v_job.user_id, v_job.platform_account_id,
    v_job.brand_profile_id, v_job.provider_key, v_job.provider_model,
    v_job.provider_version, v_job.idempotency_key, v_job.input_payload,
    v_job.input_hash, v_job.attempt_count, v_token;
end;
$$;

create or replace function public.mark_creative_asset_job_dispatched(
  p_job_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.creative_asset_jobs%rowtype;
begin
  select * into v_job
  from public.creative_asset_jobs
  where id = p_job_id
    and status = 'CLAIMED'
    and lease_token = p_lease_token
    and lease_expires_at > now()
    and dispatch_state = 'NOT_DISPATCHED'
  for update;

  if v_job.id is null then
    raise exception 'Creative asset job cannot enter provider dispatch';
  end if;

  update public.creative_asset_jobs
  set dispatch_state = 'DISPATCHED', dispatched_at = now(), updated_at = now()
  where id = v_job.id;

  perform public.append_meta_mutation_audit_event(
    v_job.user_id, v_job.platform_account_id, null, null, null, null,
    'EXECUTOR', coalesce(v_job.lease_owner, 'creative-asset-worker'),
    'CREATIVE_ASSET_PROVIDER_DISPATCHING',
    jsonb_build_object('dispatch_state', 'NOT_DISPATCHED'),
    jsonb_build_object('job_id', v_job.id, 'idempotency_key', v_job.idempotency_key),
    '{}'::jsonb, jsonb_build_object('dispatch_state', 'DISPATCHED'),
    jsonb_build_object('input_hash', v_job.input_hash),
    v_job.provider_key, v_job.provider_model, v_job.provider_version,
    null, null, now()
  );

  return true;
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
    metadata, brand_profile_id, generation_job_id, reviewed_at
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
    end
  ) on conflict (platform_account_id, sha256) do update
    set updated_at = now()
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
      'approval_mode', v_profile.generated_asset_approval_mode
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

create or replace function public.fail_creative_asset_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_failure_mode text,
  p_error_class text,
  p_safe_error_message text,
  p_safe_to_retry boolean default false,
  p_backoff_seconds integer default 300,
  p_provider_request_id text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.creative_asset_jobs%rowtype;
  v_next_status text;
  v_completed_at timestamptz;
begin
  select * into v_job
  from public.creative_asset_jobs
  where id = p_job_id
    and status = 'CLAIMED'
    and lease_token = p_lease_token
    and lease_expires_at > now()
  for update;

  if v_job.id is null then
    raise exception 'Creative asset job lease is invalid';
  end if;

  if p_failure_mode not in (
      'PRE_DISPATCH', 'REMOTE_REJECTED', 'AMBIGUOUS_TRANSPORT',
      'POST_PROCESSING', 'POLICY_REJECTED'
    )
    or (v_job.dispatch_state = 'NOT_DISPATCHED' and p_failure_mode <> 'PRE_DISPATCH')
    or (v_job.dispatch_state = 'DISPATCHED' and p_failure_mode = 'PRE_DISPATCH')
    or p_error_class !~ '^[a-z][a-z0-9_]{1,99}$'
    or nullif(btrim(p_safe_error_message), '') is null
    or char_length(p_safe_error_message) > 500 then
    raise exception 'Creative asset failure classification is invalid';
  end if;

  if p_failure_mode = 'AMBIGUOUS_TRANSPORT' then
    v_next_status := 'AMBIGUOUS';
    v_completed_at := now();
  elsif p_safe_to_retry
    and v_job.attempt_count < v_job.max_attempts
    and p_failure_mode in (
      'PRE_DISPATCH', 'REMOTE_REJECTED', 'POST_PROCESSING'
    ) then
    v_next_status := 'RETRYABLE';
    v_completed_at := null;
  else
    v_next_status := 'FAILED';
    v_completed_at := now();
  end if;

  update public.creative_asset_jobs
  set status = v_next_status,
      next_attempt_at = case
        when v_next_status = 'RETRYABLE' then now() + make_interval(
          secs => greatest(60, least(21600, p_backoff_seconds))
        )
        else next_attempt_at
      end,
      provider_request_id = nullif(btrim(coalesce(p_provider_request_id, '')), ''),
      error_class = p_error_class,
      safe_error_message = left(btrim(p_safe_error_message), 500),
      failure_mode = p_failure_mode,
      lease_token = null,
      lease_owner = null,
      lease_acquired_at = null,
      lease_expires_at = null,
      completed_at = v_completed_at,
      updated_at = now()
  where id = v_job.id;

  perform public.append_meta_mutation_audit_event(
    v_job.user_id, v_job.platform_account_id, null, null, null, null,
    'PROVIDER', v_job.provider_key, 'CREATIVE_ASSET_JOB_FAILED',
    jsonb_build_object('status', 'CLAIMED'), '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('status', v_next_status),
    jsonb_build_object('job_id', v_job.id, 'failure_mode', p_failure_mode),
    v_job.provider_key, v_job.provider_model, v_job.provider_version,
    nullif(btrim(coalesce(p_provider_request_id, '')), ''), p_error_class, now()
  );

  return v_next_status;
end;
$$;

create or replace function public.approve_brand_asset(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_asset_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.brand_assets%rowtype;
begin
  select * into v_asset
  from public.brand_assets
  where id = p_asset_id
    and user_id = p_user_id
    and platform_account_id = p_platform_account_id
  for update;

  if v_asset.id is null then
    raise exception 'Brand asset scope is invalid';
  end if;

  if v_asset.status in ('REVOKED', 'REJECTED') then
    raise exception 'Rejected or revoked asset cannot be approved';
  end if;

  if v_asset.moderation_status <> 'APPROVED' then
    raise exception 'Provider or policy moderation approval is required';
  end if;

  if v_asset.brand_profile_id is not null and not exists (
    select 1 from public.brand_profiles bp
    where bp.id = v_asset.brand_profile_id and bp.status = 'ACTIVE'
  ) then
    raise exception 'Asset brand profile is no longer active';
  end if;

  update public.brand_assets
  set status = 'READY', reviewed_at = now(), reviewed_by = p_user_id,
      updated_at = now()
  where id = v_asset.id;

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'BRAND_ASSET_APPROVED',
    jsonb_build_object('status', v_asset.status), '{}'::jsonb,
    '{}'::jsonb, jsonb_build_object('status', 'READY'),
    jsonb_build_object('asset_id', v_asset.id, 'sha256', v_asset.sha256),
    v_asset.provider_key, v_asset.provider_model, v_asset.provider_version,
    null, null, now()
  );

  return true;
end;
$$;

create or replace function public.revoke_brand_asset(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_asset_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.brand_assets%rowtype;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Brand asset revocation reason is required';
  end if;

  select * into v_asset
  from public.brand_assets
  where id = p_asset_id
    and user_id = p_user_id
    and platform_account_id = p_platform_account_id
  for update;

  if v_asset.id is null then
    raise exception 'Brand asset scope is invalid';
  end if;

  update public.brand_assets
  set status = 'REVOKED', updated_at = now(),
      metadata = metadata || jsonb_build_object(
        'revocation_reason', left(btrim(p_reason), 500),
        'revoked_at', now()
      )
  where id = v_asset.id;

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'BRAND_ASSET_REVOKED',
    jsonb_build_object('status', v_asset.status), '{}'::jsonb,
    '{}'::jsonb, jsonb_build_object('status', 'REVOKED'),
    jsonb_build_object('asset_id', v_asset.id, 'reason', left(btrim(p_reason), 500)),
    v_asset.provider_key, v_asset.provider_model, v_asset.provider_version,
    null, null, now()
  );

  return true;
end;
$$;

alter table public.brand_profiles enable row level security;
alter table public.creative_asset_jobs enable row level security;

revoke all on table public.brand_profiles from public, anon, authenticated;
revoke all on table public.creative_asset_jobs from public, anon, authenticated;
revoke all on function public.put_brand_profile_version(
  uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, boolean, text
) from public, anon, authenticated;
revoke all on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
) from public, anon, authenticated;
revoke all on function public.claim_creative_asset_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.mark_creative_asset_job_dispatched(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_creative_asset_job(
  uuid, uuid, text, text, text, text, text, text, text, bigint,
  integer, integer, text, jsonb
) from public, anon, authenticated;
revoke all on function public.fail_creative_asset_job(
  uuid, uuid, text, text, text, boolean, integer, text
) from public, anon, authenticated;
revoke all on function public.approve_brand_asset(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_brand_asset(uuid, uuid, uuid, text)
  from public, anon, authenticated;

revoke all on function public.meta_jsonb_has_sensitive_key(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.guard_creative_asset_tenant_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_brand_profile_intent_update()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_creative_asset_job_intent_update()
  from public, anon, authenticated, service_role;

grant select on table public.brand_profiles to service_role;
grant select on table public.creative_asset_jobs to service_role;
grant select on table public.brand_profiles to authenticated;
grant select (
  id, user_id, platform_account_id, brand_profile_id, provider_key,
  provider_model, provider_version, idempotency_key, input_hash, status,
  attempt_count, max_attempts, next_attempt_at, dispatch_state,
  dispatched_at, provider_request_id, provider_asset_id, result_asset_id,
  error_class, safe_error_message,
  failure_mode, completed_at, created_at, updated_at
) on public.creative_asset_jobs to authenticated;
grant select (brand_profile_id, generation_job_id)
  on public.brand_assets to authenticated;

grant execute on function public.put_brand_profile_version(
  uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, boolean, text
) to service_role;
grant execute on function public.enqueue_creative_asset_job(
  uuid, uuid, uuid, text, text, text, jsonb, integer
) to service_role;
grant execute on function public.claim_creative_asset_job(text, integer)
  to service_role;
grant execute on function public.mark_creative_asset_job_dispatched(uuid, uuid)
  to service_role;
grant execute on function public.complete_creative_asset_job(
  uuid, uuid, text, text, text, text, text, text, text, bigint,
  integer, integer, text, jsonb
) to service_role;
grant execute on function public.fail_creative_asset_job(
  uuid, uuid, text, text, text, boolean, integer, text
) to service_role;
grant execute on function public.approve_brand_asset(uuid, uuid, uuid)
  to service_role;
grant execute on function public.revoke_brand_asset(uuid, uuid, uuid, text)
  to service_role;

create policy brand_profiles_select_own on public.brand_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy creative_asset_jobs_select_own on public.creative_asset_jobs
  for select to authenticated using ((select auth.uid()) = user_id);

commit;

-- Atomic active-launch canary.
--
-- Launch plans are prepared while the account is frozen, held outside the
-- executor, and made executable only after an append-only customer approval
-- matches the immutable plan fingerprint and every visible launch fact.

create table public.meta_launch_canary_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  payload_hash text not null,
  objective text not null,
  destination_url text not null,
  budget_owner_type text not null check (budget_owner_type in ('CAMPAIGN', 'AD_SET')),
  daily_budget_minor bigint not null check (daily_budget_minor > 0),
  campaign_name text not null,
  ad_set_name text not null,
  creative_name text not null,
  ad_name text not null,
  target_status text not null check (target_status = 'ACTIVE'),
  reason text not null check (char_length(reason) between 12 and 500),
  approved_by uuid not null references public.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint meta_launch_canary_approvals_plan_key unique (plan_id),
  constraint meta_launch_canary_approvals_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint meta_launch_canary_approvals_actor_check
    check (approved_by = user_id),
  constraint meta_launch_canary_approvals_text_check
    check (
      char_length(objective) between 1 and 100
      and char_length(destination_url) between 9 and 2048
      and char_length(campaign_name) between 1 and 255
      and char_length(ad_set_name) between 1 and 255
      and char_length(creative_name) between 1 and 255
      and char_length(ad_name) between 1 and 255
    )
);

create index meta_launch_canary_approvals_account_time_idx
  on public.meta_launch_canary_approvals (
    platform_account_id, approved_at desc
  );

create trigger guard_meta_launch_canary_approvals_tenant_scope
  before insert or update on public.meta_launch_canary_approvals
  for each row execute function public.guard_meta_control_tenant_scope();

create trigger guard_meta_launch_canary_approvals_append_only
  before update or delete on public.meta_launch_canary_approvals
  for each row execute function public.guard_meta_append_only();

create or replace function public.hold_meta_launch_plan_for_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action_type <> 'LAUNCH_CHAIN' or new.safety_action then
    return new;
  end if;

  new.not_before := 'infinity'::timestamptz;
  new.max_attempts := 1;
  return new;
end;
$$;

create or replace function public.freeze_meta_launch_plan_for_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action_type <> 'LAUNCH_CHAIN' or new.safety_action then
    return new;
  end if;

  perform public.append_meta_kill_switch_state(
    'PLAN',
    new.user_id,
    new.platform_account_id,
    new.id,
    'FREEZE_WRITES',
    'Aktiv-Launch wartet auf exakte Kundenbestätigung',
    'SYSTEM',
    'meta-launch-canary-gate'
  );

  perform public.append_meta_mutation_audit_event(
    new.user_id,
    new.platform_account_id,
    new.policy_id,
    new.id,
    null,
    null,
    'SYSTEM',
    'meta-launch-canary-gate',
    'LAUNCH_CANARY_CONFIRMATION_REQUIRED',
    '{}'::jsonb,
    jsonb_build_object(
      'payload_hash', new.payload_hash,
      'not_before', 'infinity',
      'max_attempts', 1
    ),
    '{}'::jsonb,
    jsonb_build_object('plan_status', new.status),
    jsonb_build_object(
      'objective', new.planned_payload->>'objective',
      'destination_url', new.planned_payload->>'destination_url',
      'daily_budget_minor', new.planned_payload->>'daily_budget_minor',
      'target_status', new.intended_after->>'status'
    ),
    null, null, null, null, null, now()
  );

  return new;
end;
$$;

create trigger hold_meta_launch_plan_for_confirmation
  before insert on public.mutation_plans
  for each row execute function public.hold_meta_launch_plan_for_confirmation();

create trigger freeze_meta_launch_plan_for_confirmation
  after insert on public.mutation_plans
  for each row execute function public.freeze_meta_launch_plan_for_confirmation();

create or replace function public.materialize_meta_launch_chain_plan(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_blueprint_id uuid,
  p_brand_profile_id uuid,
  p_brand_asset_ids uuid[],
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
  v_blueprint public.objective_blueprints%rowtype;
  v_profile public.brand_profiles%rowtype;
  v_domain public.allowed_domains%rowtype;
  v_asset public.brand_assets%rowtype;
  v_kill_mode text;
  v_asset_count integer;
  v_unique_asset_count integer;
  v_destination_url text;
  v_destination_host text;
  v_campaign_payload jsonb;
  v_ad_set_payload jsonb;
  v_creative_payload jsonb;
  v_ad_payload jsonb;
  v_object_story_spec jsonb;
  v_campaign_name text;
  v_ad_set_name text;
  v_creative_name text;
  v_ad_name text;
  v_tracking_suffix text;
  v_canonical_inputs jsonb;
  v_planned_payload jsonb;
  v_payload_hash text;
  v_idempotency_key text;
  v_provisional_scope_key text;
  v_provisional_budget_key text;
  v_plan_id uuid := gen_random_uuid();
  v_existing_plan public.mutation_plans%rowtype;
  v_exposure_minor bigint;
  v_step_validate_campaign uuid := gen_random_uuid();
  v_step_create_campaign uuid := gen_random_uuid();
  v_step_read_campaign_paused uuid := gen_random_uuid();
  v_step_validate_ad_set uuid := gen_random_uuid();
  v_step_create_ad_set uuid := gen_random_uuid();
  v_step_read_ad_set_paused uuid := gen_random_uuid();
  v_step_upload_image uuid := gen_random_uuid();
  v_step_validate_creative uuid := gen_random_uuid();
  v_step_create_creative uuid := gen_random_uuid();
  v_step_read_creative uuid := gen_random_uuid();
  v_step_validate_ad uuid := gen_random_uuid();
  v_step_create_ad uuid := gen_random_uuid();
  v_step_read_ad_shadow uuid := gen_random_uuid();
  v_step_activate_ad_set uuid := gen_random_uuid();
  v_step_read_ad_set_active uuid := gen_random_uuid();
  v_step_activate_campaign uuid := gen_random_uuid();
  v_step_activate_ad uuid := gen_random_uuid();
  v_step_read_campaign_active uuid := gen_random_uuid();
  v_step_read_ad_active uuid := gen_random_uuid();
  v_step_read_ad_set_final uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_previous_step uuid;
  v_request jsonb;
  v_image_reference jsonb;
  v_has_upload boolean := false;
  v_index integer := 0;
  v_meta_objective_allowlist constant text[] := array[
    'APP_INSTALLS', 'BRAND_AWARENESS', 'CONVERSIONS', 'EVENT_RESPONSES',
    'LEAD_GENERATION', 'LINK_CLICKS', 'LOCAL_AWARENESS', 'MESSAGES',
    'OFFER_CLAIMS', 'OUTCOME_APP_PROMOTION', 'OUTCOME_AWARENESS',
    'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES',
    'OUTCOME_TRAFFIC', 'PAGE_LIKES', 'POST_ENGAGEMENT',
    'PRODUCT_CATALOG_SALES', 'REACH', 'STORE_VISITS', 'VIDEO_VIEWS'
  ]::text[];
begin
  if p_planned_at is null
    or p_daily_budget_minor is null
    or p_daily_budget_minor <= 0
    or p_budget_owner_type not in ('CAMPAIGN', 'AD_SET')
    or jsonb_typeof(coalesce(p_launch_inputs, '{}'::jsonb)) <> 'object'
    or pg_catalog.octet_length(coalesce(p_launch_inputs, '{}'::jsonb)::text) > 262144
    or public.meta_jsonb_has_sensitive_key(coalesce(p_launch_inputs, '{}'::jsonb)) then
    raise exception 'Invalid or unsafe Meta launch inputs';
  end if;

  if p_brand_asset_ids is null or pg_catalog.array_length(p_brand_asset_ids, 1) is null then
    raise exception 'At least one brand asset is required';
  end if;

  select count(*), count(distinct launch_asset.asset_id)
    into v_asset_count, v_unique_asset_count
  from pg_catalog.unnest(p_brand_asset_ids) as launch_asset(asset_id);

  if v_asset_count <> 1 or v_unique_asset_count <> 1
    or p_brand_asset_ids[1] is null then
    raise exception 'Launch Chain v1 requires exactly one unique brand asset';
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
  for update;

  if not found
    or v_account.marketing_sync_status <> 'success'
    or v_account.marketing_sync_id is distinct from p_source_marketing_sync_id
    or v_account.marketing_last_success_at is null
    or v_account.marketing_last_success_at < p_planned_at - interval '2 hours'
    or v_account.marketing_currency is distinct from 'EUR'
    or v_account.marketing_timezone_name is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names tz
      where tz.name = v_account.marketing_timezone_name
    ) then
    raise exception 'Current successful EUR Meta snapshot is required';
  end if;

  if not exists (
    select 1
    from public.meta_account_operation_leases lease
    where lease.platform_account_id = p_platform_account_id
      and lease.user_id = p_user_id
      and lease.lease_kind = 'READ_SYNC'
      and lease.lease_token = p_read_lease_token
      and lease.expires_at > now()
  ) then
    raise exception 'Active READ_SYNC lease is required';
  end if;

  select policy.* into v_policy
  from public.automation_policies policy
  where policy.id = p_policy_id
    and policy.platform_account_id = p_platform_account_id
    and policy.user_id = p_user_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.currency = 'EUR'
    and policy.allow_new_launches
    and policy.allow_status_changes
    and policy.account_daily_hard_cap_minor is not null
    and policy.default_campaign_daily_hard_cap_minor is not null
  for update;

  if not found then
    raise exception 'Active launch- and status-enabled Meta policy is required';
  end if;

  select effective.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) effective;

  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    raise exception 'Meta launch preparation requires account FREEZE_WRITES';
  end if;

  select s.* into v_snapshot
  from public.daily_budget_exposure_snapshots s
  where s.id = p_snapshot_id
    and s.user_id = p_user_id
    and s.platform_account_id = p_platform_account_id
    and s.policy_id = p_policy_id
    and s.source_marketing_sync_id = p_source_marketing_sync_id
    and s.status = 'COMPLETE'
    and s.currency = 'EUR'
  for update;

  if not found then
    raise exception 'Complete matching Meta exposure snapshot is required';
  end if;

  select blueprint.* into v_blueprint
  from public.objective_blueprints blueprint
  where blueprint.id = p_blueprint_id
    and blueprint.user_id = p_user_id
    and blueprint.platform_account_id = p_platform_account_id
    and blueprint.status = 'ACTIVE'
    and blueprint.customer_confirmed_at is not null
    and blueprint.activated_at is not null;

  if not found
    or not (v_blueprint.objective = any(v_meta_objective_allowlist))
    or jsonb_typeof(v_blueprint.payload_template->'campaign') <> 'object'
    or jsonb_typeof(v_blueprint.payload_template->'ad_set') <> 'object'
    or jsonb_typeof(v_blueprint.payload_template->'creative') <> 'object'
    or jsonb_typeof(v_blueprint.payload_template->'ad') <> 'object'
    or public.meta_jsonb_has_sensitive_key(v_blueprint.payload_template)
    or pg_catalog.octet_length(v_blueprint.payload_template::text) > 262144 then
    raise exception 'Active confirmed objective blueprint is invalid';
  end if;

  select profile.* into v_profile
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

  select domain_row.* into v_domain
  from public.allowed_domains domain_row
  where domain_row.id = p_allowed_domain_id
    and domain_row.user_id = p_user_id
    and domain_row.platform_account_id = p_platform_account_id
    and domain_row.status = 'VERIFIED'
    and domain_row.verified_at is not null
    and domain_row.customer_confirmed_at is not null
    and domain_row.revoked_at is null;

  if not found then
    raise exception 'Verified customer-confirmed domain is required';
  end if;

  select asset.* into v_asset
  from public.brand_assets asset
  where asset.id = p_brand_asset_ids[1]
    and asset.user_id = p_user_id
    and asset.platform_account_id = p_platform_account_id
    and asset.brand_profile_id = p_brand_profile_id
    and asset.status = 'READY'
    and asset.moderation_status = 'APPROVED'
    and asset.reviewed_at is not null;

  if not found
    or v_asset.mime_type not in ('image/jpeg', 'image/png')
    or v_asset.sha256 !~ '^[0-9a-f]{64}$'
    or (
      v_asset.meta_image_hash is null
      and (
        nullif(v_asset.storage_bucket, '') is null
        or nullif(v_asset.storage_path, '') is null
        or v_asset.byte_size is null
        or v_asset.byte_size <= 0
      )
    )
    or (
      v_asset.meta_image_hash is not null
      and v_asset.meta_image_hash !~ '^[A-Fa-f0-9]{16,128}$'
    ) then
    raise exception 'READY approved image asset is invalid';
  end if;

  v_campaign_payload := v_blueprint.payload_template->'campaign';
  v_ad_set_payload := v_blueprint.payload_template->'ad_set';
  v_creative_payload := v_blueprint.payload_template->'creative';
  v_ad_payload := v_blueprint.payload_template->'ad';

  if not public.meta_launch_payload_keys_allowed('CAMPAIGN', v_campaign_payload)
    or not public.meta_launch_payload_keys_allowed('AD_SET', v_ad_set_payload)
    or not public.meta_launch_payload_keys_allowed('CREATIVE', v_creative_payload)
    or not public.meta_launch_payload_keys_allowed('AD', v_ad_payload) then
    raise exception 'Objective blueprint contains a non-allowlisted Meta field';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(v_blueprint.required_inputs)
      as required_input(required_key)
    where nullif(required_input.required_key, '') is null
      or not (
        coalesce(p_launch_inputs, '{}'::jsonb)
          ? required_input.required_key
      )
  ) then
    raise exception 'Objective blueprint required input is missing';
  end if;

  v_destination_url := coalesce(
    nullif(p_launch_inputs->>'destination_url', ''),
    nullif(v_creative_payload->>'link_url', ''),
    nullif(v_creative_payload->>'object_url', ''),
    nullif(v_creative_payload->>'template_url', ''),
    nullif(v_creative_payload#>>'{object_story_spec,link_data,link}', ''),
    nullif(v_creative_payload#>>'{object_story_spec,video_data,call_to_action,value,link}', '')
  );

  if v_destination_url is not null then
    v_destination_host := lower(
      substring(v_destination_url from '^https://([^/:?#]+)')
    );

    if v_destination_host is null
      or not (
        v_destination_host = v_domain.hostname
        or v_destination_host = v_domain.registrable_domain
        or v_destination_host like '%.' || v_domain.registrable_domain
      ) then
      raise exception 'Launch destination URL is not covered by the verified domain';
    end if;
  elsif v_policy.require_verified_domain then
    raise exception 'Verified HTTPS destination URL is required by policy';
  end if;

  if nullif(v_ad_payload->>'conversion_domain', '') is not null
    and lower(v_ad_payload->>'conversion_domain') not in (
      v_domain.hostname, v_domain.registrable_domain
    ) then
    raise exception 'Blueprint conversion_domain is not customer-confirmed';
  end if;

  if v_campaign_payload ? 'objective'
    and v_campaign_payload->>'objective' <> v_blueprint.objective then
    raise exception 'Blueprint campaign objective conflicts with blueprint identity';
  end if;

  if (v_campaign_payload ? 'daily_budget' or v_campaign_payload ? 'lifetime_budget')
    and p_budget_owner_type <> 'CAMPAIGN' then
    raise exception 'Campaign budget fields conflict with AD_SET budget ownership';
  end if;

  if (v_ad_set_payload ? 'daily_budget' or v_ad_set_payload ? 'lifetime_budget')
    and p_budget_owner_type <> 'AD_SET' then
    raise exception 'Ad Set budget fields conflict with CAMPAIGN budget ownership';
  end if;

  if p_daily_budget_minor > v_policy.default_campaign_daily_hard_cap_minor then
    raise exception 'Launch budget exceeds customer campaign hard cap';
  end if;

  v_campaign_payload := v_campaign_payload
    - 'daily_budget' - 'lifetime_budget' - 'status' - 'objective' - 'name'
    || jsonb_build_object(
      'name', coalesce(
        nullif(p_launch_inputs->>'campaign_name', ''),
        nullif(v_campaign_payload->>'name', ''),
        v_blueprint.name || ' Campaign'
      ),
      'objective', v_blueprint.objective,
      'status', 'PAUSED'
    );

  v_ad_set_payload := v_ad_set_payload
    - 'campaign_id' - 'daily_budget' - 'lifetime_budget' - 'status' - 'name'
    || jsonb_build_object(
      'name', coalesce(
        nullif(p_launch_inputs->>'ad_set_name', ''),
        nullif(v_ad_set_payload->>'name', ''),
        v_blueprint.name || ' Ad Set'
      ),
      'campaign_id', jsonb_build_object('$binding_step_id', v_step_create_campaign),
      'status', 'PAUSED'
    );

  if p_launch_inputs ? 'targeting' then
    if jsonb_typeof(p_launch_inputs->'targeting') <> 'object' then
      raise exception 'Launch targeting override must be an object';
    end if;
    v_ad_set_payload := jsonb_set(
      v_ad_set_payload, '{targeting}', p_launch_inputs->'targeting', true
    );
  end if;

  if p_launch_inputs ? 'promoted_object' then
    if jsonb_typeof(p_launch_inputs->'promoted_object') <> 'object' then
      raise exception 'Launch promoted_object override must be an object';
    end if;
    v_ad_set_payload := jsonb_set(
      v_ad_set_payload, '{promoted_object}', p_launch_inputs->'promoted_object', true
    );
  end if;

  if p_launch_inputs ? 'start_time' then
    v_ad_set_payload := jsonb_set(
      v_ad_set_payload, '{start_time}', p_launch_inputs->'start_time', true
    );
  end if;

  if p_launch_inputs ? 'end_time' then
    v_ad_set_payload := jsonb_set(
      v_ad_set_payload, '{end_time}', p_launch_inputs->'end_time', true
    );
  end if;

  if p_budget_owner_type = 'CAMPAIGN' then
    v_campaign_payload := jsonb_set(
      v_campaign_payload,
      '{daily_budget}',
      pg_catalog.to_jsonb(p_daily_budget_minor::text),
      true
    );
  else
    v_ad_set_payload := jsonb_set(
      v_ad_set_payload,
      '{daily_budget}',
      pg_catalog.to_jsonb(p_daily_budget_minor::text),
      true
    );
  end if;

  v_object_story_spec := coalesce(v_creative_payload->'object_story_spec', '{}'::jsonb);
  if jsonb_typeof(v_object_story_spec) <> 'object' then
    raise exception 'Creative object_story_spec must be an object';
  end if;
  v_object_story_spec := jsonb_set(
    v_object_story_spec,
    '{page_id}',
    pg_catalog.to_jsonb(v_profile.facebook_page_id),
    true
  );
  if v_profile.instagram_actor_id is not null then
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{instagram_actor_id}',
      pg_catalog.to_jsonb(v_profile.instagram_actor_id),
      true
    );
  end if;
  if v_destination_url is not null
    and jsonb_typeof(v_object_story_spec->'link_data') = 'object' then
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,link}',
      pg_catalog.to_jsonb(v_destination_url),
      true
    );
  end if;

  v_creative_payload := v_creative_payload
    - 'image_hash' - 'image_url' - 'name' - 'object_story_spec'
    || jsonb_build_object(
      'name', coalesce(
        nullif(p_launch_inputs->>'creative_name', ''),
        nullif(v_creative_payload->>'name', ''),
        v_blueprint.name || ' Creative'
      ),
      'object_story_spec', v_object_story_spec
    );

  if v_profile.instagram_actor_id is not null then
    v_creative_payload := jsonb_set(
      v_creative_payload,
      '{instagram_user_id}',
      pg_catalog.to_jsonb(v_profile.instagram_actor_id),
      true
    );
  end if;

  if v_asset.meta_image_hash is null then
    v_has_upload := true;
    v_image_reference := jsonb_build_object('$binding_step_id', v_step_upload_image);
  else
    v_image_reference := pg_catalog.to_jsonb(v_asset.meta_image_hash);
  end if;

  if jsonb_typeof(v_creative_payload#>'{object_story_spec,link_data}') = 'object' then
    v_creative_payload := jsonb_set(
      v_creative_payload,
      '{object_story_spec,link_data,image_hash}',
      v_image_reference,
      true
    );
  else
    v_creative_payload := jsonb_set(
      v_creative_payload, '{image_hash}', v_image_reference, true
    );
  end if;

  v_ad_payload := v_ad_payload
    - 'adset_id' - 'creative' - 'status' - 'name' - 'conversion_domain'
    || jsonb_build_object(
      'name', coalesce(
        nullif(p_launch_inputs->>'ad_name', ''),
        nullif(v_ad_payload->>'name', ''),
        v_blueprint.name || ' Ad'
      ),
      'adset_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set),
      'creative', jsonb_build_object(
        'creative_id', jsonb_build_object(
          '$binding_step_id', v_step_create_creative
        )
      ),
      'status', 'PAUSED',
      'conversion_domain', v_domain.registrable_domain
    );

  v_canonical_inputs := jsonb_build_object(
    'contract_version', 2,
    'user_id', p_user_id,
    'platform_account_id', p_platform_account_id,
    'policy_id', p_policy_id,
    'policy_hash', v_policy.policy_hash,
    'snapshot_id', p_snapshot_id,
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'blueprint_id', p_blueprint_id,
    'blueprint_hash', v_blueprint.blueprint_hash,
    'brand_profile_id', p_brand_profile_id,
    'brand_profile_hash', v_profile.profile_hash,
    'brand_asset_ids', pg_catalog.to_jsonb(p_brand_asset_ids),
    'allowed_domain_id', p_allowed_domain_id,
    'hostname', v_domain.hostname,
    'registrable_domain', v_domain.registrable_domain,
    'budget_owner_type', p_budget_owner_type,
    'daily_budget_minor', p_daily_budget_minor,
    'launch_inputs', coalesce(p_launch_inputs, '{}'::jsonb)
  );
  v_idempotency_key := public.meta_sha256(v_canonical_inputs::text);
  v_tracking_suffix := substr(v_idempotency_key, 1, 12);

  v_campaign_name := left(v_campaign_payload->>'name', 240)
    || ' [' || v_tracking_suffix || '-c]';
  v_ad_set_name := left(v_ad_set_payload->>'name', 240)
    || ' [' || v_tracking_suffix || '-s]';
  v_creative_name := left(v_creative_payload->>'name', 240)
    || ' [' || v_tracking_suffix || '-r]';
  v_ad_name := left(v_ad_payload->>'name', 240)
    || ' [' || v_tracking_suffix || '-a]';

  v_campaign_payload := jsonb_set(
    v_campaign_payload, '{name}', pg_catalog.to_jsonb(v_campaign_name), true
  );
  v_ad_set_payload := jsonb_set(
    v_ad_set_payload, '{name}', pg_catalog.to_jsonb(v_ad_set_name), true
  );
  v_creative_payload := jsonb_set(
    v_creative_payload, '{name}', pg_catalog.to_jsonb(v_creative_name), true
  );
  v_ad_payload := jsonb_set(
    v_ad_payload, '{name}', pg_catalog.to_jsonb(v_ad_name), true
  );

  v_provisional_scope_key := 'launch:campaign:' || substr(v_idempotency_key, 1, 48);
  v_provisional_budget_key := case p_budget_owner_type
    when 'CAMPAIGN' then v_provisional_scope_key
    else 'launch:adset:' || substr(v_idempotency_key, 1, 48)
  end;

  v_planned_payload := jsonb_build_object(
    'contract_version', 2,
    'objective', v_blueprint.objective,
    'blueprint_id', p_blueprint_id,
    'blueprint_hash', v_blueprint.blueprint_hash,
    'brand_profile_id', p_brand_profile_id,
    'brand_profile_hash', v_profile.profile_hash,
    'brand_asset_ids', pg_catalog.to_jsonb(p_brand_asset_ids),
    'allowed_domain_id', p_allowed_domain_id,
    'destination_url', v_destination_url,
    'destination_hostname', v_destination_host,
    'conversion_domain', v_domain.registrable_domain,
    'budget_owner_type', p_budget_owner_type,
    'daily_budget_minor', p_daily_budget_minor,
    'provisional_campaign_scope_key', v_provisional_scope_key,
    'provisional_budget_owner_key', v_provisional_budget_key,
    'campaign', v_campaign_payload,
    'ad_set', v_ad_set_payload,
    'creative', v_creative_payload,
    'ad', v_ad_payload
  );
  v_payload_hash := public.meta_sha256(v_planned_payload::text);

  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id,
    source_marketing_sync_id, source_rule_key, source_rule_version,
    action_type, target_type, target_key, campaign_scope_key,
    budget_owner_key, automation_target_id, idempotency_key,
    expected_before, intended_after, planned_payload, payload_hash,
    status, priority, safety_action, not_before, max_attempts,
    created_at, updated_at
  ) values (
    v_plan_id, p_user_id, p_platform_account_id, p_policy_id,
    p_source_marketing_sync_id, 'active-launch-chain', 1,
    'LAUNCH_CHAIN', 'CHAIN',
    'chain:' || substr(v_idempotency_key, 1, 48),
    v_provisional_scope_key, v_provisional_budget_key, null,
    v_idempotency_key,
    jsonb_build_object(
      'remote_objects_absent', true,
      'policy_hash', v_policy.policy_hash,
      'exposure_snapshot_id', p_snapshot_id,
      'source_marketing_sync_id', p_source_marketing_sync_id,
      'kill_switch_mode', v_kill_mode
    ),
    jsonb_build_object(
      'status', 'ACTIVE',
      'objective', v_blueprint.objective,
      'daily_budget_minor', p_daily_budget_minor,
      'budget_owner_type', p_budget_owner_type
    ),
    v_planned_payload, v_payload_hash,
    'PENDING', 60, false, 'infinity'::timestamptz, 1,
    p_planned_at, p_planned_at
  ) on conflict (idempotency_key) do nothing
  returning id into v_plan_id;

  if v_plan_id is null then
    select mp.* into v_existing_plan
    from public.mutation_plans mp
    where mp.idempotency_key = v_idempotency_key;

    if not found
      or v_existing_plan.user_id <> p_user_id
      or v_existing_plan.platform_account_id <> p_platform_account_id
      or v_existing_plan.policy_id <> p_policy_id
      or v_existing_plan.action_type <> 'LAUNCH_CHAIN'
      or v_existing_plan.source_marketing_sync_id
        is distinct from p_source_marketing_sync_id
      or v_existing_plan.planned_payload->>'blueprint_hash'
        is distinct from v_blueprint.blueprint_hash
      or v_existing_plan.planned_payload->>'brand_profile_hash'
        is distinct from v_profile.profile_hash then
      raise exception 'Launch idempotency key conflicts with another plan';
    end if;

    select effective.mode into v_kill_mode
    from public.get_effective_meta_kill_switch(
      p_user_id, p_platform_account_id, v_existing_plan.id
    ) effective;

    if v_existing_plan.status <> 'PENDING'
      or v_existing_plan.attempt_count <> 0
      or v_existing_plan.max_attempts <> 1
      or v_existing_plan.not_before <> 'infinity'::timestamptz
      or coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES'
      or exists (
        select 1
        from public.meta_launch_canary_approvals approval
        where approval.plan_id = v_existing_plan.id
      ) then
      raise exception 'Existing launch plan is no longer held for confirmation';
    end if;

    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'idempotent_replay',
      'plan_id', v_existing_plan.id,
      'idempotency_key', v_idempotency_key,
      'status', 'HELD',
      'payload_hash', v_existing_plan.payload_hash,
      'objective', v_existing_plan.planned_payload->>'objective',
      'destination_url', v_existing_plan.planned_payload->>'destination_url',
      'budget_owner_type', v_existing_plan.planned_payload->>'budget_owner_type',
      'daily_budget_minor', (v_existing_plan.planned_payload->>'daily_budget_minor')::bigint,
      'campaign_name', v_existing_plan.planned_payload#>>'{campaign,name}',
      'ad_set_name', v_existing_plan.planned_payload#>>'{ad_set,name}',
      'creative_name', v_existing_plan.planned_payload#>>'{creative,name}',
      'ad_name', v_existing_plan.planned_payload#>>'{ad,name}',
      'target_status', v_existing_plan.intended_after->>'status'
    );
  end if;

  select reserved.account_reserved_exposure_minor
    into v_exposure_minor
  from public.reserve_meta_daily_budget_exposure(
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    p_snapshot_id,
    v_plan_id,
    null,
    v_snapshot.account_day,
    v_provisional_scope_key,
    v_provisional_budget_key,
    p_budget_owner_type,
    false,
    'EUR',
    p_daily_budget_minor,
    v_policy.standard_flex_spend_multiplier_bps,
    'PLAN'
  ) reserved;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CAMPAIGN',
    'object_type', 'CAMPAIGN',
    'mode', 'validate_only',
    'payload', v_campaign_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_validate_campaign, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-campaign', 'VALIDATE', 'CAMPAIGN', null,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_validate_campaign;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CAMPAIGN',
    'object_type', 'CAMPAIGN',
    'mode', 'execute',
    'payload', v_campaign_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_create_campaign, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-campaign-paused', 'CREATE', 'CAMPAIGN', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'PAUSED'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_create_campaign;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'CAMPAIGN',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_campaign)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_campaign_paused, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-campaign-paused', 'READ', 'CAMPAIGN', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_campaign_paused;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD_SET', 'object_type', 'AD_SET',
    'mode', 'validate_only', 'payload', v_ad_set_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_validate_ad_set, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-ad-set', 'VALIDATE', 'AD_SET', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_validate_ad_set;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD_SET', 'object_type', 'AD_SET',
    'mode', 'execute', 'payload', v_ad_set_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_create_ad_set, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-ad-set-paused', 'CREATE', 'AD_SET', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'PAUSED'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_create_ad_set;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD_SET',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_ad_set_paused, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-set-paused', 'READ', 'AD_SET', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_ad_set_paused;
  v_index := v_index + 1;

  if v_has_upload then
    v_request := jsonb_build_object(
      'operation', 'UPLOAD_IMAGE',
      'object_type', 'IMAGE',
      'brand_asset_id', v_asset.id,
      'asset_sha256', v_asset.sha256
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_upload_image, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'upload-image', 'CREATE', 'IMAGE', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('asset_sha256', v_asset.sha256), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_upload_image;
    v_index := v_index + 1;
  end if;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
    'mode', 'validate_only', 'payload', v_creative_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_validate_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-creative', 'VALIDATE', 'CREATIVE', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_validate_creative;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
    'payload', v_creative_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_create_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-creative', 'CREATE', 'CREATIVE', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('created', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_create_creative;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'CREATIVE',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_creative)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-creative', 'READ', 'CREATIVE', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('created', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_creative;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD', 'object_type', 'AD',
    'mode', 'validate_only', 'payload', v_ad_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_validate_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-ad-paused', 'VALIDATE', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_validate_ad;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD', 'object_type', 'AD',
    'mode', 'execute', 'payload', v_ad_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_create_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-ad-paused', 'CREATE', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'PAUSED'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_create_ad;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_ad_shadow, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-paused', 'READ', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_ad_shadow;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS', 'object_type', 'AD_SET',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set),
    'status', 'ACTIVE', 'mode', 'execute'
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_activate_ad_set, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'activate-ad-set', 'UPDATE', 'AD_SET', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_activate_ad_set;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD_SET',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_ad_set_active, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-set-active', 'READ', 'AD_SET', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_ad_set_active;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS', 'object_type', 'CAMPAIGN',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_campaign),
    'status', 'ACTIVE', 'mode', 'execute'
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_activate_campaign, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'activate-campaign', 'UPDATE', 'CAMPAIGN', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_activate_campaign;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad),
    'status', 'ACTIVE', 'mode', 'execute'
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_activate_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'activate-ad', 'UPDATE', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_activate_ad;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'CAMPAIGN',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_campaign)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_campaign_active, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-campaign-active', 'READ', 'CAMPAIGN', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_campaign_active;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_ad_active, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-active', 'READ', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_ad_active;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD_SET',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_ad_set_final, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-set-active-final', 'READ', 'AD_SET', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_ad_set_final;
  v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'RECONCILE',
    'object_type', 'AD',
    'expected_status', 'ACTIVE',
    'exposure_snapshot_id', p_snapshot_id,
    'budget_owner_type', p_budget_owner_type,
    'daily_budget_minor', p_daily_budget_minor
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'reconcile-launch-chain', 'RECONCILE', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'), 'NONE', 'PENDING'
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    v_plan_id,
    null,
    null,
    'SYSTEM',
    'meta-launch-materializer',
    'MUTATION_PLAN_PREPARED',
    jsonb_build_object(
      'remote_objects_absent', true,
      'source_marketing_sync_id', p_source_marketing_sync_id,
      'exposure_snapshot_id', p_snapshot_id
    ),
    jsonb_build_object(
      'blueprint_id', p_blueprint_id,
      'brand_profile_id', p_brand_profile_id,
      'brand_asset_ids', pg_catalog.to_jsonb(p_brand_asset_ids),
      'allowed_domain_id', p_allowed_domain_id,
      'budget_owner_type', p_budget_owner_type,
      'daily_budget_minor', p_daily_budget_minor
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'plan_status', 'PENDING',
      'intended_status', 'ACTIVE',
      'reserved_exposure_minor', v_exposure_minor
    ),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash,
      'step_count', v_index + 1
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'eligible',
    'plan_id', v_plan_id,
    'idempotency_key', v_idempotency_key,
    'step_count', v_index + 1,
    'reserved_exposure_minor', v_exposure_minor,
    'provisional_campaign_scope_key', v_provisional_scope_key,
    'provisional_budget_owner_key', v_provisional_budget_key,
    'status', 'HELD',
    'payload_hash', v_payload_hash,
    'objective', v_blueprint.objective,
    'destination_url', v_destination_url,
    'budget_owner_type', p_budget_owner_type,
    'daily_budget_minor', p_daily_budget_minor,
    'campaign_name', v_campaign_name,
    'ad_set_name', v_ad_set_name,
    'creative_name', v_creative_name,
    'ad_name', v_ad_name,
    'target_status', 'ACTIVE'
  );
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
      null, null, 'CUSTOMER', p_user_id::text,       'CUSTOMER_LAUNCH_PREPARED',
      jsonb_build_object(
        'kill_switch_gate', 'FREEZE_WRITES',
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
      jsonb_build_object(
        'plan_id', v_plan_id,
        'status', 'HELD',
        'db_status', 'PENDING',
        'not_before', 'infinity',
        'payload_hash', v_result->>'payload_hash'
      ),
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

create or replace function public.approve_meta_launch_canary_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid,
  p_expected_payload_hash text,
  p_expected_objective text,
  p_expected_destination_url text,
  p_expected_budget_owner_type text,
  p_expected_daily_budget_minor bigint,
  p_expected_campaign_name text,
  p_expected_ad_set_name text,
  p_expected_creative_name text,
  p_expected_ad_name text,
  p_expected_target_status text,
  p_reason text
)
returns table (
  approval_id uuid,
  plan_id uuid,
  plan_status text,
  executable_at timestamptz,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_blueprint public.objective_blueprints%rowtype;
  v_profile public.brand_profiles%rowtype;
  v_domain public.allowed_domains%rowtype;
  v_asset public.brand_assets%rowtype;
  v_existing public.meta_launch_canary_approvals%rowtype;
  v_approval_id uuid := gen_random_uuid();
  v_approved_at timestamptz := now();
  v_kill_mode text;
  v_step_count integer;
  v_upload_step_count integer;
  v_account_day date;
  v_destination_host text;
begin
  if p_expected_payload_hash !~ '^[0-9a-f]{64}$'
    or p_expected_budget_owner_type not in ('CAMPAIGN', 'AD_SET')
    or p_expected_daily_budget_minor is null
    or p_expected_daily_budget_minor <= 0
    or p_expected_target_status <> 'ACTIVE'
    or nullif(btrim(p_expected_objective), '') is null
    or char_length(p_expected_objective) > 100
    or p_expected_destination_url !~ '^https://[^/@:?#]+(?:[.][^/@:?#]+)+(?:[/?#]|$)'
    or char_length(p_expected_destination_url) > 2048
    or nullif(btrim(p_expected_campaign_name), '') is null
    or char_length(p_expected_campaign_name) > 255
    or nullif(btrim(p_expected_ad_set_name), '') is null
    or char_length(p_expected_ad_set_name) > 255
    or nullif(btrim(p_expected_creative_name), '') is null
    or char_length(p_expected_creative_name) > 255
    or nullif(btrim(p_expected_ad_name), '') is null
    or char_length(p_expected_ad_name) > 255
    or nullif(btrim(p_reason), '') is null
    or char_length(btrim(p_reason)) not between 12 and 500 then
    raise exception 'Invalid launch canary confirmation';
  end if;

  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = p_plan_id
    and mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.action_type = 'LAUNCH_CHAIN'
    and not mp.safety_action
  for update;

  if not found then
    raise exception 'Launch canary plan is invalid';
  end if;

  select approval.* into v_existing
  from public.meta_launch_canary_approvals approval
  where approval.plan_id = v_plan.id;

  if found then
    if v_existing.payload_hash <> p_expected_payload_hash
      or v_existing.objective <> p_expected_objective
      or v_existing.destination_url <> p_expected_destination_url
      or v_existing.budget_owner_type <> p_expected_budget_owner_type
      or v_existing.daily_budget_minor <> p_expected_daily_budget_minor
      or v_existing.campaign_name <> p_expected_campaign_name
      or v_existing.ad_set_name <> p_expected_ad_set_name
      or v_existing.creative_name <> p_expected_creative_name
      or v_existing.ad_name <> p_expected_ad_name
      or v_existing.target_status <> p_expected_target_status then
      raise exception 'Launch canary confirmation fingerprint mismatch';
    end if;

    return query select
      v_existing.id,
      v_plan.id,
      v_plan.status,
      v_plan.not_before,
      v_existing.approved_at;
    return;
  end if;

  if v_plan.status <> 'PENDING'
    or v_plan.attempt_count <> 0
    or v_plan.not_before <> 'infinity'::timestamptz
    or v_plan.max_attempts <> 1
    or v_plan.automation_target_id is not null
    or v_plan.payload_hash <> p_expected_payload_hash
    or public.meta_sha256(v_plan.planned_payload::text) <> v_plan.payload_hash
    or (v_plan.planned_payload->>'contract_version')::integer <> 2
    or v_plan.planned_payload->>'objective' <> p_expected_objective
    or v_plan.planned_payload->>'destination_url' <> p_expected_destination_url
    or v_plan.planned_payload->>'budget_owner_type' <> p_expected_budget_owner_type
    or (v_plan.planned_payload->>'daily_budget_minor')::bigint
         <> p_expected_daily_budget_minor
    or v_plan.planned_payload#>>'{campaign,name}' <> p_expected_campaign_name
    or v_plan.planned_payload#>>'{ad_set,name}' <> p_expected_ad_set_name
    or v_plan.planned_payload#>>'{creative,name}' <> p_expected_creative_name
    or v_plan.planned_payload#>>'{ad,name}' <> p_expected_ad_name
    or v_plan.planned_payload#>>'{campaign,status}' <> 'PAUSED'
    or v_plan.planned_payload#>>'{ad_set,status}' <> 'PAUSED'
    or v_plan.planned_payload#>>'{ad,status}' <> 'PAUSED'
    or v_plan.intended_after->>'status' <> p_expected_target_status
    or (v_plan.intended_after->>'daily_budget_minor')::bigint
         <> p_expected_daily_budget_minor
    or v_plan.expected_before->>'remote_objects_absent' <> 'true' then
    raise exception 'Launch canary confirmation fingerprint mismatch';
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
    and pa.marketing_currency = 'EUR'
    and pa.marketing_sync_id = v_plan.source_marketing_sync_id
    and pa.marketing_sync_status = 'success'
    and pa.marketing_last_success_at >= v_approved_at - interval '2 hours'
    and pa.marketing_last_success_at <= v_approved_at + interval '1 minute'
    and pa.access_token_encrypted is not null
    and pa.token_iv is not null
    and pa.token_auth_tag is not null
    and (pa.expires_at is null or pa.expires_at > v_approved_at + interval '5 minutes')
    and (pa.data_access_expires_at is null
         or pa.data_access_expires_at > v_approved_at + interval '5 minutes')
    and 'ads_management' = any(pa.meta_scopes)
  for update;

  if not found then
    raise exception 'Fresh write-ready EUR Meta account is required';
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = v_plan.policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
    and ap.currency = 'EUR'
    and ap.allow_new_launches
    and ap.allow_status_changes
    and ap.account_daily_hard_cap_minor is not null
    and ap.default_campaign_daily_hard_cap_minor is not null
    and p_expected_daily_budget_minor
          <= ap.default_campaign_daily_hard_cap_minor
  for share;

  if not found then
    raise exception 'Current launch- and status-enabled policy is required';
  end if;

  if v_plan.expected_before->>'policy_hash' is distinct from v_policy.policy_hash then
    raise exception 'Launch policy fingerprint drifted';
  end if;

  v_account_day := (v_approved_at at time zone v_account.marketing_timezone_name)::date;

  select s.* into v_snapshot
  from public.daily_budget_exposure_snapshots s
  where s.id = (v_plan.expected_before->>'exposure_snapshot_id')::uuid
    and s.user_id = p_user_id
    and s.platform_account_id = p_platform_account_id
    and s.policy_id = v_policy.id
    and s.source_marketing_sync_id = v_plan.source_marketing_sync_id
    and s.account_day = v_account_day
    and s.status = 'COMPLETE'
    and s.currency = 'EUR'
  for share;

  if not found then
    raise exception 'Current complete launch exposure snapshot is required';
  end if;

  if not exists (
    select 1
    from public.daily_budget_exposures exposure
    where exposure.plan_id = v_plan.id
      and exposure.user_id = p_user_id
      and exposure.platform_account_id = p_platform_account_id
      and exposure.policy_id = v_policy.id
      and exposure.snapshot_id = v_snapshot.id
      and exposure.source = 'PLAN'
      and exposure.automation_target_id is null
      and exposure.budget_owner_type = p_expected_budget_owner_type
      and exposure.max_daily_budget_minor = p_expected_daily_budget_minor
  ) then
    raise exception 'Exact launch exposure reservation is required';
  end if;

  select blueprint.* into v_blueprint
  from public.objective_blueprints blueprint
  where blueprint.id = (v_plan.planned_payload->>'blueprint_id')::uuid
    and blueprint.user_id = p_user_id
    and blueprint.platform_account_id = p_platform_account_id
    and blueprint.status = 'ACTIVE'
    and blueprint.customer_confirmed_at is not null
    and blueprint.customer_confirmed_by = p_user_id
    and blueprint.activated_at is not null
    and blueprint.objective = p_expected_objective
    and blueprint.blueprint_hash = v_plan.planned_payload->>'blueprint_hash'
  for share;

  if not found then
    raise exception 'Confirmed launch blueprint drifted';
  end if;

  select profile.* into v_profile
  from public.brand_profiles profile
  where profile.id = (v_plan.planned_payload->>'brand_profile_id')::uuid
    and profile.user_id = p_user_id
    and profile.platform_account_id = p_platform_account_id
    and profile.status = 'ACTIVE'
    and profile.customer_confirmed_at is not null
    and profile.customer_confirmed_by = p_user_id
    and profile.activated_at is not null
    and profile.profile_hash = v_plan.planned_payload->>'brand_profile_hash'
    and nullif(profile.facebook_page_id, '') is not null
  for share;

  if not found then
    raise exception 'Confirmed launch brand profile drifted';
  end if;

  v_destination_host := lower(
    substring(p_expected_destination_url from '^https://([^/:?#]+)')
  );

  select domain_row.* into v_domain
  from public.allowed_domains domain_row
  where domain_row.id = (v_plan.planned_payload->>'allowed_domain_id')::uuid
    and domain_row.user_id = p_user_id
    and domain_row.platform_account_id = p_platform_account_id
    and domain_row.status = 'VERIFIED'
    and domain_row.verified_at is not null
    and domain_row.customer_confirmed_at is not null
    and domain_row.customer_confirmed_by = p_user_id
    and domain_row.revoked_at is null
    and domain_row.hostname = v_destination_host
    and domain_row.hostname = v_plan.planned_payload->>'destination_hostname'
    and domain_row.registrable_domain = v_plan.planned_payload->>'conversion_domain'
  for share;

  if not found then
    raise exception 'Confirmed launch destination drifted';
  end if;

  select asset.* into v_asset
  from public.brand_assets asset
  where asset.id = (v_plan.planned_payload->'brand_asset_ids'->>0)::uuid
    and jsonb_array_length(v_plan.planned_payload->'brand_asset_ids') = 1
    and asset.user_id = p_user_id
    and asset.platform_account_id = p_platform_account_id
    and asset.brand_profile_id = v_profile.id
    and asset.status = 'READY'
    and asset.moderation_status = 'APPROVED'
    and asset.reviewed_at is not null
    and asset.mime_type in ('image/jpeg', 'image/png')
    and asset.sha256 ~ '^[0-9a-f]{64}$'
  for share;

  if not found then
    raise exception 'Approved launch asset drifted';
  end if;

  select count(*)::integer,
         count(*) filter (where step_key = 'upload-image')::integer
    into v_step_count, v_upload_step_count
  from public.mutation_plan_steps step
  where step.plan_id = v_plan.id;

  if v_step_count not in (20, 21)
    or (v_upload_step_count = 1) <> (v_asset.meta_image_hash is null)
    or exists (
      select 1
      from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and (
          step.status <> 'PENDING'
          or step.attempt_count <> 0
          or step.dispatch_state <> 'NOT_DISPATCHED'
          or public.meta_sha256(step.planned_request::text) <> step.request_hash
        )
    )
    or (select step.planned_request#>>'{payload,status}'
        from public.mutation_plan_steps step
        where step.plan_id = v_plan.id and step.step_key = 'create-campaign-paused')
       <> 'PAUSED'
    or (select step.planned_request#>>'{payload,status}'
        from public.mutation_plan_steps step
        where step.plan_id = v_plan.id and step.step_key = 'create-ad-set-paused')
       <> 'PAUSED'
    or (select step.planned_request#>>'{payload,status}'
        from public.mutation_plan_steps step
        where step.plan_id = v_plan.id and step.step_key = 'create-ad-paused')
       <> 'PAUSED'
    or not exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.step_key = 'activate-ad'
        and step.planned_request->>'status' = 'ACTIVE'
    ) then
    raise exception 'Launch step graph is invalid or already dispatched';
  end if;

  if exists (
    select 1
    from public.mutation_plans other
    where other.user_id = p_user_id
      and other.platform_account_id = p_platform_account_id
      and other.id <> v_plan.id
      and not other.safety_action
      and other.status in (
        'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING',
        'COMPENSATION_REQUIRED'
      )
  ) or exists (
    select 1
    from public.meta_account_operation_leases lease
    where lease.user_id = p_user_id
      and lease.platform_account_id = p_platform_account_id
      and lease.expires_at > v_approved_at
  ) then
    raise exception 'Launch canary requires an exclusive idle account';
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    raise exception 'Account must remain frozen until atomic launch approval';
  end if;

  insert into public.meta_launch_canary_approvals (
    id, user_id, platform_account_id, plan_id, payload_hash, objective,
    destination_url, budget_owner_type, daily_budget_minor, campaign_name,
    ad_set_name, creative_name, ad_name, target_status, reason,
    approved_by, approved_at
  ) values (
    v_approval_id, p_user_id, p_platform_account_id, v_plan.id,
    p_expected_payload_hash, p_expected_objective, p_expected_destination_url,
    p_expected_budget_owner_type, p_expected_daily_budget_minor,
    p_expected_campaign_name, p_expected_ad_set_name,
    p_expected_creative_name, p_expected_ad_name, p_expected_target_status,
    btrim(p_reason), p_user_id, v_approved_at
  );

  perform public.append_meta_kill_switch_state(
    'ACCOUNT', p_user_id, p_platform_account_id, null, 'ALLOW',
    'Exakt bestätigter atomarer Aktiv-Launch',
    'CUSTOMER', p_user_id::text
  );

  perform public.append_meta_kill_switch_state(
    'PLAN', p_user_id, p_platform_account_id, v_plan.id, 'ALLOW',
    'Exakter Aktiv-Launch-Fingerprint kundenseitig bestätigt',
    'CUSTOMER', p_user_id::text
  );

  update public.mutation_plans
  set not_before = v_approved_at, updated_at = v_approved_at
  where id = v_plan.id;

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    v_plan.policy_id,
    v_plan.id,
    null,
    null,
    'CUSTOMER',
    p_user_id::text,
    'LAUNCH_CANARY_PLAN_APPROVED',
    jsonb_build_object(
      'not_before', 'infinity',
      'account_kill_switch', 'FREEZE_WRITES',
      'plan_kill_switch', 'FREEZE_WRITES'
    ),
    jsonb_build_object(
      'payload_hash', p_expected_payload_hash,
      'objective', p_expected_objective,
      'destination_url', p_expected_destination_url,
      'budget_owner_type', p_expected_budget_owner_type,
      'daily_budget_minor', p_expected_daily_budget_minor,
      'campaign_name', p_expected_campaign_name,
      'ad_set_name', p_expected_ad_set_name,
      'creative_name', p_expected_creative_name,
      'ad_name', p_expected_ad_name,
      'target_status', p_expected_target_status,
      'reason', btrim(p_reason)
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'not_before', v_approved_at,
      'account_kill_switch', 'ALLOW',
      'plan_kill_switch', 'ALLOW'
    ),
    jsonb_build_object('approval_id', v_approval_id, 'max_attempts', 1),
    null, null, null, null, null, v_approved_at
  );

  return query select
    v_approval_id,
    v_plan.id,
    'PENDING'::text,
    v_approved_at,
    v_approved_at;
end;
$$;

alter table public.meta_launch_canary_approvals enable row level security;

create policy meta_launch_canary_approvals_select_own
  on public.meta_launch_canary_approvals
  for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on table public.meta_launch_canary_approvals to authenticated;

revoke all on function public.hold_meta_launch_plan_for_confirmation()
  from public, anon, authenticated, service_role;
revoke all on function public.freeze_meta_launch_plan_for_confirmation()
  from public, anon, authenticated, service_role;
revoke all on function public.approve_meta_launch_canary_plan(
  uuid, uuid, uuid, text, text, text, text, bigint,
  text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.approve_meta_launch_canary_plan(
  uuid, uuid, uuid, text, text, text, text, bigint,
  text, text, text, text, text, text
) to service_role;

comment on table public.meta_launch_canary_approvals is
  'Append-only customer approvals bound to one immutable active-launch plan and every visible launch fact.';
comment on function public.approve_meta_launch_canary_plan(
  uuid, uuid, uuid, text, text, text, text, bigint,
  text, text, text, text, text, text
) is
  'Atomically verifies a held launch fingerprint, current Meta/account/policy/exposure/brand/domain/step invariants and exclusively opens one active-launch plan.';

create or replace function public.refreeze_meta_launch_plan_after_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_mode text;
  v_plan_mode text;
begin
  if new.action_type <> 'LAUNCH_CHAIN'
    or new.safety_action
    or old.status is not distinct from new.status
    or new.status not in (
      'RECONCILING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STALE',
      'PREFLIGHT_FAILED', 'COMPENSATION_REQUIRED', 'CANCELLED'
    ) then
    return new;
  end if;

  if new.status = 'RECONCILING'
    and exists (
      select 1
      from public.mutation_plan_steps step
      where step.plan_id = new.id
        and step.operation in ('VALIDATE', 'CREATE', 'UPDATE')
        and step.status not in (
          'VALIDATED', 'REMOTE_APPLIED', 'RECONCILED', 'SKIPPED'
        )
    ) then
    return new;
  end if;

  select latest.mode into v_account_mode
  from public.kill_switch_state latest
  where latest.scope_type = 'ACCOUNT'
    and latest.user_id = new.user_id
    and latest.platform_account_id = new.platform_account_id
  order by latest.sequence desc
  limit 1;

  if coalesce(v_account_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    perform public.append_meta_kill_switch_state(
      'ACCOUNT', new.user_id, new.platform_account_id, null,
      'FREEZE_WRITES',
      case when new.status = 'RECONCILING'
        then 'Atomarer Aktiv-Launch hat alle Remote-Writes beendet'
        else 'Atomarer Aktiv-Launch ist terminal beendet'
      end,
      'SYSTEM', 'meta-launch-canary-refreeze'
    );
  end if;

  select latest.mode into v_plan_mode
  from public.kill_switch_state latest
  where latest.scope_type = 'PLAN'
    and latest.user_id = new.user_id
    and latest.platform_account_id = new.platform_account_id
    and latest.plan_id = new.id
  order by latest.sequence desc
  limit 1;

  if coalesce(v_plan_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    perform public.append_meta_kill_switch_state(
      'PLAN', new.user_id, new.platform_account_id, new.id,
      'FREEZE_WRITES',
      'Atomarer Aktiv-Launch ist nicht mehr remote-schreibbar: ' || new.status,
      'SYSTEM', 'meta-launch-canary-refreeze'
    );
  end if;

  perform public.append_meta_mutation_audit_event(
    new.user_id,
    new.platform_account_id,
    new.policy_id,
    new.id,
    null,
    null,
    'SYSTEM',
    'meta-launch-canary-refreeze',
    'LAUNCH_CANARY_WRITES_REFROZEN',
    jsonb_build_object('plan_status', old.status),
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object(
      'plan_status', new.status,
      'account_kill_switch', 'FREEZE_WRITES',
      'plan_kill_switch', 'FREEZE_WRITES'
    ),
    '{}'::jsonb,
    null, null, null, null, new.error_class, now()
  );

  return new;
end;
$$;

create trigger refreeze_meta_launch_plan_after_execution
  after update of status on public.mutation_plans
  for each row execute function public.refreeze_meta_launch_plan_after_execution();

revoke all on function public.refreeze_meta_launch_plan_after_execution()
  from public, anon, authenticated, service_role;

create or replace function public.meta_launch_canary_preflight_ok(
  p_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mutation_plans plan
    join public.platform_accounts account
      on account.id = plan.platform_account_id
     and account.user_id = plan.user_id
     and account.platform = 'meta'
     and account.revoked_at is null
     and account.marketing_currency = 'EUR'
     and account.marketing_sync_id = plan.source_marketing_sync_id
     and account.marketing_sync_status = 'success'
     and account.marketing_last_success_at >= now() - interval '2 hours'
     and account.marketing_last_success_at <= now() + interval '1 minute'
     and 'ads_management' = any(account.meta_scopes)
    join public.automation_policies policy
      on policy.id = plan.policy_id
     and policy.user_id = plan.user_id
     and policy.platform_account_id = plan.platform_account_id
     and policy.is_current
     and policy.status = 'ACTIVE'
     and policy.currency = 'EUR'
     and policy.allow_new_launches
     and policy.allow_status_changes
     and policy.policy_hash = plan.expected_before->>'policy_hash'
    join public.meta_launch_canary_approvals approval
      on approval.plan_id = plan.id
     and approval.user_id = plan.user_id
     and approval.platform_account_id = plan.platform_account_id
     and approval.payload_hash = plan.payload_hash
     and approval.objective = plan.planned_payload->>'objective'
     and approval.destination_url = plan.planned_payload->>'destination_url'
     and approval.budget_owner_type = plan.planned_payload->>'budget_owner_type'
     and approval.daily_budget_minor
           = (plan.planned_payload->>'daily_budget_minor')::bigint
     and approval.campaign_name = plan.planned_payload#>>'{campaign,name}'
     and approval.ad_set_name = plan.planned_payload#>>'{ad_set,name}'
     and approval.creative_name = plan.planned_payload#>>'{creative,name}'
     and approval.ad_name = plan.planned_payload#>>'{ad,name}'
     and approval.target_status = plan.intended_after->>'status'
    join public.daily_budget_exposure_snapshots snapshot
      on snapshot.id = (plan.expected_before->>'exposure_snapshot_id')::uuid
     and snapshot.user_id = plan.user_id
     and snapshot.platform_account_id = plan.platform_account_id
     and snapshot.policy_id = plan.policy_id
     and snapshot.source_marketing_sync_id = plan.source_marketing_sync_id
     and snapshot.status = 'COMPLETE'
     and snapshot.currency = 'EUR'
    where plan.id = p_plan_id
      and plan.action_type = 'LAUNCH_CHAIN'
      and not plan.safety_action
      and plan.max_attempts = 1
      and plan.attempt_count <= 1
      and plan.payload_hash ~ '^[0-9a-f]{64}$'
      and public.meta_sha256(plan.planned_payload::text) = plan.payload_hash
      and (plan.planned_payload->>'contract_version')::integer = 2
      and plan.planned_payload#>>'{campaign,status}' = 'PAUSED'
      and plan.planned_payload#>>'{ad_set,status}' = 'PAUSED'
      and plan.planned_payload#>>'{ad,status}' = 'PAUSED'
      and plan.intended_after->>'status' = 'ACTIVE'
      and exists (
        select 1
        from public.daily_budget_exposures exposure
        where exposure.plan_id = plan.id
          and exposure.user_id = plan.user_id
          and exposure.platform_account_id = plan.platform_account_id
          and exposure.policy_id = plan.policy_id
          and exposure.snapshot_id = snapshot.id
          and exposure.source in ('PLAN', 'RECONCILIATION')
          and exposure.budget_owner_type
                = plan.planned_payload->>'budget_owner_type'
          and exposure.max_daily_budget_minor
                = (plan.planned_payload->>'daily_budget_minor')::bigint
      )
      and not exists (
        select 1
        from public.mutation_plan_steps step
        where step.plan_id = plan.id
          and (
            public.meta_sha256(step.planned_request::text) <> step.request_hash
            or step.dispatch_state = 'REMOTE_UNKNOWN'
            or step.status in ('COMPENSATION_REQUIRED', 'FAILED')
          )
      )
      and (select ks.mode
           from public.get_effective_meta_kill_switch(
             plan.user_id, plan.platform_account_id, plan.id
           ) ks) = 'ALLOW'
  );
$$;

create or replace function public.meta_launch_activation_barrier_ok(
  p_plan_id uuid,
  p_step_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_step public.mutation_plan_steps%rowtype;
  v_remote_types integer;
  v_paused_types integer;
begin
  select step.* into v_step
  from public.mutation_plan_steps step
  where step.id = p_step_id
    and step.plan_id = p_plan_id;

  if not found then
    return false;
  end if;

  if v_step.step_key <> 'activate-ad-set' then
    return true;
  end if;

  select count(distinct binding.object_type)::integer
    into v_remote_types
  from public.remote_object_bindings binding
  where binding.plan_id = p_plan_id
    and binding.object_type in ('CAMPAIGN', 'AD_SET', 'CREATIVE', 'AD')
    and binding.remote_object_id ~ '^[1-9][0-9]{0,39}$';

  with latest_before_barrier as (
    select distinct on (snapshot.object_type)
      snapshot.object_type,
      coalesce(
        snapshot.snapshot_payload->>'status',
        snapshot.snapshot_payload->>'effective_status'
      ) as remote_status
    from public.meta_mutation_remote_snapshots snapshot
    join public.mutation_plan_steps snapshot_step
      on snapshot_step.id = snapshot.step_id
    where snapshot.plan_id = p_plan_id
      and snapshot.object_type in ('CAMPAIGN', 'AD_SET', 'AD')
      and snapshot.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
      and snapshot_step.step_index < v_step.step_index
    order by snapshot.object_type,
             snapshot_step.step_index desc,
             snapshot.observed_at desc,
             snapshot.created_at desc
  )
  select count(*)::integer into v_paused_types
  from latest_before_barrier
  where remote_status = 'PAUSED';

  return v_remote_types = 4
    and v_paused_types = 3
    and not exists (
      select 1
      from public.mutation_plan_steps prior
      where prior.plan_id = p_plan_id
        and prior.step_index < v_step.step_index
        and prior.status not in ('VALIDATED', 'REMOTE_APPLIED', 'RECONCILED', 'SKIPPED')
    )
    and not exists (
      select 1
      from public.mutation_plan_steps prior
      where prior.plan_id = p_plan_id
        and (
          prior.dispatch_state = 'REMOTE_UNKNOWN'
          or prior.status in ('COMPENSATION_REQUIRED', 'FAILED')
        )
    );
end;
$$;

revoke all on function public.meta_launch_canary_preflight_ok(uuid)
  from public, anon, authenticated;
revoke all on function public.meta_launch_activation_barrier_ok(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.meta_launch_canary_preflight_ok(uuid)
  to service_role;
grant execute on function public.meta_launch_activation_barrier_ok(uuid, uuid)
  to service_role;

create or replace function public.claim_next_meta_mutation_execution(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table (
  execution_id uuid,
  plan_id uuid,
  user_id uuid,
  platform_account_id uuid,
  policy_id uuid,
  lease_token uuid,
  action_type text,
  target_type text,
  target_key text,
  planned_payload jsonb,
  expected_before jsonb,
  intended_after jsonb,
  first_step_id uuid,
  first_step_operation text,
  first_step_object_type text,
  first_step_request jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_execution_id uuid;
  v_lease_token uuid;
  v_attempt integer;
  v_kill_mode text;
  v_ad_account_id text;
begin
  if nullif(p_worker_id, '') is null or char_length(p_worker_id) > 255 then
    raise exception 'Invalid Meta executor worker ID';
  end if;

  for v_plan in
    select mp.*
    from public.mutation_plans mp
    where mp.status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING')
      and mp.not_before <= now()
      and mp.attempt_count < mp.max_attempts
      and (
        mp.status in ('PENDING', 'RETRYABLE')
        or mp.lease_expires_at <= now()
      )
    order by mp.safety_action desc, mp.priority asc, mp.created_at asc
    for update skip locked
  loop
    if v_plan.action_type = 'LAUNCH_CHAIN'
      and not public.meta_launch_canary_preflight_ok(v_plan.id) then
      update public.mutation_plans
      set status = 'STALE',
          lease_token = null,
          lease_owner = null,
          lease_expires_at = null,
          error_class = 'PREFLIGHT',
          blocked_reason = 'launch_canary_preflight_drift',
          terminal_at = now(),
          updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    select ap.* into v_policy
    from public.automation_policies ap
    where ap.id = v_plan.policy_id
      and ap.user_id = v_plan.user_id
      and ap.platform_account_id = v_plan.platform_account_id
      and ap.is_current
      and ap.status = 'ACTIVE'
    for share;

    if not found then
      update public.mutation_plans
      set status = 'BLOCKED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'POLICY',
          blocked_reason = 'policy_inactive', terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    if (v_plan.action_type = 'UPDATE_BUDGET' and not v_policy.allow_budget_changes)
      or (v_plan.action_type in ('PAUSE', 'ACTIVATE', 'SAFETY_PAUSE')
          and not v_policy.allow_status_changes)
      or (v_plan.action_type in ('LAUNCH_CHAIN', 'LAUNCH_AD')
          and not v_policy.allow_new_launches) then
      update public.mutation_plans
      set status = 'BLOCKED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'POLICY',
          blocked_reason = 'action_not_allowed', terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    select pa.marketing_meta_ad_account_id into v_ad_account_id
    from public.platform_accounts pa
    where pa.id = v_plan.platform_account_id
      and pa.user_id = v_plan.user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and pa.access_token_encrypted is not null
      and pa.token_iv is not null
      and pa.token_auth_tag is not null
      and (pa.expires_at is null or pa.expires_at > now() + interval '5 minutes')
      and (pa.data_access_expires_at is null
           or pa.data_access_expires_at > now() + interval '5 minutes')
      and 'ads_management' = any(pa.meta_scopes)
      and jsonb_typeof(pa.ad_account_ids) = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(pa.ad_account_ids) allowed(value)
        where regexp_replace(allowed.value, '^act_', '')
              = regexp_replace(pa.marketing_meta_ad_account_id, '^act_', '')
      );

    if not found or v_ad_account_id is null then
      update public.mutation_plans
      set status = 'BLOCKED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'CONNECTOR',
          blocked_reason = 'ads_management_reconnect_required',
          terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    select mode into v_kill_mode
    from public.get_effective_meta_kill_switch(
      v_plan.user_id, v_plan.platform_account_id, v_plan.id
    );

    if v_kill_mode <> 'ALLOW' then
      update public.mutation_plans
      set status = 'BLOCKED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'KILL_SWITCH',
          blocked_reason = 'writes_frozen', terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    if v_plan.automation_target_id is not null then
      select at.* into v_target
      from public.automation_targets at
      where at.id = v_plan.automation_target_id
        and at.user_id = v_plan.user_id
        and at.platform_account_id = v_plan.platform_account_id
        and at.status = 'MANAGED'
      for update;

      if not found
        or v_target.target_type <> v_plan.target_type
        or v_target.target_key <> v_plan.target_key
        or v_target.platform_object_id !~ '^[1-9][0-9]{0,39}$'
        or not public.meta_executor_before_matches(v_plan, v_target) then
        update public.mutation_plans
        set status = 'STALE', lease_token = null, lease_owner = null,
            lease_expires_at = null, error_class = 'PREFLIGHT',
            blocked_reason = 'before_state_drift', terminal_at = now(), updated_at = now()
        where id = v_plan.id;
        continue;
      end if;
    elsif v_plan.action_type not in ('LAUNCH_CHAIN', 'LAUNCH_AD') then
      update public.mutation_plans
      set status = 'PREFLIGHT_FAILED', lease_token = null, lease_owner = null,
          lease_expires_at = null, error_class = 'PREFLIGHT',
          blocked_reason = 'missing_automation_target', terminal_at = now(), updated_at = now()
      where id = v_plan.id;
      continue;
    end if;

    v_lease_token := public.claim_meta_account_operation(
      v_plan.platform_account_id,
      v_plan.user_id,
      'WRITE_EXECUTION',
      p_worker_id,
      greatest(60, least(900, p_lease_seconds))
    );

    if v_lease_token is null then
      continue;
    end if;

    select mps.* into v_step
    from public.mutation_plan_steps mps
    where mps.plan_id = v_plan.id
      and mps.status in ('PENDING', 'RETRYABLE')
      and mps.not_before <= now()
      and (
        mps.depends_on_step_id is null
        or exists (
          select 1 from public.mutation_plan_steps dependency
          where dependency.id = mps.depends_on_step_id
            and dependency.plan_id = v_plan.id
            and dependency.status in ('VALIDATED', 'REMOTE_APPLIED', 'RECONCILED', 'SKIPPED')
        )
      )
    order by mps.step_index
    limit 1
    for update;

    if not found then
      perform public.release_meta_account_operation(
        v_plan.platform_account_id, v_plan.user_id, v_lease_token
      );
      continue;
    end if;

    v_attempt := v_plan.attempt_count + 1;
    v_execution_id := gen_random_uuid();

    update public.mutation_plans
    set status = case
          when v_step.operation = 'RECONCILE' then 'RECONCILING'
          else 'CLAIMED'
        end,
        attempt_count = v_attempt,
        lease_token = v_lease_token,
        lease_owner = p_worker_id,
        lease_expires_at = now() + make_interval(
          secs => greatest(60, least(900, p_lease_seconds))
        ),
        blocked_reason = null,
        error_class = null,
        terminal_at = null,
        updated_at = now()
    where id = v_plan.id;

    insert into public.mutation_executions (
      id, plan_id, user_id, platform_account_id, attempt_number, worker_id,
      lease_token, status, started_at, last_heartbeat_at
    ) values (
      v_execution_id, v_plan.id, v_plan.user_id, v_plan.platform_account_id,
      v_attempt, p_worker_id, v_lease_token, 'CLAIMED', now(), now()
    );

    update public.mutation_plan_steps
    set status = 'CLAIMED', attempt_count = attempt_count + 1,
        started_at = coalesce(started_at, now()), error_class = null,
        error_code = null, updated_at = now()
    where id = v_step.id;

    update public.platform_accounts as pa
    set automation_executor_status = 'running',
        automation_executor_error_code = null,
        automation_executor_last_run_at = now(),
        automation_executor_last_plan_id = v_plan.id,
        updated_at = now()
    where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

    perform public.append_meta_mutation_audit_event(
      v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
      v_plan.id, v_step.id, v_execution_id, 'EXECUTOR', p_worker_id,
      'MUTATION_EXECUTION_CLAIMED',
      jsonb_build_object('plan_status', v_plan.status, 'step_status', v_step.status),
      jsonb_build_object('request_hash', v_step.request_hash),
      '{}'::jsonb,
      jsonb_build_object('plan_status', 'CLAIMED', 'step_status', 'CLAIMED'),
      jsonb_build_object('attempt_number', v_attempt),
      null, null, null, null, null, now()
    );

    return query select
      v_execution_id, v_plan.id, v_plan.user_id, v_plan.platform_account_id,
      v_plan.policy_id, v_lease_token, v_plan.action_type, v_plan.target_type,
      v_plan.target_key, v_plan.planned_payload, v_plan.expected_before,
      v_plan.intended_after, v_step.id, v_step.operation, v_step.object_type,
      v_step.planned_request;
    return;
  end loop;
end;
$$;

create or replace function public.begin_meta_mutation_step_dispatch(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid
)
returns table (
  plan_id uuid,
  operation text,
  object_type text,
  planned_request jsonb,
  request_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_asset public.brand_assets%rowtype;
  v_kill_mode text;
  v_latest_change timestamptz;
  v_baseline_budget bigint;
  v_movement_used bigint;
  v_movement_limit bigint;
  v_before_budget bigint;
  v_after_budget bigint;
begin
  select me.* into v_execution
  from public.mutation_executions me
  where me.id = p_execution_id
    and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING')
  for update;

  if not found then
    raise exception 'Active Meta execution lease is required';
  end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id
    and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
    and mp.status in ('CLAIMED', 'EXECUTING')
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id
    and mps.plan_id = v_plan.id
    and mps.status = 'CLAIMED'
  for update;

  if not found or v_step.operation not in ('VALIDATE', 'CREATE', 'UPDATE', 'COMPENSATE') then
    raise exception 'Claimed remote mutation step is required';
  end if;

  if v_step.dispatch_state <> 'NOT_DISPATCHED' then
    raise exception 'Mutation step was already dispatched';
  end if;

  if public.meta_sha256(v_step.planned_request::text) <> v_step.request_hash then
    raise exception 'Mutation step request hash mismatch';
  end if;

  if v_plan.action_type = 'LAUNCH_CHAIN' then
    if not public.meta_launch_canary_preflight_ok(v_plan.id) then
      raise exception 'Launch canary preflight drifted before remote dispatch';
    end if;

    if not public.meta_launch_activation_barrier_ok(v_plan.id, v_step.id) then
      raise exception 'Launch activation barrier is not satisfied';
    end if;
  end if;

  select ap.* into v_policy from public.automation_policies ap
  where ap.id = v_plan.policy_id and ap.user_id = v_plan.user_id
    and ap.platform_account_id = v_plan.platform_account_id
    and ap.is_current and ap.status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'Active current automation policy is required';
  end if;

  select mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    v_plan.user_id, v_plan.platform_account_id, v_plan.id
  );
  if v_kill_mode <> 'ALLOW' then
    raise exception 'Meta writes are blocked by kill switch';
  end if;

  if v_plan.automation_target_id is not null then
    select at.* into v_target from public.automation_targets at
    where at.id = v_plan.automation_target_id and at.status = 'MANAGED'
    for update;
    if not found or not public.meta_executor_before_matches(v_plan, v_target) then
      raise exception 'Meta target before-state drifted';
    end if;
  end if;

  if v_step.object_type = 'IMAGE' then
    if v_step.operation <> 'CREATE'
      or v_step.planned_request->>'operation' <> 'UPLOAD_IMAGE'
      or coalesce(v_step.planned_request->>'brand_asset_id', '')
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_step.planned_request->>'asset_sha256', '')
           !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid Brand Asset upload request';
    end if;

    select ba.* into v_asset
    from public.brand_assets ba
    where ba.id = (v_step.planned_request->>'brand_asset_id')::uuid
      and ba.user_id = v_plan.user_id
      and ba.platform_account_id = v_plan.platform_account_id
      and ba.status = 'READY'
      and ba.moderation_status = 'APPROVED'
      and ba.sha256 = v_step.planned_request->>'asset_sha256'
      and ba.storage_bucket is not null
      and ba.storage_path is not null
      and ba.mime_type in ('image/png', 'image/jpeg')
      and ba.byte_size between 1 and 31457280
    for share;

    if not found then
      raise exception 'Matching ready Brand Asset upload is required';
    end if;

    if v_asset.meta_image_hash is not null then
      raise exception 'Brand Asset is already uploaded to Meta';
    end if;
  end if;

  if v_plan.action_type = 'UPDATE_BUDGET' and v_step.operation = 'UPDATE' then
    v_before_budget := (v_plan.expected_before->>'daily_budget_minor')::bigint;
    v_after_budget := (v_plan.intended_after->>'daily_budget_minor')::bigint;

    select
      max(bml.executed_at), coalesce(sum(bml.absolute_delta_minor), 0)
    into v_latest_change, v_movement_used
    from public.budget_mutation_ledger bml
    where bml.platform_account_id = v_plan.platform_account_id
      and bml.budget_owner_key = v_plan.budget_owner_key
      and bml.executed_at > now() - interval '24 hours'
      and bml.executed_at <= now();

    if v_target.last_successful_mutation_at is not null
      and (v_latest_change is null
           or v_target.last_successful_mutation_at > v_latest_change) then
      v_latest_change := v_target.last_successful_mutation_at;
    end if;

    if v_latest_change is not null
      and v_latest_change + make_interval(secs => v_policy.cooldown_seconds) > now() then
      raise exception 'Budget mutation cooldown is active';
    end if;

    select bml.before_budget_minor into v_baseline_budget
    from public.budget_mutation_ledger bml
    where bml.platform_account_id = v_plan.platform_account_id
      and bml.budget_owner_key = v_plan.budget_owner_key
      and bml.executed_at > now() - interval '24 hours'
      and bml.executed_at <= now()
    order by bml.executed_at asc, bml.created_at asc
    limit 1;

    v_baseline_budget := coalesce(v_baseline_budget, v_before_budget);
    v_movement_limit :=
      (v_baseline_budget * v_policy.budget_change_limit_bps) / 10000;

    if v_movement_limit <= 0
      or v_movement_used + abs(v_after_budget - v_before_budget) > v_movement_limit then
      raise exception 'Rolling 24-hour budget movement limit exceeded';
    end if;

    select dbe.* into v_exposure
    from public.daily_budget_exposures dbe
    join public.daily_budget_exposure_snapshots s on s.id = dbe.snapshot_id
    where dbe.user_id = v_plan.user_id
      and dbe.platform_account_id = v_plan.platform_account_id
      and dbe.policy_id = v_plan.policy_id
      and dbe.automation_target_id = v_plan.automation_target_id
      and dbe.budget_owner_key = v_plan.budget_owner_key
      and s.id = (v_plan.planned_payload->>'exposure_snapshot_id')::uuid
      and s.user_id = v_plan.user_id
      and s.platform_account_id = v_plan.platform_account_id
      and s.policy_id = v_plan.policy_id
      and s.source_marketing_sync_id = v_plan.source_marketing_sync_id
      and s.status = 'COMPLETE'
    order by dbe.updated_at desc
    limit 1
    for update of dbe;

    if not found then
      raise exception 'Matching budget exposure reservation is required';
    end if;

    select s.* into strict v_snapshot
    from public.daily_budget_exposure_snapshots s
    where s.id = v_exposure.snapshot_id
      and s.user_id = v_plan.user_id
      and s.platform_account_id = v_plan.platform_account_id
      and s.status = 'COMPLETE'
    for share;

    perform public.reserve_meta_daily_budget_exposure(
      v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
      v_snapshot.id, v_plan.id, v_plan.automation_target_id,
      v_snapshot.account_day, v_plan.campaign_scope_key,
      v_plan.budget_owner_key, v_target.budget_owner_type,
      v_exposure.shared_budget_enabled, 'EUR', v_after_budget,
      greatest(
        v_exposure.flex_spend_multiplier_bps,
        case when v_exposure.shared_budget_enabled
          then v_policy.shared_budget_flex_spend_multiplier_bps
          else v_policy.standard_flex_spend_multiplier_bps end
      ),
      'PLAN'
    );
  end if;

  update public.mutation_plan_steps
  set status = 'RUNNING', dispatch_state = 'PRE_DISPATCH',
      dispatch_started_at = now(), updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = 'RUNNING', last_heartbeat_at = now()
  where id = v_execution.id;

  update public.mutation_plans
  set status = 'EXECUTING', updated_at = now()
  where id = v_plan.id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    'MUTATION_STEP_PRE_DISPATCH',
    jsonb_build_object('step_status', 'CLAIMED', 'dispatch_state', 'NOT_DISPATCHED'),
    jsonb_build_object('request_hash', v_step.request_hash), '{}'::jsonb,
    jsonb_build_object('step_status', 'RUNNING', 'dispatch_state', 'PRE_DISPATCH'),
    jsonb_build_object('operation', v_step.operation, 'object_type', v_step.object_type),
    null, null, null, null, null, now()
  );

  return query select v_plan.id, v_step.operation, v_step.object_type,
    v_step.planned_request, v_step.request_hash;
end;
$$;

create or replace function public.fail_meta_mutation_execution(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid,
  p_error_class text,
  p_error_code text,
  p_remote_outcome text,
  p_retry_after_seconds integer default 120
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_retryable boolean;
  v_plan_status text;
  v_step_status text;
  v_execution_status text;
  v_safe_code text;
begin
  if p_remote_outcome not in ('NOT_APPLIED', 'UNKNOWN', 'PERMANENT')
    or p_error_class not in ('TRANSPORT', 'RATE_LIMIT', 'AUTH', 'META', 'PROTOCOL', 'PREFLIGHT', 'RECONCILIATION') then
    raise exception 'Invalid Meta execution failure classification';
  end if;

  v_safe_code := public.meta_executor_safe_error_code(p_error_code);

  select me.* into v_execution from public.mutation_executions me
  where me.id = p_execution_id and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then raise exception 'Active Meta execution is required'; end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id and mp.lease_token = p_lease_token
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.status in ('CLAIMED', 'RUNNING')
  for update;
  if not found then raise exception 'Active Meta mutation step is required'; end if;

  v_retryable := p_remote_outcome = 'NOT_APPLIED'
    and p_error_class in ('TRANSPORT', 'RATE_LIMIT')
    and v_plan.attempt_count < v_plan.max_attempts;

  if p_remote_outcome = 'UNKNOWN'
    and v_plan.action_type = 'LAUNCH_CHAIN' then
    v_plan_status := 'COMPENSATION_REQUIRED';
    v_step_status := 'COMPENSATION_REQUIRED';
    v_execution_status := 'COMPENSATION_REQUIRED';
  elsif p_remote_outcome = 'UNKNOWN' then
    v_plan_status := 'RECONCILING';
    v_step_status := 'REMOTE_APPLIED';
    v_execution_status := 'RECONCILING';
  elsif v_retryable then
    v_plan_status := 'RETRYABLE';
    v_step_status := 'RETRYABLE';
    v_execution_status := 'RETRYABLE';
  elsif v_step.compensation_operation = 'PAUSE'
    and p_remote_outcome <> 'NOT_APPLIED' then
    v_plan_status := 'COMPENSATION_REQUIRED';
    v_step_status := 'COMPENSATION_REQUIRED';
    v_execution_status := 'COMPENSATION_REQUIRED';
  else
    v_plan_status := 'FAILED';
    v_step_status := 'FAILED';
    v_execution_status := 'FAILED';
  end if;

  update public.mutation_plan_steps
  set status = v_step_status,
      dispatch_state = case
        when p_remote_outcome = 'UNKNOWN' then 'REMOTE_UNKNOWN'
        when p_remote_outcome = 'NOT_APPLIED' then 'NOT_DISPATCHED'
        else dispatch_state
      end,
      dispatch_started_at = case
        when p_remote_outcome = 'NOT_APPLIED' then null
        else dispatch_started_at
      end,
      not_before = case when v_retryable
        then now() + make_interval(secs => greatest(30, least(86400, p_retry_after_seconds)))
        else not_before end,
      completed_at = case when v_step_status in ('FAILED', 'COMPENSATION_REQUIRED')
        then now() else completed_at end,
      error_class = p_error_class, error_code = v_safe_code, updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = v_execution_status, finished_at = case
        when v_execution_status in ('RETRYABLE', 'COMPENSATION_REQUIRED', 'FAILED')
          then now() else finished_at end,
      error_class = p_error_class, error_code = v_safe_code
  where id = v_execution.id;

  update public.mutation_plans
  set status = v_plan_status,
      not_before = case when v_retryable
        then now() + make_interval(secs => greatest(30, least(86400, p_retry_after_seconds)))
        else not_before end,
      lease_token = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_token
        else null end,
      lease_owner = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_owner
        else null end,
      lease_expires_at = case
        when p_remote_outcome = 'UNKNOWN'
          and v_plan.action_type <> 'LAUNCH_CHAIN' then lease_expires_at
        else null end,
      terminal_at = case when v_plan_status in ('FAILED', 'COMPENSATION_REQUIRED')
        then now() else terminal_at end,
      error_class = p_error_class, blocked_reason = v_safe_code,
      updated_at = now()
  where id = v_plan.id;

  if p_remote_outcome <> 'UNKNOWN'
    or v_plan.action_type = 'LAUNCH_CHAIN' then
    perform public.release_meta_account_operation(
      v_plan.platform_account_id, v_plan.user_id, p_lease_token
    );
  end if;

  insert into public.automation_alerts (
    user_id, platform_account_id, plan_id, dedup_key, severity, alert_type,
    title, message, details, status, first_seen_at, last_seen_at
  ) values (
    v_plan.user_id, v_plan.platform_account_id, v_plan.id,
    'executor:' || v_plan.id::text || ':' || v_safe_code,
    case when p_remote_outcome = 'UNKNOWN' then 'CRITICAL'
         when v_plan_status = 'FAILED' then 'CRITICAL' else 'WARNING' end,
    case when p_remote_outcome = 'UNKNOWN'
      then 'REMOTE_OUTCOME_AMBIGUOUS' else 'MUTATION_EXECUTION_FAILED' end,
    case when p_remote_outcome = 'UNKNOWN'
      then 'Meta-Ergebnis muss abgeglichen werden'
      else 'Meta-Änderung konnte nicht abgeschlossen werden' end,
    case when p_remote_outcome = 'UNKNOWN'
      then 'Ein Remote-Aufruf wurde gesendet, sein Ergebnis ist jedoch unbekannt. Der Executor wiederholt die Mutation nicht blind.'
      else 'Die geplante Meta-Änderung wurde sicher gestoppt. Weitere Schritte folgen gemäß Retry- und Kompensationsregeln.' end,
    jsonb_build_object('error_class', p_error_class, 'error_code', v_safe_code,
                       'remote_outcome', p_remote_outcome),
    'OPEN', now(), now()
  ) on conflict (platform_account_id, dedup_key) do update set
    severity = excluded.severity, alert_type = excluded.alert_type,
    title = excluded.title, message = excluded.message,
    details = excluded.details, status = 'OPEN', last_seen_at = now(),
    resolved_at = null, acknowledged_at = null, updated_at = now();

  update public.platform_accounts as pa
  set automation_executor_status = case
        when p_remote_outcome = 'UNKNOWN' then 'ambiguous'
        when v_retryable then 'retryable'
        else 'error' end,
      automation_executor_error_code = v_safe_code,
      automation_executor_last_run_at = now(),
      automation_executor_last_plan_id = v_plan.id,
      updated_at = now()
  where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    case when p_remote_outcome = 'UNKNOWN'
      then 'MUTATION_REMOTE_OUTCOME_AMBIGUOUS' else 'MUTATION_EXECUTION_FAILED' end,
    jsonb_build_object('plan_status', v_plan.status, 'step_status', v_step.status,
                       'dispatch_state', v_step.dispatch_state),
    jsonb_build_object('request_hash', v_step.request_hash), '{}'::jsonb,
    jsonb_build_object('plan_status', v_plan_status, 'step_status', v_step_status,
                       'remote_outcome', p_remote_outcome),
    jsonb_build_object('retry_after_seconds', p_retry_after_seconds),
    'meta', null, null, null, p_error_class, now()
  );

  return v_plan_status;
end;
$$;

create or replace function public.reconcile_meta_mutation_plan(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid
)
returns table (
  outcome text,
  plan_id uuid,
  ledger_id uuid,
  snapshot_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_type text;
  v_user_id uuid;
  v_platform_account_id uuid;
  v_plan_id uuid;
  v_result record;
  v_account_mode text;
  v_plan_mode text;
begin
  select mp.action_type, mp.user_id, mp.platform_account_id, mp.id
    into v_action_type, v_user_id, v_platform_account_id, v_plan_id
  from public.mutation_executions me
  join public.mutation_plans mp on mp.id = me.plan_id
  where me.id = p_execution_id
    and me.lease_token = p_lease_token;

  if v_action_type in ('LAUNCH_CHAIN', 'LAUNCH_AD') then
    select result.* into v_result
    from public.reconcile_meta_launch_mutation_plan(
      p_execution_id, p_step_id, p_lease_token
    ) result;

    if v_action_type = 'LAUNCH_CHAIN' then
      select latest.mode into v_account_mode
      from public.kill_switch_state latest
      where latest.scope_type = 'ACCOUNT'
        and latest.user_id = v_user_id
        and latest.platform_account_id = v_platform_account_id
      order by latest.sequence desc
      limit 1;

      if coalesce(v_account_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
        perform public.append_meta_kill_switch_state(
          'ACCOUNT', v_user_id, v_platform_account_id, null,
          'FREEZE_WRITES',
          'Atomarer Aktiv-Launch wurde reconciliert: ' || v_result.outcome,
          'SYSTEM', 'meta-launch-canary-reconciler'
        );
      end if;

      select latest.mode into v_plan_mode
      from public.kill_switch_state latest
      where latest.scope_type = 'PLAN'
        and latest.user_id = v_user_id
        and latest.platform_account_id = v_platform_account_id
        and latest.plan_id = v_plan_id
      order by latest.sequence desc
      limit 1;

      if coalesce(v_plan_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
        perform public.append_meta_kill_switch_state(
          'PLAN', v_user_id, v_platform_account_id, v_plan_id,
          'FREEZE_WRITES',
          'Atomarer Aktiv-Launch wurde reconciliert: ' || v_result.outcome,
          'SYSTEM', 'meta-launch-canary-reconciler'
        );
      end if;
    end if;

    return query select
      v_result.outcome::text,
      v_result.plan_id::uuid,
      v_result.ledger_id::uuid,
      v_result.snapshot_id::uuid;
    return;
  end if;

  return query
  select result.outcome, result.plan_id, result.ledger_id, result.snapshot_id
  from public.reconcile_meta_mutation_plan_base(
    p_execution_id, p_step_id, p_lease_token
  ) result;
end;
$$;

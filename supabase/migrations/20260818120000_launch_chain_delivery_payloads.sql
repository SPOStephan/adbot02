-- Traffic/Lead Aktiv-Launch: complete Meta chain (campaign + ad set + ad + ACTIVE).
-- Missing destination_type / promoted_object.page_id caused Meta to accept the
-- paused campaign then fail later — Ads Manager showed an inactive campaign
-- without an ad. Mirror Beitrag-Push: page promoted_object + WEBSITE for
-- LINK_CLICKS, and bake is_adset_budget_sharing_enabled + bid_strategy into
-- the campaign payload for AD_SET budgets.

create or replace function public.meta_enrich_launch_chain_delivery_payloads(
  p_budget_owner_type text,
  p_facebook_page_id text,
  p_campaign_payload jsonb,
  p_ad_set_payload jsonb
)
returns table (
  campaign_payload jsonb,
  ad_set_payload jsonb
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_campaign jsonb := coalesce(p_campaign_payload, '{}'::jsonb);
  v_ad_set jsonb := coalesce(p_ad_set_payload, '{}'::jsonb);
  v_promoted jsonb;
begin
  if p_budget_owner_type = 'AD_SET' then
    v_campaign := v_campaign
      || jsonb_build_object(
        'is_adset_budget_sharing_enabled', true,
        'bid_strategy', coalesce(
          nullif(v_campaign->>'bid_strategy', ''),
          'LOWEST_COST_WITHOUT_CAP'
        )
      );
  elsif p_budget_owner_type = 'CAMPAIGN' then
    v_campaign := v_campaign
      || jsonb_build_object('is_adset_budget_sharing_enabled', false);
  end if;

  if coalesce(v_ad_set->>'optimization_goal', '') = 'LINK_CLICKS'
    and coalesce(v_ad_set->>'destination_type', '') = '' then
    v_ad_set := jsonb_set(v_ad_set, '{destination_type}', '"WEBSITE"'::jsonb, true);
  end if;

  if nullif(btrim(coalesce(p_facebook_page_id, '')), '') is not null then
    v_promoted := case
      when jsonb_typeof(v_ad_set->'promoted_object') = 'object'
        then v_ad_set->'promoted_object'
      else '{}'::jsonb
    end;
    if coalesce(v_promoted->>'page_id', '') = '' then
      v_promoted := v_promoted || jsonb_build_object('page_id', p_facebook_page_id);
    end if;
    v_ad_set := jsonb_set(v_ad_set, '{promoted_object}', v_promoted, true);
  end if;

  campaign_payload := v_campaign;
  ad_set_payload := v_ad_set;
  return next;
end;
$$;

revoke all on function public.meta_enrich_launch_chain_delivery_payloads(
  text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.meta_enrich_launch_chain_delivery_payloads(
  text, text, jsonb, jsonb
) to service_role;

comment on function public.meta_enrich_launch_chain_delivery_payloads(
  text, text, jsonb, jsonb
) is
  'Ensures Aktiv-Launch campaign/ad-set payloads are Meta-deliverable (budget sharing, WEBSITE destination, page promoted_object).';

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

  select enrich.campaign_payload, enrich.ad_set_payload
    into v_campaign_payload, v_ad_set_payload
  from public.meta_enrich_launch_chain_delivery_payloads(
    p_budget_owner_type,
    v_profile.facebook_page_id,
    v_campaign_payload,
    v_ad_set_payload
  ) enrich;

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

create or replace function public.materialize_meta_launch_chain_plan_v3(
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
  p_lifetime_budget_minor bigint,
  p_start_time timestamptz,
  p_end_time timestamptz,
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
  v_existing_lifetime_exposure_minor bigint;
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
    or p_lifetime_budget_minor is null
    or p_lifetime_budget_minor <= 0
    or p_budget_owner_type <> 'CAMPAIGN'
    or p_start_time is null
    or p_end_time is null
    or p_start_time < p_planned_at - interval '5 minutes'
    or p_end_time <= p_start_time + interval '1 hour'
    or p_end_time > p_start_time + interval '90 days'
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

  v_existing_lifetime_exposure_minor :=
    public.meta_active_lifetime_budget_exposure_minor(
      p_user_id, p_platform_account_id, p_source_marketing_sync_id, p_planned_at
    );

  if v_snapshot.reserved_exposure_minor
       + v_existing_lifetime_exposure_minor
       + p_lifetime_budget_minor
       > v_policy.account_daily_hard_cap_minor then
    raise exception 'Launch lifetime budget exceeds customer account hard cap';
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

  if p_lifetime_budget_minor > v_policy.default_campaign_daily_hard_cap_minor then
    raise exception 'Launch lifetime budget exceeds customer campaign hard cap';
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

  if p_launch_inputs ? 'start_time' or p_launch_inputs ? 'end_time' then
    raise exception 'Lifetime launch times must use the typed contract fields';
  end if;

  v_ad_set_payload := jsonb_set(
    v_ad_set_payload, '{start_time}', pg_catalog.to_jsonb(p_start_time), true
  );
  v_ad_set_payload := jsonb_set(
    v_ad_set_payload, '{end_time}', pg_catalog.to_jsonb(p_end_time), true
  );
  v_campaign_payload := jsonb_set(
    v_campaign_payload,
    '{lifetime_budget}',
    pg_catalog.to_jsonb(p_lifetime_budget_minor::text),
    true
  );

  select enrich.campaign_payload, enrich.ad_set_payload
    into v_campaign_payload, v_ad_set_payload
  from public.meta_enrich_launch_chain_delivery_payloads(
    p_budget_owner_type,
    v_profile.facebook_page_id,
    v_campaign_payload,
    v_ad_set_payload
  ) enrich;

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
    'contract_version', 3,
    'user_id', p_user_id,
    'platform_account_id', p_platform_account_id,
    'policy_id', p_policy_id,
    'policy_hash', v_policy.policy_hash,
    'snapshot_id', p_snapshot_id,
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'existing_lifetime_exposure_minor', v_existing_lifetime_exposure_minor,
    'blueprint_id', p_blueprint_id,
    'blueprint_hash', v_blueprint.blueprint_hash,
    'brand_profile_id', p_brand_profile_id,
    'brand_profile_hash', v_profile.profile_hash,
    'brand_asset_ids', pg_catalog.to_jsonb(p_brand_asset_ids),
    'allowed_domain_id', p_allowed_domain_id,
    'hostname', v_domain.hostname,
    'registrable_domain', v_domain.registrable_domain,
    'budget_owner_type', p_budget_owner_type,
    'budget_type', 'LIFETIME',
    'lifetime_budget_minor', p_lifetime_budget_minor,
    'start_time', p_start_time,
    'end_time', p_end_time,
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
    'contract_version', 3,
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
    'budget_type', 'LIFETIME',
    'lifetime_budget_minor', p_lifetime_budget_minor,
    'start_time', p_start_time,
    'end_time', p_end_time,
    'existing_lifetime_exposure_minor', v_existing_lifetime_exposure_minor,
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
      'existing_lifetime_exposure_minor', v_existing_lifetime_exposure_minor,
      'kill_switch_mode', v_kill_mode
    ),
    jsonb_build_object(
      'status', 'ACTIVE',
      'objective', v_blueprint.objective,
      'budget_type', 'LIFETIME',
      'lifetime_budget_minor', p_lifetime_budget_minor,
      'start_time', p_start_time,
      'end_time', p_end_time,
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
      'budget_type', 'LIFETIME',
      'lifetime_budget_minor', (v_existing_plan.planned_payload->>'lifetime_budget_minor')::bigint,
      'start_time', v_existing_plan.planned_payload->>'start_time',
      'end_time', v_existing_plan.planned_payload->>'end_time',
      'campaign_name', v_existing_plan.planned_payload#>>'{campaign,name}',
      'ad_set_name', v_existing_plan.planned_payload#>>'{ad_set,name}',
      'creative_name', v_existing_plan.planned_payload#>>'{creative,name}',
      'ad_name', v_existing_plan.planned_payload#>>'{ad,name}',
      'target_status', v_existing_plan.intended_after->>'status'
    );
  end if;

  select reserved.account_reserved_exposure_minor
    into v_exposure_minor
  from public.reserve_meta_lifetime_budget_exposure_v3(
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    p_snapshot_id,
    v_plan_id,
    null,
    v_snapshot.account_day,
    v_provisional_scope_key,
    v_provisional_budget_key,
    'EUR',
    p_lifetime_budget_minor,
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
    'lifetime_budget_minor', p_lifetime_budget_minor
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
      'lifetime_budget_minor', p_lifetime_budget_minor
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
    'budget_type', 'LIFETIME',
    'lifetime_budget_minor', p_lifetime_budget_minor,
    'start_time', p_start_time,
    'end_time', p_end_time,
    'campaign_name', v_campaign_name,
    'ad_set_name', v_ad_set_name,
    'creative_name', v_creative_name,
    'ad_name', v_ad_name,
    'target_status', 'ACTIVE'
  );
end;
$$;

create or replace function public.materialize_meta_customer_lifetime_launch_plan_v3(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_read_lease_token uuid,
  p_blueprint_id uuid,
  p_brand_profile_id uuid,
  p_brand_asset_id uuid,
  p_allowed_domain_id uuid,
  p_budget_owner_type text,
  p_lifetime_budget_minor bigint,
  p_start_time timestamptz,
  p_end_time timestamptz,
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
    or p_lifetime_budget_minor is null
    or p_lifetime_budget_minor <= 0
    or p_budget_owner_type <> 'CAMPAIGN'
    or p_start_time is null
    or p_end_time is null
    or p_start_time < p_planned_at - interval '5 minutes'
    or p_end_time <= p_start_time + interval '1 hour'
    or p_end_time > p_start_time + interval '90 days'
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

  v_result := public.materialize_meta_launch_chain_plan_v3(
    p_platform_account_id,
    p_user_id,
    v_policy.id,
    v_snapshot.id,
    v_account.marketing_sync_id,
    p_read_lease_token,
    p_blueprint_id,
    p_brand_profile_id,
    array[p_brand_asset_id]::uuid[],
    p_allowed_domain_id,
    p_budget_owner_type,
    p_lifetime_budget_minor,
    p_start_time,
    p_end_time,
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
        'budget_type', 'LIFETIME',
        'lifetime_budget_minor', p_lifetime_budget_minor,
        'start_time', p_start_time,
        'end_time', p_end_time
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


revoke all on function public.materialize_meta_launch_chain_plan_v3(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[], uuid,
  text, bigint, timestamptz, timestamptz, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_meta_launch_chain_plan_v3(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[], uuid,
  text, bigint, timestamptz, timestamptz, jsonb, timestamptz
) to service_role;

revoke all on function public.materialize_meta_launch_chain_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[], uuid,
  text, bigint, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_meta_launch_chain_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[], uuid,
  text, bigint, jsonb, timestamptz
) to service_role;

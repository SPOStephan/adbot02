-- Structural multi-ad testing: 1 campaign → 1 ad set → 2 ads (2 creatives),
-- same brand asset/image, different copy each. Mutually exclusive with DCA
-- (asset_feed_spec / is_dynamic_creative). Default structural_ad_count=1 keeps
-- the single-ad path unchanged. Does NOT redefine organic-boost materialize.
--
-- Also widens approve canary step graphs (20/21/28/29) and reconcile for 2 ads.
-- Copied forward from 20260818180000 (materialize), 20260817190000 (approve),
-- and 20260802170000 (reconcile).

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
  v_structural_ad_count integer := 1;
  v_structural_ads jsonb := '[]'::jsonb;
  v_creative_payload_2 jsonb;
  v_ad_payload_2 jsonb;
  v_creative_name_2 text;
  v_ad_name_2 text;
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
  v_step_validate_creative_2 uuid := gen_random_uuid();
  v_step_create_creative_2 uuid := gen_random_uuid();
  v_step_read_creative_2 uuid := gen_random_uuid();
  v_step_validate_ad_2 uuid := gen_random_uuid();
  v_step_create_ad_2 uuid := gen_random_uuid();
  v_step_read_ad_shadow_2 uuid := gen_random_uuid();
  v_step_activate_ad_2 uuid := gen_random_uuid();
  v_step_read_ad_active_2 uuid := gen_random_uuid();
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

  v_structural_ad_count := 1;
  if coalesce(p_launch_inputs, '{}'::jsonb) ? 'structural_ad_count' then
    begin
      v_structural_ad_count := (p_launch_inputs->>'structural_ad_count')::integer;
    exception when others then
      raise exception 'structural_ad_count muss 1 oder 2 sein';
    end;
  end if;
  if v_structural_ad_count not in (1, 2) then
    raise exception 'structural_ad_count muss 1 oder 2 sein';
  end if;
  if v_structural_ad_count = 2 then
    if jsonb_typeof(p_launch_inputs->'structural_ads') <> 'array'
      or jsonb_array_length(p_launch_inputs->'structural_ads') <> 2 then
      raise exception 'Struktur-Test benötigt genau zwei Anzeigen-Texte (structural_ads)';
    end if;
    v_structural_ads := p_launch_inputs->'structural_ads';
    if nullif(btrim(coalesce(v_structural_ads->0->>'message', '')), '') is null
      or nullif(btrim(coalesce(v_structural_ads->0->>'name', '')), '') is null
      or nullif(btrim(coalesce(v_structural_ads->1->>'message', '')), '') is null
      or nullif(btrim(coalesce(v_structural_ads->1->>'name', '')), '') is null
      or char_length(coalesce(v_structural_ads->0->>'message', '')) > 2200
      or char_length(coalesce(v_structural_ads->0->>'name', '')) > 255
      or char_length(coalesce(v_structural_ads->0->>'description', '')) > 255
      or char_length(coalesce(v_structural_ads->1->>'message', '')) > 2200
      or char_length(coalesce(v_structural_ads->1->>'name', '')) > 255
      or char_length(coalesce(v_structural_ads->1->>'description', '')) > 255 then
      raise exception 'Jede Struktur-Anzeige braucht Anzeigentext und Überschrift in zulässiger Länge';
    end if;
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
  -- Meta rejects deprecated object_story_spec.instagram_actor_id (#100).
  -- Profile column still named instagram_actor_id; value is the IG user id —
  -- map to instagram_user_id. Never strip a selected IG into Facebook-only.
  v_object_story_spec := v_object_story_spec - 'instagram_actor_id';
  if nullif(btrim(coalesce(v_profile.instagram_actor_id, '')), '') is not null then
    if not exists (
      select 1
      from public.meta_assets ma
      where ma.platform_account_id = p_platform_account_id
        and ma.user_id = p_user_id
        and ma.asset_type = 'instagram_account'
        and ma.meta_asset_id = v_profile.instagram_actor_id
    ) then
      raise exception
        using errcode = 'P0001',
              message = 'instagram_account_required',
              detail = 'Das gewählte Instagram-Konto ist nicht (mehr) mit diesem Meta-Konto verbunden. Bitte Instagram erneut wählen oder Meta verbinden.';
    end if;
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{instagram_user_id}',
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

  v_creative_payload := v_creative_payload - 'instagram_actor_id';
  if nullif(btrim(coalesce(v_profile.instagram_actor_id, '')), '') is not null then
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

  -- Structural multi-ad: strip DCA and force classic link_data from structural_ads.
  if v_structural_ad_count = 2 then
    v_creative_payload := v_creative_payload - 'asset_feed_spec';
    v_ad_set_payload := v_ad_set_payload - 'is_dynamic_creative';
    v_object_story_spec := coalesce(v_creative_payload->'object_story_spec', '{}'::jsonb)
      - 'instagram_actor_id';
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{page_id}',
      pg_catalog.to_jsonb(v_profile.facebook_page_id),
      true
    );
    if jsonb_typeof(v_object_story_spec->'link_data') <> 'object' then
      v_object_story_spec := jsonb_set(
        v_object_story_spec,
        '{link_data}',
        jsonb_build_object(
          'call_to_action', jsonb_build_object('type', 'LEARN_MORE')
        ),
        true
      );
    end if;
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,message}',
      pg_catalog.to_jsonb(btrim(v_structural_ads->0->>'message')),
      true
    );
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,name}',
      pg_catalog.to_jsonb(btrim(v_structural_ads->0->>'name')),
      true
    );
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,description}',
      pg_catalog.to_jsonb(coalesce(v_structural_ads->0->>'description', '')),
      true
    );
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,image_hash}',
      v_image_reference,
      true
    );
    if v_destination_url is not null then
      v_object_story_spec := jsonb_set(
        v_object_story_spec,
        '{link_data,link}',
        pg_catalog.to_jsonb(v_destination_url),
        true
      );
    end if;
    if nullif(btrim(coalesce(v_profile.instagram_actor_id, '')), '') is not null then
      v_object_story_spec := jsonb_set(
        v_object_story_spec,
        '{instagram_user_id}',
        pg_catalog.to_jsonb(v_profile.instagram_actor_id),
        true
      );
    end if;
    v_creative_payload := jsonb_set(
      v_creative_payload,
      '{object_story_spec}',
      v_object_story_spec,
      true
    );
  -- Dynamic Creative text variants (asset_feed_spec): one ad, many bodies/titles.
  elsif jsonb_typeof(v_creative_payload->'asset_feed_spec') = 'object' then
    v_object_story_spec := coalesce(v_creative_payload->'object_story_spec', '{}'::jsonb)
      - 'link_data' - 'instagram_actor_id';
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{page_id}',
      pg_catalog.to_jsonb(v_profile.facebook_page_id),
      true
    );
    v_creative_payload := jsonb_set(
      v_creative_payload,
      '{object_story_spec}',
      v_object_story_spec,
      true
    );
    v_creative_payload := jsonb_set(
      v_creative_payload,
      '{asset_feed_spec,images}',
      jsonb_build_array(jsonb_build_object('hash', v_image_reference)),
      true
    );
    if v_destination_url is not null then
      v_creative_payload := jsonb_set(
        v_creative_payload,
        '{asset_feed_spec,link_urls}',
        jsonb_build_array(jsonb_build_object('website_url', v_destination_url)),
        true
      );
    end if;
    if jsonb_typeof(v_creative_payload#>'{asset_feed_spec,ad_formats}') <> 'array'
      or jsonb_array_length(v_creative_payload#>'{asset_feed_spec,ad_formats}') < 1 then
      v_creative_payload := jsonb_set(
        v_creative_payload,
        '{asset_feed_spec,ad_formats}',
        '["SINGLE_IMAGE"]'::jsonb,
        true
      );
    end if;
    v_ad_set_payload := jsonb_set(
      v_ad_set_payload,
      '{is_dynamic_creative}',
      'true'::jsonb,
      true
    );
  elsif jsonb_typeof(v_creative_payload#>'{object_story_spec,link_data}') = 'object' then
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

  if v_structural_ad_count = 2 then
    v_creative_payload_2 := v_creative_payload;
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{object_story_spec,link_data,message}',
      pg_catalog.to_jsonb(btrim(v_structural_ads->1->>'message')),
      true
    );
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{object_story_spec,link_data,name}',
      pg_catalog.to_jsonb(btrim(v_structural_ads->1->>'name')),
      true
    );
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{object_story_spec,link_data,description}',
      pg_catalog.to_jsonb(coalesce(v_structural_ads->1->>'description', '')),
      true
    );
    v_ad_payload_2 := v_ad_payload
      - 'creative' - 'name'
      || jsonb_build_object(
        'name', coalesce(
          nullif(p_launch_inputs->>'ad_name', ''),
          nullif(v_ad_payload->>'name', ''),
          v_blueprint.name || ' Ad'
        ) || ' 2',
        'creative', jsonb_build_object(
          'creative_id', jsonb_build_object(
            '$binding_step_id', v_step_create_creative_2
          )
        )
      );
    -- Distinguish creative 2 base name before tracking suffix.
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{name}',
      pg_catalog.to_jsonb(
        coalesce(
          nullif(p_launch_inputs->>'creative_name', ''),
          nullif(v_creative_payload_2->>'name', ''),
          v_blueprint.name || ' Creative'
        ) || ' 2'
      ),
      true
    );
  end if;


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

  if v_structural_ad_count = 2 then
    v_creative_name_2 := left(v_creative_payload_2->>'name', 240)
      || ' [' || v_tracking_suffix || '-r2]';
    v_ad_name_2 := left(v_ad_payload_2->>'name', 240)
      || ' [' || v_tracking_suffix || '-a2]';
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2, '{name}', pg_catalog.to_jsonb(v_creative_name_2), true
    );
    v_ad_payload_2 := jsonb_set(
      v_ad_payload_2, '{name}', pg_catalog.to_jsonb(v_ad_name_2), true
    );
  end if;

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
  if v_structural_ad_count = 2 then
    v_planned_payload := v_planned_payload || jsonb_build_object(
      'structural_ad_count', 2,
      'creatives', jsonb_build_array(v_creative_payload, v_creative_payload_2),
      'ads', jsonb_build_array(v_ad_payload, v_ad_payload_2)
    );
  end if;
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

  if v_structural_ad_count = 2 then
    v_request := jsonb_build_object(
      'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
      'mode', 'validate_only', 'payload', v_creative_payload_2
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_validate_creative_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'validate-creative-2', 'VALIDATE', 'CREATIVE', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('validated', true), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_validate_creative_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
      'payload', v_creative_payload_2
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_create_creative_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'create-creative-2', 'CREATE', 'CREATIVE', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('created', true), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_create_creative_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'READ', 'object_type', 'CREATIVE',
      'object_id', jsonb_build_object('$binding_step_id', v_step_create_creative_2)
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_read_creative_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'read-creative-2', 'READ', 'CREATIVE', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('created', true), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_read_creative_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'CREATE_AD', 'object_type', 'AD',
      'mode', 'validate_only', 'payload', v_ad_payload_2
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_validate_ad_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'validate-ad-paused-2', 'VALIDATE', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('validated', true), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_validate_ad_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'CREATE_AD', 'object_type', 'AD',
      'mode', 'execute', 'payload', v_ad_payload_2
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_create_ad_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'create-ad-paused-2', 'CREATE', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('status', 'PAUSED'), 'PAUSE', 'PENDING'
    );
    v_previous_step := v_step_create_ad_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'READ', 'object_type', 'AD',
      'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_2)
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_read_ad_shadow_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'read-ad-paused-2', 'READ', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_read_ad_shadow_2;
    v_index := v_index + 1;
  end if;


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

  if v_structural_ad_count = 2 then
    v_request := jsonb_build_object(
      'operation', 'UPDATE_STATUS', 'object_type', 'AD',
      'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_2),
      'status', 'ACTIVE', 'mode', 'execute'
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_activate_ad_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'activate-ad-2', 'UPDATE', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
    );
    v_previous_step := v_step_activate_ad_2;
    v_index := v_index + 1;
  end if;


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

  if v_structural_ad_count = 2 then
    v_request := jsonb_build_object(
      'operation', 'READ', 'object_type', 'AD',
      'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_2)
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_read_ad_active_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'read-ad-active-2', 'READ', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('status', 'ACTIVE'), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_read_ad_active_2;
    v_index := v_index + 1;
  end if;


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
  v_structural_ad_count integer := 1;
  v_structural_ads jsonb := '[]'::jsonb;
  v_creative_payload_2 jsonb;
  v_ad_payload_2 jsonb;
  v_creative_name_2 text;
  v_ad_name_2 text;
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
  v_step_validate_creative_2 uuid := gen_random_uuid();
  v_step_create_creative_2 uuid := gen_random_uuid();
  v_step_read_creative_2 uuid := gen_random_uuid();
  v_step_validate_ad_2 uuid := gen_random_uuid();
  v_step_create_ad_2 uuid := gen_random_uuid();
  v_step_read_ad_shadow_2 uuid := gen_random_uuid();
  v_step_activate_ad_2 uuid := gen_random_uuid();
  v_step_read_ad_active_2 uuid := gen_random_uuid();
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

  v_structural_ad_count := 1;
  if coalesce(p_launch_inputs, '{}'::jsonb) ? 'structural_ad_count' then
    begin
      v_structural_ad_count := (p_launch_inputs->>'structural_ad_count')::integer;
    exception when others then
      raise exception 'structural_ad_count muss 1 oder 2 sein';
    end;
  end if;
  if v_structural_ad_count not in (1, 2) then
    raise exception 'structural_ad_count muss 1 oder 2 sein';
  end if;
  if v_structural_ad_count = 2 then
    if jsonb_typeof(p_launch_inputs->'structural_ads') <> 'array'
      or jsonb_array_length(p_launch_inputs->'structural_ads') <> 2 then
      raise exception 'Struktur-Test benötigt genau zwei Anzeigen-Texte (structural_ads)';
    end if;
    v_structural_ads := p_launch_inputs->'structural_ads';
    if nullif(btrim(coalesce(v_structural_ads->0->>'message', '')), '') is null
      or nullif(btrim(coalesce(v_structural_ads->0->>'name', '')), '') is null
      or nullif(btrim(coalesce(v_structural_ads->1->>'message', '')), '') is null
      or nullif(btrim(coalesce(v_structural_ads->1->>'name', '')), '') is null
      or char_length(coalesce(v_structural_ads->0->>'message', '')) > 2200
      or char_length(coalesce(v_structural_ads->0->>'name', '')) > 255
      or char_length(coalesce(v_structural_ads->0->>'description', '')) > 255
      or char_length(coalesce(v_structural_ads->1->>'message', '')) > 2200
      or char_length(coalesce(v_structural_ads->1->>'name', '')) > 255
      or char_length(coalesce(v_structural_ads->1->>'description', '')) > 255 then
      raise exception 'Jede Struktur-Anzeige braucht Anzeigentext und Überschrift in zulässiger Länge';
    end if;
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
  -- Meta rejects deprecated object_story_spec.instagram_actor_id (#100).
  -- Profile column still named instagram_actor_id; value is the IG user id —
  -- map to instagram_user_id. Never strip a selected IG into Facebook-only.
  v_object_story_spec := v_object_story_spec - 'instagram_actor_id';
  if nullif(btrim(coalesce(v_profile.instagram_actor_id, '')), '') is not null then
    if not exists (
      select 1
      from public.meta_assets ma
      where ma.platform_account_id = p_platform_account_id
        and ma.user_id = p_user_id
        and ma.asset_type = 'instagram_account'
        and ma.meta_asset_id = v_profile.instagram_actor_id
    ) then
      raise exception
        using errcode = 'P0001',
              message = 'instagram_account_required',
              detail = 'Das gewählte Instagram-Konto ist nicht (mehr) mit diesem Meta-Konto verbunden. Bitte Instagram erneut wählen oder Meta verbinden.';
    end if;
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{instagram_user_id}',
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

  v_creative_payload := v_creative_payload - 'instagram_actor_id';
  if nullif(btrim(coalesce(v_profile.instagram_actor_id, '')), '') is not null then
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

  -- Structural multi-ad: strip DCA and force classic link_data from structural_ads.
  if v_structural_ad_count = 2 then
    v_creative_payload := v_creative_payload - 'asset_feed_spec';
    v_ad_set_payload := v_ad_set_payload - 'is_dynamic_creative';
    v_object_story_spec := coalesce(v_creative_payload->'object_story_spec', '{}'::jsonb)
      - 'instagram_actor_id';
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{page_id}',
      pg_catalog.to_jsonb(v_profile.facebook_page_id),
      true
    );
    if jsonb_typeof(v_object_story_spec->'link_data') <> 'object' then
      v_object_story_spec := jsonb_set(
        v_object_story_spec,
        '{link_data}',
        jsonb_build_object(
          'call_to_action', jsonb_build_object('type', 'LEARN_MORE')
        ),
        true
      );
    end if;
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,message}',
      pg_catalog.to_jsonb(btrim(v_structural_ads->0->>'message')),
      true
    );
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,name}',
      pg_catalog.to_jsonb(btrim(v_structural_ads->0->>'name')),
      true
    );
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,description}',
      pg_catalog.to_jsonb(coalesce(v_structural_ads->0->>'description', '')),
      true
    );
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{link_data,image_hash}',
      v_image_reference,
      true
    );
    if v_destination_url is not null then
      v_object_story_spec := jsonb_set(
        v_object_story_spec,
        '{link_data,link}',
        pg_catalog.to_jsonb(v_destination_url),
        true
      );
    end if;
    if nullif(btrim(coalesce(v_profile.instagram_actor_id, '')), '') is not null then
      v_object_story_spec := jsonb_set(
        v_object_story_spec,
        '{instagram_user_id}',
        pg_catalog.to_jsonb(v_profile.instagram_actor_id),
        true
      );
    end if;
    v_creative_payload := jsonb_set(
      v_creative_payload,
      '{object_story_spec}',
      v_object_story_spec,
      true
    );
  -- Dynamic Creative text variants (asset_feed_spec): one ad, many bodies/titles.
  elsif jsonb_typeof(v_creative_payload->'asset_feed_spec') = 'object' then
    v_object_story_spec := coalesce(v_creative_payload->'object_story_spec', '{}'::jsonb)
      - 'link_data' - 'instagram_actor_id';
    v_object_story_spec := jsonb_set(
      v_object_story_spec,
      '{page_id}',
      pg_catalog.to_jsonb(v_profile.facebook_page_id),
      true
    );
    v_creative_payload := jsonb_set(
      v_creative_payload,
      '{object_story_spec}',
      v_object_story_spec,
      true
    );
    v_creative_payload := jsonb_set(
      v_creative_payload,
      '{asset_feed_spec,images}',
      jsonb_build_array(jsonb_build_object('hash', v_image_reference)),
      true
    );
    if v_destination_url is not null then
      v_creative_payload := jsonb_set(
        v_creative_payload,
        '{asset_feed_spec,link_urls}',
        jsonb_build_array(jsonb_build_object('website_url', v_destination_url)),
        true
      );
    end if;
    if jsonb_typeof(v_creative_payload#>'{asset_feed_spec,ad_formats}') <> 'array'
      or jsonb_array_length(v_creative_payload#>'{asset_feed_spec,ad_formats}') < 1 then
      v_creative_payload := jsonb_set(
        v_creative_payload,
        '{asset_feed_spec,ad_formats}',
        '["SINGLE_IMAGE"]'::jsonb,
        true
      );
    end if;
    v_ad_set_payload := jsonb_set(
      v_ad_set_payload,
      '{is_dynamic_creative}',
      'true'::jsonb,
      true
    );
  elsif jsonb_typeof(v_creative_payload#>'{object_story_spec,link_data}') = 'object' then
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

  if v_structural_ad_count = 2 then
    v_creative_payload_2 := v_creative_payload;
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{object_story_spec,link_data,message}',
      pg_catalog.to_jsonb(btrim(v_structural_ads->1->>'message')),
      true
    );
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{object_story_spec,link_data,name}',
      pg_catalog.to_jsonb(btrim(v_structural_ads->1->>'name')),
      true
    );
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{object_story_spec,link_data,description}',
      pg_catalog.to_jsonb(coalesce(v_structural_ads->1->>'description', '')),
      true
    );
    v_ad_payload_2 := v_ad_payload
      - 'creative' - 'name'
      || jsonb_build_object(
        'name', coalesce(
          nullif(p_launch_inputs->>'ad_name', ''),
          nullif(v_ad_payload->>'name', ''),
          v_blueprint.name || ' Ad'
        ) || ' 2',
        'creative', jsonb_build_object(
          'creative_id', jsonb_build_object(
            '$binding_step_id', v_step_create_creative_2
          )
        )
      );
    -- Distinguish creative 2 base name before tracking suffix.
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{name}',
      pg_catalog.to_jsonb(
        coalesce(
          nullif(p_launch_inputs->>'creative_name', ''),
          nullif(v_creative_payload_2->>'name', ''),
          v_blueprint.name || ' Creative'
        ) || ' 2'
      ),
      true
    );
  end if;


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

  if v_structural_ad_count = 2 then
    v_creative_name_2 := left(v_creative_payload_2->>'name', 240)
      || ' [' || v_tracking_suffix || '-r2]';
    v_ad_name_2 := left(v_ad_payload_2->>'name', 240)
      || ' [' || v_tracking_suffix || '-a2]';
    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2, '{name}', pg_catalog.to_jsonb(v_creative_name_2), true
    );
    v_ad_payload_2 := jsonb_set(
      v_ad_payload_2, '{name}', pg_catalog.to_jsonb(v_ad_name_2), true
    );
  end if;

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
  if v_structural_ad_count = 2 then
    v_planned_payload := v_planned_payload || jsonb_build_object(
      'structural_ad_count', 2,
      'creatives', jsonb_build_array(v_creative_payload, v_creative_payload_2),
      'ads', jsonb_build_array(v_ad_payload, v_ad_payload_2)
    );
  end if;
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

  if v_structural_ad_count = 2 then
    v_request := jsonb_build_object(
      'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
      'mode', 'validate_only', 'payload', v_creative_payload_2
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_validate_creative_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'validate-creative-2', 'VALIDATE', 'CREATIVE', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('validated', true), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_validate_creative_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
      'payload', v_creative_payload_2
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_create_creative_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'create-creative-2', 'CREATE', 'CREATIVE', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('created', true), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_create_creative_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'READ', 'object_type', 'CREATIVE',
      'object_id', jsonb_build_object('$binding_step_id', v_step_create_creative_2)
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_read_creative_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'read-creative-2', 'READ', 'CREATIVE', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('created', true), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_read_creative_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'CREATE_AD', 'object_type', 'AD',
      'mode', 'validate_only', 'payload', v_ad_payload_2
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_validate_ad_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'validate-ad-paused-2', 'VALIDATE', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('validated', true), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_validate_ad_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'CREATE_AD', 'object_type', 'AD',
      'mode', 'execute', 'payload', v_ad_payload_2
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_create_ad_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'create-ad-paused-2', 'CREATE', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('status', 'PAUSED'), 'PAUSE', 'PENDING'
    );
    v_previous_step := v_step_create_ad_2;
    v_index := v_index + 1;

    v_request := jsonb_build_object(
      'operation', 'READ', 'object_type', 'AD',
      'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_2)
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_read_ad_shadow_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'read-ad-paused-2', 'READ', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_read_ad_shadow_2;
    v_index := v_index + 1;
  end if;


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

  if v_structural_ad_count = 2 then
    v_request := jsonb_build_object(
      'operation', 'UPDATE_STATUS', 'object_type', 'AD',
      'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_2),
      'status', 'ACTIVE', 'mode', 'execute'
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_activate_ad_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'activate-ad-2', 'UPDATE', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
    );
    v_previous_step := v_step_activate_ad_2;
    v_index := v_index + 1;
  end if;


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

  if v_structural_ad_count = 2 then
    v_request := jsonb_build_object(
      'operation', 'READ', 'object_type', 'AD',
      'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_2)
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_read_ad_active_2, v_plan_id, p_user_id, p_platform_account_id,
      v_index, 'read-ad-active-2', 'READ', 'AD', v_previous_step,
      v_request, public.meta_sha256(v_request::text),
      jsonb_build_object('status', 'ACTIVE'), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_read_ad_active_2;
    v_index := v_index + 1;
  end if;


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

  if v_step_count not in (20, 21, 28, 29)
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
    or exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.step_key like 'create-ad-paused%'
        and step.planned_request#>>'{payload,status}' is distinct from 'PAUSED'
    )
    or not exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.step_key like 'activate-ad%'
        and step.step_key not like 'activate-ad-set%'
    )
    or exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.step_key like 'activate-ad%'
        and step.step_key not like 'activate-ad-set%'
        and step.planned_request->>'status' is distinct from 'ACTIVE'
    ) then
    raise exception 'Launch step graph is invalid or already dispatched';
  end if;

  -- Held canaries (not_before=infinity) and future-scheduled plans must not
  -- block Freigabe; only due/executing work and live leases do.
  if public.meta_launch_account_blocks_exclusive_approve(
    p_user_id,
    p_platform_account_id,
    v_plan.id,
    v_approved_at
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

revoke all on function public.approve_meta_launch_canary_plan(
  uuid, uuid, uuid, text, text, text, text, bigint,
  text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.approve_meta_launch_canary_plan(
  uuid, uuid, uuid, text, text, text, text, bigint,
  text, text, text, text, text, text
) to service_role;

create or replace function public.approve_meta_lifetime_launch_canary_plan_v3(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid,
  p_expected_payload_hash text,
  p_expected_objective text,
  p_expected_destination_url text,
  p_expected_budget_owner_type text,
  p_expected_lifetime_budget_minor bigint,
  p_expected_start_time timestamptz,
  p_expected_end_time timestamptz,
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
  v_current_lifetime_exposure_minor bigint;
begin
  if p_expected_payload_hash !~ '^[0-9a-f]{64}$'
    or p_expected_budget_owner_type <> 'CAMPAIGN'
    or p_expected_lifetime_budget_minor is null
    or p_expected_lifetime_budget_minor <= 0
    or p_expected_start_time is null
    or p_expected_end_time is null
    or p_expected_end_time <= p_expected_start_time + interval '1 hour'
    or p_expected_end_time > p_expected_start_time + interval '90 days'
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
      or v_existing.budget_type <> 'LIFETIME'
      or v_existing.lifetime_budget_minor <> p_expected_lifetime_budget_minor
      or v_existing.start_time <> p_expected_start_time
      or v_existing.end_time <> p_expected_end_time
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
    or (v_plan.planned_payload->>'contract_version')::integer <> 3
    or v_plan.planned_payload->>'objective' <> p_expected_objective
    or v_plan.planned_payload->>'destination_url' <> p_expected_destination_url
    or v_plan.planned_payload->>'budget_owner_type' <> p_expected_budget_owner_type
    or v_plan.planned_payload->>'budget_type' <> 'LIFETIME'
    or (v_plan.planned_payload->>'lifetime_budget_minor')::bigint
         <> p_expected_lifetime_budget_minor
    or (v_plan.planned_payload->>'start_time')::timestamptz <> p_expected_start_time
    or (v_plan.planned_payload->>'end_time')::timestamptz <> p_expected_end_time
    or (v_plan.planned_payload#>>'{campaign,lifetime_budget}')::bigint
         <> p_expected_lifetime_budget_minor
    or v_plan.planned_payload#>>'{campaign,daily_budget}' is not null
    or v_plan.planned_payload#>>'{ad_set,daily_budget}' is not null
    or v_plan.planned_payload#>>'{ad_set,lifetime_budget}' is not null
    or (v_plan.planned_payload#>>'{ad_set,start_time}')::timestamptz
         <> p_expected_start_time
    or (v_plan.planned_payload#>>'{ad_set,end_time}')::timestamptz
         <> p_expected_end_time
    or v_plan.planned_payload#>>'{campaign,name}' <> p_expected_campaign_name
    or v_plan.planned_payload#>>'{ad_set,name}' <> p_expected_ad_set_name
    or v_plan.planned_payload#>>'{creative,name}' <> p_expected_creative_name
    or v_plan.planned_payload#>>'{ad,name}' <> p_expected_ad_name
    or v_plan.planned_payload#>>'{campaign,status}' <> 'PAUSED'
    or v_plan.planned_payload#>>'{ad_set,status}' <> 'PAUSED'
    or v_plan.planned_payload#>>'{ad,status}' <> 'PAUSED'
    or v_plan.intended_after->>'status' <> p_expected_target_status
    or v_plan.intended_after->>'budget_type' <> 'LIFETIME'
    or (v_plan.intended_after->>'lifetime_budget_minor')::bigint
         <> p_expected_lifetime_budget_minor
    or (v_plan.intended_after->>'start_time')::timestamptz <> p_expected_start_time
    or (v_plan.intended_after->>'end_time')::timestamptz <> p_expected_end_time
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
    and p_expected_lifetime_budget_minor
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

  v_current_lifetime_exposure_minor :=
    public.meta_active_lifetime_budget_exposure_minor(
      p_user_id, p_platform_account_id, v_plan.source_marketing_sync_id,
      v_approved_at
    );

  if v_current_lifetime_exposure_minor
       <> (v_plan.expected_before->>'existing_lifetime_exposure_minor')::bigint then
    raise exception 'Active lifetime exposure fingerprint drifted';
  end if;

  if (
    select coalesce(sum(exposure.reserved_exposure_minor), 0)::bigint
    from public.daily_budget_exposures exposure
    where exposure.platform_account_id = p_platform_account_id
      and exposure.account_day = v_snapshot.account_day
  ) + v_current_lifetime_exposure_minor > v_policy.account_daily_hard_cap_minor then
    raise exception 'Combined launch exposure exceeds customer account hard cap';
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
      and exposure.max_daily_budget_minor = p_expected_lifetime_budget_minor
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

  if v_step_count not in (20, 21, 28, 29)
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
    or exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.step_key like 'create-ad-paused%'
        and step.planned_request#>>'{payload,status}' is distinct from 'PAUSED'
    )
    or not exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.step_key like 'activate-ad%'
        and step.step_key not like 'activate-ad-set%'
    )
    or exists (
      select 1 from public.mutation_plan_steps step
      where step.plan_id = v_plan.id
        and step.step_key like 'activate-ad%'
        and step.step_key not like 'activate-ad-set%'
        and step.planned_request->>'status' is distinct from 'ACTIVE'
    ) then
    raise exception 'Launch step graph is invalid or already dispatched';
  end if;

  -- Held canaries (not_before=infinity) and future-scheduled plans must not
  -- block Freigabe; only due/executing work and live leases do.
  if public.meta_launch_account_blocks_exclusive_approve(
    p_user_id,
    p_platform_account_id,
    v_plan.id,
    v_approved_at
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
    destination_url, budget_owner_type, budget_type, daily_budget_minor,
    lifetime_budget_minor, start_time, end_time, campaign_name, ad_set_name,
    creative_name, ad_name, target_status, reason, approved_by, approved_at
  ) values (
    v_approval_id, p_user_id, p_platform_account_id, v_plan.id,
    p_expected_payload_hash, p_expected_objective, p_expected_destination_url,
    p_expected_budget_owner_type, 'LIFETIME', null, p_expected_lifetime_budget_minor,
    p_expected_start_time, p_expected_end_time, p_expected_campaign_name, p_expected_ad_set_name,
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
      'budget_type', 'LIFETIME',
      'lifetime_budget_minor', p_expected_lifetime_budget_minor,
      'start_time', p_expected_start_time,
      'end_time', p_expected_end_time,
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


revoke all on function public.approve_meta_lifetime_launch_canary_plan_v3(
  uuid, uuid, uuid, text, text, text, text, bigint, timestamptz, timestamptz,
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.approve_meta_lifetime_launch_canary_plan_v3(
  uuid, uuid, uuid, text, text, text, text, bigint, timestamptz, timestamptz,
  text, text, text, text, text, text
) to service_role;

create or replace function public.reconcile_meta_launch_mutation_plan(
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
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_policy public.automation_policies%rowtype;
  v_exposure_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_campaign_binding public.remote_object_bindings%rowtype;
  v_ad_set_binding public.remote_object_bindings%rowtype;
  v_creative_binding public.remote_object_bindings%rowtype;
  v_ad_binding public.remote_object_bindings%rowtype;
  v_structural_ad_count integer := 1;
  v_creative_binding_count integer := 0;
  v_ad_binding_count integer := 0;
  v_creative_remote_ids text[] := '{}'::text[];
  v_ad_remote_ids text[] := '{}'::text[];
  v_loop_binding public.remote_object_bindings%rowtype;
  v_loop_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_loop_creative_id uuid;
  v_loop_ad_id uuid;
  v_loop_ad_target_id uuid;
  v_loop_creative_remote text;
  v_loop_ad_status text;
  v_campaign_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_ad_set_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_creative_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_ad_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_campaign_id uuid;
  v_ad_group_id uuid;
  v_creative_id uuid;
  v_ad_id uuid;
  v_campaign_target_id uuid;
  v_ad_set_target_id uuid;
  v_ad_target_id uuid;
  v_campaign_status text;
  v_ad_set_status text;
  v_ad_status text;
  v_campaign_budget bigint;
  v_ad_set_budget bigint;
  v_campaign_lifetime_budget bigint;
  v_ad_set_lifetime_budget bigint;
  v_ad_set_start_time timestamptz;
  v_ad_set_end_time timestamptz;
  v_expected_budget bigint;
  v_expected_start_time timestamptz;
  v_expected_end_time timestamptz;
  v_contract_version integer;
  v_budget_type text;
  v_budget_owner_type text;
  v_flex_spend_multiplier_bps integer;
  v_budget_target_id uuid;
  v_canonical_scope_key text;
  v_canonical_budget_key text;
  v_reserved_exposure_minor bigint;
  v_matches boolean := false;
  v_latest_snapshot_id uuid;
  v_last_mutate_step public.mutation_plan_steps%rowtype;
begin
  select me.* into v_execution
  from public.mutation_executions me
  where me.id = p_execution_id
    and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then
    raise exception 'Active Meta execution is required';
  end if;

  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = v_execution.plan_id
    and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
    and mp.action_type in ('LAUNCH_CHAIN', 'LAUNCH_AD')
  for update;
  if not found then
    raise exception 'Active Meta launch plan is required';
  end if;

  select mps.* into v_step
  from public.mutation_plan_steps mps
  where mps.id = p_step_id
    and mps.plan_id = v_plan.id
    and mps.operation = 'RECONCILE'
    and mps.status in ('CLAIMED', 'RUNNING', 'RETRYABLE')
  for update;
  if not found then
    raise exception 'Claimed launch reconciliation step is required';
  end if;

  select policy.* into v_policy
  from public.automation_policies policy
  where policy.id = v_plan.policy_id
    and policy.user_id = v_plan.user_id
    and policy.platform_account_id = v_plan.platform_account_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.currency = 'EUR'
    and policy.allow_new_launches
    and policy.allow_status_changes
  for update;
  if not found then
    raise exception 'Active launch- and status-enabled policy is required for reconciliation';
  end if;

  select s.* into v_exposure_snapshot
  from public.daily_budget_exposure_snapshots s
  where s.id = (v_plan.expected_before->>'exposure_snapshot_id')::uuid
    and s.user_id = v_plan.user_id
    and s.platform_account_id = v_plan.platform_account_id
    and s.policy_id = v_plan.policy_id
    and s.source_marketing_sync_id = v_plan.source_marketing_sync_id
    and s.status = 'COMPLETE'
    and s.currency = 'EUR'
  for update;
  if not found then
    raise exception 'Complete launch exposure snapshot is required';
  end if;

  select binding.* into v_campaign_binding
  from public.remote_object_bindings binding
  where binding.plan_id = v_plan.id
    and binding.user_id = v_plan.user_id
    and binding.platform_account_id = v_plan.platform_account_id
    and binding.object_type = 'CAMPAIGN'
  order by binding.bound_at desc
  limit 1;

  select binding.* into v_ad_set_binding
  from public.remote_object_bindings binding
  where binding.plan_id = v_plan.id
    and binding.user_id = v_plan.user_id
    and binding.platform_account_id = v_plan.platform_account_id
    and binding.object_type = 'AD_SET'
  order by binding.bound_at desc
  limit 1;

  select binding.* into v_creative_binding
  from public.remote_object_bindings binding
  where binding.plan_id = v_plan.id
    and binding.user_id = v_plan.user_id
    and binding.platform_account_id = v_plan.platform_account_id
    and binding.object_type = 'CREATIVE'
  order by binding.bound_at desc
  limit 1;

  select binding.* into v_ad_binding
  from public.remote_object_bindings binding
  where binding.plan_id = v_plan.id
    and binding.user_id = v_plan.user_id
    and binding.platform_account_id = v_plan.platform_account_id
    and binding.object_type = 'AD'
  order by binding.bound_at desc
  limit 1;

  v_structural_ad_count := coalesce(
    (v_plan.planned_payload->>'structural_ad_count')::integer,
    1
  );
  if v_structural_ad_count not in (1, 2) then
    raise exception 'Unsupported structural_ad_count for reconciliation';
  end if;

  select count(*)::integer,
         coalesce(array_agg(binding.remote_object_id order by binding.bound_at, binding.id), '{}'::text[])
    into v_creative_binding_count, v_creative_remote_ids
  from public.remote_object_bindings binding
  where binding.plan_id = v_plan.id
    and binding.user_id = v_plan.user_id
    and binding.platform_account_id = v_plan.platform_account_id
    and binding.object_type = 'CREATIVE'
    and binding.remote_object_id ~ '^[1-9][0-9]{0,39}$';

  select count(*)::integer,
         coalesce(array_agg(binding.remote_object_id order by binding.bound_at, binding.id), '{}'::text[])
    into v_ad_binding_count, v_ad_remote_ids
  from public.remote_object_bindings binding
  where binding.plan_id = v_plan.id
    and binding.user_id = v_plan.user_id
    and binding.platform_account_id = v_plan.platform_account_id
    and binding.object_type = 'AD'
    and binding.remote_object_id ~ '^[1-9][0-9]{0,39}$';

  if v_campaign_binding.id is null
    or v_ad_set_binding.id is null
    or v_campaign_binding.remote_object_id !~ '^[1-9][0-9]{0,39}$'
    or v_ad_set_binding.remote_object_id !~ '^[1-9][0-9]{0,39}$'
    or v_creative_binding_count <> v_structural_ad_count
    or v_ad_binding_count <> v_structural_ad_count
    or v_creative_binding.id is null
    or v_ad_binding.id is null
    or v_creative_binding.remote_object_id !~ '^[1-9][0-9]{0,39}$'
    or v_ad_binding.remote_object_id !~ '^[1-9][0-9]{0,39}$' then
    raise exception 'Complete numeric remote launch bindings are required';
  end if;

  select s.* into v_campaign_snapshot
  from public.meta_mutation_remote_snapshots s
  join public.mutation_plan_steps snapshot_step on snapshot_step.id = s.step_id
  where s.plan_id = v_plan.id
    and s.object_type = 'CAMPAIGN'
    and s.remote_object_id = v_campaign_binding.remote_object_id
    and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
  order by snapshot_step.step_index desc, s.observed_at desc, s.created_at desc
  limit 1;

  select s.* into v_ad_set_snapshot
  from public.meta_mutation_remote_snapshots s
  join public.mutation_plan_steps snapshot_step on snapshot_step.id = s.step_id
  where s.plan_id = v_plan.id
    and s.object_type = 'AD_SET'
    and s.remote_object_id = v_ad_set_binding.remote_object_id
    and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
  order by snapshot_step.step_index desc, s.observed_at desc, s.created_at desc
  limit 1;

  select s.* into v_creative_snapshot
  from public.meta_mutation_remote_snapshots s
  join public.mutation_plan_steps snapshot_step on snapshot_step.id = s.step_id
  where s.plan_id = v_plan.id
    and s.object_type = 'CREATIVE'
    and s.remote_object_id = v_creative_binding.remote_object_id
    and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
  order by snapshot_step.step_index desc, s.observed_at desc, s.created_at desc
  limit 1;

  select s.* into v_ad_snapshot
  from public.meta_mutation_remote_snapshots s
  join public.mutation_plan_steps snapshot_step on snapshot_step.id = s.step_id
  where s.plan_id = v_plan.id
    and s.object_type = 'AD'
    and s.remote_object_id = v_ad_binding.remote_object_id
    and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
  order by snapshot_step.step_index desc, s.observed_at desc, s.created_at desc
  limit 1;

  v_latest_snapshot_id := v_ad_snapshot.id;
  v_campaign_status := coalesce(
    v_campaign_snapshot.snapshot_payload->>'status',
    v_campaign_snapshot.snapshot_payload->>'effective_status'
  );
  v_ad_set_status := coalesce(
    v_ad_set_snapshot.snapshot_payload->>'status',
    v_ad_set_snapshot.snapshot_payload->>'effective_status'
  );
  v_ad_status := coalesce(
    v_ad_snapshot.snapshot_payload->>'status',
    v_ad_snapshot.snapshot_payload->>'effective_status'
  );

  if coalesce(v_campaign_snapshot.snapshot_payload->>'daily_budget', '') ~ '^[0-9]+$' then
    v_campaign_budget := nullif(
      (v_campaign_snapshot.snapshot_payload->>'daily_budget')::bigint,
      0
    );
  end if;
  if coalesce(v_ad_set_snapshot.snapshot_payload->>'daily_budget', '') ~ '^[0-9]+$' then
    v_ad_set_budget := nullif(
      (v_ad_set_snapshot.snapshot_payload->>'daily_budget')::bigint,
      0
    );
  end if;
  if coalesce(v_campaign_snapshot.snapshot_payload->>'lifetime_budget', '') ~ '^[0-9]+$' then
    v_campaign_lifetime_budget := nullif(
      (v_campaign_snapshot.snapshot_payload->>'lifetime_budget')::bigint,
      0
    );
  end if;
  if coalesce(v_ad_set_snapshot.snapshot_payload->>'lifetime_budget', '') ~ '^[0-9]+$' then
    v_ad_set_lifetime_budget := nullif(
      (v_ad_set_snapshot.snapshot_payload->>'lifetime_budget')::bigint,
      0
    );
  end if;
  if coalesce(v_ad_set_snapshot.snapshot_payload->>'start_time', '')
       ~ '^\d{4}-\d{2}-\d{2}T' then
    v_ad_set_start_time :=
      (v_ad_set_snapshot.snapshot_payload->>'start_time')::timestamptz;
  end if;
  if coalesce(v_ad_set_snapshot.snapshot_payload->>'end_time', '')
       ~ '^\d{4}-\d{2}-\d{2}T' then
    v_ad_set_end_time :=
      (v_ad_set_snapshot.snapshot_payload->>'end_time')::timestamptz;
  end if;

  v_contract_version := (v_plan.planned_payload->>'contract_version')::integer;
  v_budget_type := coalesce(v_plan.planned_payload->>'budget_type', 'DAILY');
  v_budget_owner_type := v_plan.planned_payload->>'budget_owner_type';

  if v_contract_version = 2 and v_budget_type = 'DAILY' then
    v_expected_budget := (v_plan.planned_payload->>'daily_budget_minor')::bigint;
    v_flex_spend_multiplier_bps := v_policy.standard_flex_spend_multiplier_bps;
  elsif v_contract_version = 3
    and v_budget_type = 'LIFETIME'
    and v_budget_owner_type = 'CAMPAIGN' then
    v_expected_budget :=
      (v_plan.planned_payload->>'lifetime_budget_minor')::bigint;
    v_expected_start_time :=
      (v_plan.planned_payload->>'start_time')::timestamptz;
    v_expected_end_time :=
      (v_plan.planned_payload->>'end_time')::timestamptz;
    v_flex_spend_multiplier_bps := 10000;
  else
    raise exception 'Unsupported launch budget contract for reconciliation';
  end if;

  v_matches := v_campaign_snapshot.id is not null
    and v_ad_set_snapshot.id is not null
    and v_creative_snapshot.id is not null
    and v_ad_snapshot.id is not null
    and v_campaign_snapshot.snapshot_payload->>'id'
      = v_campaign_binding.remote_object_id
    and v_ad_set_snapshot.snapshot_payload->>'id'
      = v_ad_set_binding.remote_object_id
    and v_campaign_status = 'ACTIVE'
    and v_ad_set_status = 'ACTIVE'
    and v_ad_set_snapshot.snapshot_payload->>'campaign_id'
      = v_campaign_binding.remote_object_id
    and (
      (
        v_structural_ad_count = 1
        and v_creative_snapshot.snapshot_payload->>'id'
          = v_creative_binding.remote_object_id
        and v_ad_snapshot.snapshot_payload->>'id'
          = v_ad_binding.remote_object_id
        and v_ad_status = 'ACTIVE'
        and v_ad_snapshot.snapshot_payload->>'campaign_id'
          = v_campaign_binding.remote_object_id
        and v_ad_snapshot.snapshot_payload->>'adset_id'
          = v_ad_set_binding.remote_object_id
        and coalesce(
          v_ad_snapshot.snapshot_payload#>>'{creative,id}',
          v_ad_snapshot.snapshot_payload->>'creative_id'
        ) = v_creative_binding.remote_object_id
      )
      or (
        v_structural_ad_count = 2
      and (
        select count(*)::integer
        from public.remote_object_bindings ad_binding
        join lateral (
          select s.*
          from public.meta_mutation_remote_snapshots s
          join public.mutation_plan_steps snapshot_step on snapshot_step.id = s.step_id
          where s.plan_id = v_plan.id
            and s.object_type = 'AD'
            and s.remote_object_id = ad_binding.remote_object_id
            and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
          order by snapshot_step.step_index desc, s.observed_at desc, s.created_at desc
          limit 1
        ) ad_snap on true
        where ad_binding.plan_id = v_plan.id
          and ad_binding.user_id = v_plan.user_id
          and ad_binding.platform_account_id = v_plan.platform_account_id
          and ad_binding.object_type = 'AD'
          and ad_binding.remote_object_id = any (v_ad_remote_ids)
          and coalesce(
            ad_snap.snapshot_payload->>'status',
            ad_snap.snapshot_payload->>'effective_status'
          ) = 'ACTIVE'
          and ad_snap.snapshot_payload->>'campaign_id'
            = v_campaign_binding.remote_object_id
          and ad_snap.snapshot_payload->>'adset_id'
            = v_ad_set_binding.remote_object_id
          and coalesce(
            ad_snap.snapshot_payload#>>'{creative,id}',
            ad_snap.snapshot_payload->>'creative_id'
          ) = any (v_creative_remote_ids)
      ) = 2
      and (
        select count(distinct coalesce(
          ad_snap.snapshot_payload#>>'{creative,id}',
          ad_snap.snapshot_payload->>'creative_id'
        ))::integer
        from public.remote_object_bindings ad_binding
        join lateral (
          select s.*
          from public.meta_mutation_remote_snapshots s
          join public.mutation_plan_steps snapshot_step on snapshot_step.id = s.step_id
          where s.plan_id = v_plan.id
            and s.object_type = 'AD'
            and s.remote_object_id = ad_binding.remote_object_id
            and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
          order by snapshot_step.step_index desc, s.observed_at desc, s.created_at desc
          limit 1
        ) ad_snap on true
        where ad_binding.plan_id = v_plan.id
          and ad_binding.object_type = 'AD'
          and ad_binding.remote_object_id = any (v_ad_remote_ids)
      ) = 2
      )
    )
    and (
      (
        v_contract_version = 2
        and v_budget_type = 'DAILY'
        and (
          (v_budget_owner_type = 'CAMPAIGN'
            and v_campaign_budget = v_expected_budget
            and v_ad_set_budget is null)
          or
          (v_budget_owner_type = 'AD_SET'
            and v_ad_set_budget = v_expected_budget
            and v_campaign_budget is null)
        )
      )
      or
      (
        v_contract_version = 3
        and v_budget_type = 'LIFETIME'
        and v_budget_owner_type = 'CAMPAIGN'
        and v_campaign_budget is null
        and v_campaign_lifetime_budget = v_expected_budget
        and v_ad_set_budget is null
        and v_ad_set_lifetime_budget is null
        and v_ad_set_start_time = v_expected_start_time
        and v_ad_set_end_time = v_expected_end_time
      )
    );

  if not v_matches then
    update public.mutation_plan_steps
    set status = 'COMPENSATION_REQUIRED',
        dispatch_state = 'READ_BACK',
        dispatch_started_at = coalesce(dispatch_started_at, now()),
        remote_applied_at = coalesce(remote_applied_at, now()),
        error_class = 'RECONCILIATION',
        error_code = 'launch_chain_mismatch',
        updated_at = now()
    where id = v_step.id;

    update public.mutation_executions
    set status = 'COMPENSATION_REQUIRED',
        finished_at = now(),
        error_class = 'RECONCILIATION',
        error_code = 'launch_chain_mismatch'
    where id = v_execution.id;

    update public.mutation_plans
    set status = 'COMPENSATION_REQUIRED',
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        error_class = 'RECONCILIATION',
        blocked_reason = 'launch_chain_mismatch',
        updated_at = now()
    where id = v_plan.id;

    perform public.append_meta_kill_switch_state(
      'ACCOUNT',
      v_plan.user_id,
      v_plan.platform_account_id,
      null,
      'PAUSE_MANAGED',
      'Launch-chain reconciliation mismatch requires safe pause',
      'SYSTEM',
      'meta-launch-reconciler'
    );

    perform public.release_meta_account_operation(
      v_plan.platform_account_id, v_plan.user_id, p_lease_token
    );

    update public.platform_accounts pa
    set automation_executor_status = 'error',
        automation_executor_error_code = 'launch_chain_mismatch',
        automation_executor_last_run_at = now(),
        updated_at = now()
    where pa.id = v_plan.platform_account_id
      and pa.user_id = v_plan.user_id;

    perform public.append_meta_mutation_audit_event(
      v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
      v_plan.id, v_step.id, v_execution.id, 'RECONCILER',
      v_execution.worker_id, 'MUTATION_EXECUTION_FAILED',
      jsonb_build_object('plan_status', 'RECONCILING'),
      jsonb_build_object('expected_status', 'ACTIVE'),
      jsonb_build_object(
        'campaign_snapshot_id', v_campaign_snapshot.id,
        'ad_set_snapshot_id', v_ad_set_snapshot.id,
        'creative_snapshot_id', v_creative_snapshot.id,
        'ad_snapshot_id', v_ad_snapshot.id
      ),
      jsonb_build_object('plan_status', 'COMPENSATION_REQUIRED'),
      jsonb_build_object('reason', 'launch_chain_mismatch'),
      'meta', null, null, null, 'RECONCILIATION', now()
    );

    return query select
      'MISMATCH'::text, v_plan.id, null::uuid, v_latest_snapshot_id;
    return;
  end if;

  insert into public.campaigns (
    user_id, platform_account_id, platform_campaign_id, name, status,
    effective_status, objective, daily_budget_minor, lifetime_budget_minor,
    bid_strategy, special_ad_categories, platform_updated_time,
    last_seen_at, last_seen_sync_id, is_current, updated_at
  ) values (
    v_plan.user_id,
    v_plan.platform_account_id,
    v_campaign_binding.remote_object_id,
    coalesce(
      nullif(v_campaign_snapshot.snapshot_payload->>'name', ''),
      v_plan.planned_payload#>>'{campaign,name}'
    ),
    'ACTIVE',
    coalesce(v_campaign_snapshot.snapshot_payload->>'effective_status', 'ACTIVE'),
    coalesce(
      v_campaign_snapshot.snapshot_payload->>'objective',
      v_plan.planned_payload->>'objective'
    ),
    v_campaign_budget,
    v_campaign_lifetime_budget,
    v_campaign_snapshot.snapshot_payload->>'bid_strategy',
    case
      when jsonb_typeof(v_campaign_snapshot.snapshot_payload->'special_ad_categories') = 'array'
        then v_campaign_snapshot.snapshot_payload->'special_ad_categories'
      else '[]'::jsonb
    end,
    case
      when coalesce(v_campaign_snapshot.snapshot_payload->>'updated_time', '')
        ~ '^\d{4}-\d{2}-\d{2}T'
        then (v_campaign_snapshot.snapshot_payload->>'updated_time')::timestamptz
      else null
    end,
    now(),
    v_plan.source_marketing_sync_id,
    true,
    now()
  ) on conflict (platform_account_id, platform_campaign_id)
  do update set
    user_id = excluded.user_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    objective = excluded.objective,
    daily_budget_minor = excluded.daily_budget_minor,
    lifetime_budget_minor = excluded.lifetime_budget_minor,
    bid_strategy = excluded.bid_strategy,
    special_ad_categories = excluded.special_ad_categories,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true,
    updated_at = now()
  returning id into v_campaign_id;

  insert into public.ad_groups (
    user_id, platform_account_id, campaign_id, platform_ad_group_id,
    name, status, effective_status, optimization_goal, billing_event,
    destination_type, daily_budget_minor, lifetime_budget_minor,
    bid_amount_minor, bid_strategy, start_time, end_time,
    platform_updated_time, last_seen_at, last_seen_sync_id, is_current,
    updated_at
  ) values (
    v_plan.user_id,
    v_plan.platform_account_id,
    v_campaign_id,
    v_ad_set_binding.remote_object_id,
    coalesce(
      nullif(v_ad_set_snapshot.snapshot_payload->>'name', ''),
      v_plan.planned_payload#>>'{ad_set,name}'
    ),
    'ACTIVE',
    coalesce(v_ad_set_snapshot.snapshot_payload->>'effective_status', 'ACTIVE'),
    v_ad_set_snapshot.snapshot_payload->>'optimization_goal',
    v_ad_set_snapshot.snapshot_payload->>'billing_event',
    v_ad_set_snapshot.snapshot_payload->>'destination_type',
    v_ad_set_budget,
    v_ad_set_lifetime_budget,
    null,
    null,
    case
      when coalesce(v_ad_set_snapshot.snapshot_payload->>'start_time', '')
        ~ '^\d{4}-\d{2}-\d{2}T'
        then (v_ad_set_snapshot.snapshot_payload->>'start_time')::timestamptz
      else null
    end,
    case
      when coalesce(v_ad_set_snapshot.snapshot_payload->>'end_time', '')
        ~ '^\d{4}-\d{2}-\d{2}T'
        then (v_ad_set_snapshot.snapshot_payload->>'end_time')::timestamptz
      else null
    end,
    case
      when coalesce(v_ad_set_snapshot.snapshot_payload->>'updated_time', '')
        ~ '^\d{4}-\d{2}-\d{2}T'
        then (v_ad_set_snapshot.snapshot_payload->>'updated_time')::timestamptz
      else null
    end,
    now(),
    v_plan.source_marketing_sync_id,
    true,
    now()
  ) on conflict (platform_account_id, platform_ad_group_id)
  do update set
    user_id = excluded.user_id,
    campaign_id = excluded.campaign_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    optimization_goal = excluded.optimization_goal,
    billing_event = excluded.billing_event,
    destination_type = excluded.destination_type,
    daily_budget_minor = excluded.daily_budget_minor,
    lifetime_budget_minor = excluded.lifetime_budget_minor,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true,
    updated_at = now()
  returning id into v_ad_group_id;

  insert into public.creatives (
    user_id, platform_account_id, platform_creative_id, source, name, type,
    content, generated_by_ai, title, body, call_to_action_type,
    thumbnail_url, effective_object_story_id,
    effective_instagram_media_id, instagram_permalink_url, object_type,
    platform_status, platform_updated_time, last_seen_at,
    last_seen_sync_id, is_current, updated_at
  ) values (
    v_plan.user_id,
    v_plan.platform_account_id,
    v_creative_binding.remote_object_id,
    'meta',
    coalesce(
      nullif(v_creative_snapshot.snapshot_payload->>'name', ''),
      v_plan.planned_payload#>>'{creative,name}'
    ),
    coalesce(v_creative_snapshot.snapshot_payload->>'object_type', 'IMAGE'),
    v_creative_snapshot.snapshot_payload,
    false,
    v_creative_snapshot.snapshot_payload->>'title',
    v_creative_snapshot.snapshot_payload->>'body',
    v_creative_snapshot.snapshot_payload->>'call_to_action_type',
    v_creative_snapshot.snapshot_payload->>'thumbnail_url',
    v_creative_snapshot.snapshot_payload->>'object_story_id',
    v_creative_snapshot.snapshot_payload->>'effective_instagram_media_id',
    v_creative_snapshot.snapshot_payload->>'instagram_permalink_url',
    v_creative_snapshot.snapshot_payload->>'object_type',
    v_creative_snapshot.snapshot_payload->>'status',
    case
      when coalesce(v_creative_snapshot.snapshot_payload->>'updated_time', '')
        ~ '^\d{4}-\d{2}-\d{2}T'
        then (v_creative_snapshot.snapshot_payload->>'updated_time')::timestamptz
      else null
    end,
    now(),
    v_plan.source_marketing_sync_id,
    true,
    now()
  ) on conflict (platform_account_id, platform_creative_id)
    where source = 'meta'
  do update set
    user_id = excluded.user_id,
    name = excluded.name,
    type = excluded.type,
    content = excluded.content,
    title = excluded.title,
    body = excluded.body,
    call_to_action_type = excluded.call_to_action_type,
    thumbnail_url = excluded.thumbnail_url,
    effective_object_story_id = excluded.effective_object_story_id,
    effective_instagram_media_id = excluded.effective_instagram_media_id,
    instagram_permalink_url = excluded.instagram_permalink_url,
    object_type = excluded.object_type,
    platform_status = excluded.platform_status,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true,
    updated_at = now()
  returning id into v_creative_id;

  insert into public.ads (
    user_id, platform_account_id, ad_group_id, platform_ad_id, name,
    status, effective_status, creative_id, platform_creative_id,
    platform_updated_time, last_seen_at, last_seen_sync_id, is_current,
    updated_at
  ) values (
    v_plan.user_id,
    v_plan.platform_account_id,
    v_ad_group_id,
    v_ad_binding.remote_object_id,
    coalesce(
      nullif(v_ad_snapshot.snapshot_payload->>'name', ''),
      v_plan.planned_payload#>>'{ad,name}'
    ),
    'ACTIVE',
    coalesce(v_ad_snapshot.snapshot_payload->>'effective_status', 'ACTIVE'),
    v_creative_id,
    v_creative_binding.remote_object_id,
    case
      when coalesce(v_ad_snapshot.snapshot_payload->>'updated_time', '')
        ~ '^\d{4}-\d{2}-\d{2}T'
        then (v_ad_snapshot.snapshot_payload->>'updated_time')::timestamptz
      else null
    end,
    now(),
    v_plan.source_marketing_sync_id,
    true,
    now()
  ) on conflict (platform_account_id, platform_ad_id)
  do update set
    user_id = excluded.user_id,
    ad_group_id = excluded.ad_group_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    creative_id = excluded.creative_id,
    platform_creative_id = excluded.platform_creative_id,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true,
    updated_at = now()
  returning id into v_ad_id;

  v_canonical_scope_key := 'campaign:' || v_campaign_binding.remote_object_id;

  insert into public.automation_targets (
    user_id, platform_account_id, target_type, target_key,
    platform_object_id, campaign_scope_key, budget_owner_type,
    budget_owner_key, campaign_id, ad_group_id, ad_id, status,
    last_successful_mutation_at, last_reconciled_at, updated_at
  ) values (
    v_plan.user_id, v_plan.platform_account_id, 'CAMPAIGN',
    v_canonical_scope_key, v_campaign_binding.remote_object_id,
    v_canonical_scope_key,
    case when v_budget_owner_type = 'CAMPAIGN' then 'CAMPAIGN' else null end,
    case when v_budget_owner_type = 'CAMPAIGN' then v_canonical_scope_key else null end,
    v_campaign_id, null, null, 'MANAGED', now(), now(), now()
  ) on conflict (platform_account_id, target_type, platform_object_id)
  do update set
    target_key = excluded.target_key,
    campaign_scope_key = excluded.campaign_scope_key,
    budget_owner_type = excluded.budget_owner_type,
    budget_owner_key = excluded.budget_owner_key,
    campaign_id = excluded.campaign_id,
    ad_group_id = null,
    ad_id = null,
    status = 'MANAGED',
    last_successful_mutation_at = now(),
    last_reconciled_at = now(),
    row_version = public.automation_targets.row_version + 1,
    updated_at = now()
  returning id into v_campaign_target_id;

  insert into public.automation_targets (
    user_id, platform_account_id, target_type, target_key,
    platform_object_id, campaign_scope_key, budget_owner_type,
    budget_owner_key, campaign_id, ad_group_id, ad_id, status,
    last_successful_mutation_at, last_reconciled_at, updated_at
  ) values (
    v_plan.user_id, v_plan.platform_account_id, 'AD_SET',
    'adset:' || v_ad_set_binding.remote_object_id,
    v_ad_set_binding.remote_object_id, v_canonical_scope_key,
    case when v_budget_owner_type = 'AD_SET' then 'AD_SET' else null end,
    case when v_budget_owner_type = 'AD_SET'
      then 'adset:' || v_ad_set_binding.remote_object_id else null end,
    v_campaign_id, v_ad_group_id, null, 'MANAGED', now(), now(), now()
  ) on conflict (platform_account_id, target_type, platform_object_id)
  do update set
    target_key = excluded.target_key,
    campaign_scope_key = excluded.campaign_scope_key,
    budget_owner_type = excluded.budget_owner_type,
    budget_owner_key = excluded.budget_owner_key,
    campaign_id = excluded.campaign_id,
    ad_group_id = excluded.ad_group_id,
    ad_id = null,
    status = 'MANAGED',
    last_successful_mutation_at = now(),
    last_reconciled_at = now(),
    row_version = public.automation_targets.row_version + 1,
    updated_at = now()
  returning id into v_ad_set_target_id;

  insert into public.automation_targets (
    user_id, platform_account_id, target_type, target_key,
    platform_object_id, campaign_scope_key, budget_owner_type,
    budget_owner_key, campaign_id, ad_group_id, ad_id, status,
    last_successful_mutation_at, last_reconciled_at, updated_at
  ) values (
    v_plan.user_id, v_plan.platform_account_id, 'AD',
    'ad:' || v_ad_binding.remote_object_id,
    v_ad_binding.remote_object_id, v_canonical_scope_key,
    null, null, v_campaign_id, v_ad_group_id, v_ad_id,
    'MANAGED', now(), now(), now()
  ) on conflict (platform_account_id, target_type, platform_object_id)
  do update set
    target_key = excluded.target_key,
    campaign_scope_key = excluded.campaign_scope_key,
    budget_owner_type = null,
    budget_owner_key = null,
    campaign_id = excluded.campaign_id,
    ad_group_id = excluded.ad_group_id,
    ad_id = excluded.ad_id,
    status = 'MANAGED',
    last_successful_mutation_at = now(),
    last_reconciled_at = now(),
    row_version = public.automation_targets.row_version + 1,
    updated_at = now()
  returning id into v_ad_target_id;

  if v_structural_ad_count = 2 then
    for v_loop_binding in
      select binding.*
      from public.remote_object_bindings binding
      where binding.plan_id = v_plan.id
        and binding.user_id = v_plan.user_id
        and binding.platform_account_id = v_plan.platform_account_id
        and binding.object_type = 'CREATIVE'
        and binding.remote_object_id = any (v_creative_remote_ids)
        and binding.id <> v_creative_binding.id
      order by binding.bound_at, binding.id
    loop
      select s.* into v_loop_snapshot
      from public.meta_mutation_remote_snapshots s
      join public.mutation_plan_steps snapshot_step on snapshot_step.id = s.step_id
      where s.plan_id = v_plan.id
        and s.object_type = 'CREATIVE'
        and s.remote_object_id = v_loop_binding.remote_object_id
        and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
      order by snapshot_step.step_index desc, s.observed_at desc, s.created_at desc
      limit 1;

      insert into public.creatives (
        user_id, platform_account_id, platform_creative_id, source, name, type,
        content, generated_by_ai, title, body, call_to_action_type,
        thumbnail_url, effective_object_story_id,
        effective_instagram_media_id, instagram_permalink_url, object_type,
        platform_status, platform_updated_time, last_seen_at,
        last_seen_sync_id, is_current, updated_at
      ) values (
        v_plan.user_id,
        v_plan.platform_account_id,
        v_loop_binding.remote_object_id,
        'meta',
        coalesce(
          nullif(v_loop_snapshot.snapshot_payload->>'name', ''),
          v_plan.planned_payload#>>'{creatives,1,name}',
          v_plan.planned_payload#>>'{creative,name}'
        ),
        coalesce(v_loop_snapshot.snapshot_payload->>'object_type', 'IMAGE'),
        v_loop_snapshot.snapshot_payload,
        false,
        v_loop_snapshot.snapshot_payload->>'title',
        v_loop_snapshot.snapshot_payload->>'body',
        v_loop_snapshot.snapshot_payload->>'call_to_action_type',
        v_loop_snapshot.snapshot_payload->>'thumbnail_url',
        v_loop_snapshot.snapshot_payload->>'object_story_id',
        v_loop_snapshot.snapshot_payload->>'effective_instagram_media_id',
        v_loop_snapshot.snapshot_payload->>'instagram_permalink_url',
        v_loop_snapshot.snapshot_payload->>'object_type',
        v_loop_snapshot.snapshot_payload->>'status',
        case
          when coalesce(v_loop_snapshot.snapshot_payload->>'updated_time', '')
            ~ '^\d{4}-\d{2}-\d{2}T'
            then (v_loop_snapshot.snapshot_payload->>'updated_time')::timestamptz
          else null
        end,
        now(),
        v_plan.source_marketing_sync_id,
        true,
        now()
      ) on conflict (platform_account_id, platform_creative_id)
        where source = 'meta'
      do update set
        user_id = excluded.user_id,
        name = excluded.name,
        type = excluded.type,
        content = excluded.content,
        title = excluded.title,
        body = excluded.body,
        call_to_action_type = excluded.call_to_action_type,
        thumbnail_url = excluded.thumbnail_url,
        effective_object_story_id = excluded.effective_object_story_id,
        effective_instagram_media_id = excluded.effective_instagram_media_id,
        instagram_permalink_url = excluded.instagram_permalink_url,
        object_type = excluded.object_type,
        platform_status = excluded.platform_status,
        platform_updated_time = excluded.platform_updated_time,
        last_seen_at = excluded.last_seen_at,
        last_seen_sync_id = excluded.last_seen_sync_id,
        is_current = true,
        updated_at = now()
      returning id into v_loop_creative_id;

      update public.remote_object_bindings
      set local_creative_id = v_loop_creative_id,
          reconciled_at = now()
      where id = v_loop_binding.id;
    end loop;

    for v_loop_binding in
      select binding.*
      from public.remote_object_bindings binding
      where binding.plan_id = v_plan.id
        and binding.user_id = v_plan.user_id
        and binding.platform_account_id = v_plan.platform_account_id
        and binding.object_type = 'AD'
        and binding.remote_object_id = any (v_ad_remote_ids)
        and binding.id <> v_ad_binding.id
      order by binding.bound_at, binding.id
    loop
      select s.* into v_loop_snapshot
      from public.meta_mutation_remote_snapshots s
      join public.mutation_plan_steps snapshot_step on snapshot_step.id = s.step_id
      where s.plan_id = v_plan.id
        and s.object_type = 'AD'
        and s.remote_object_id = v_loop_binding.remote_object_id
        and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
      order by snapshot_step.step_index desc, s.observed_at desc, s.created_at desc
      limit 1;

      v_loop_creative_remote := coalesce(
        v_loop_snapshot.snapshot_payload#>>'{creative,id}',
        v_loop_snapshot.snapshot_payload->>'creative_id'
      );

      select c.id into v_loop_creative_id
      from public.creatives c
      where c.platform_account_id = v_plan.platform_account_id
        and c.platform_creative_id = v_loop_creative_remote
        and c.source = 'meta'
        and c.is_current
      limit 1;

      insert into public.ads (
        user_id, platform_account_id, ad_group_id, platform_ad_id, name,
        status, effective_status, creative_id, platform_creative_id,
        platform_updated_time, last_seen_at, last_seen_sync_id, is_current,
        updated_at
      ) values (
        v_plan.user_id,
        v_plan.platform_account_id,
        v_ad_group_id,
        v_loop_binding.remote_object_id,
        coalesce(
          nullif(v_loop_snapshot.snapshot_payload->>'name', ''),
          v_plan.planned_payload#>>'{ads,1,name}',
          v_plan.planned_payload#>>'{ad,name}'
        ),
        'ACTIVE',
        coalesce(v_loop_snapshot.snapshot_payload->>'effective_status', 'ACTIVE'),
        v_loop_creative_id,
        v_loop_creative_remote,
        case
          when coalesce(v_loop_snapshot.snapshot_payload->>'updated_time', '')
            ~ '^\d{4}-\d{2}-\d{2}T'
            then (v_loop_snapshot.snapshot_payload->>'updated_time')::timestamptz
          else null
        end,
        now(),
        v_plan.source_marketing_sync_id,
        true,
        now()
      ) on conflict (platform_account_id, platform_ad_id)
      do update set
        user_id = excluded.user_id,
        ad_group_id = excluded.ad_group_id,
        name = excluded.name,
        status = excluded.status,
        effective_status = excluded.effective_status,
        creative_id = excluded.creative_id,
        platform_creative_id = excluded.platform_creative_id,
        platform_updated_time = excluded.platform_updated_time,
        last_seen_at = excluded.last_seen_at,
        last_seen_sync_id = excluded.last_seen_sync_id,
        is_current = true,
        updated_at = now()
      returning id into v_loop_ad_id;

      insert into public.automation_targets (
        user_id, platform_account_id, target_type, target_key,
        platform_object_id, campaign_scope_key, budget_owner_type,
        budget_owner_key, campaign_id, ad_group_id, ad_id, status,
        last_successful_mutation_at, last_reconciled_at, updated_at
      ) values (
        v_plan.user_id, v_plan.platform_account_id, 'AD',
        'ad:' || v_loop_binding.remote_object_id,
        v_loop_binding.remote_object_id, v_canonical_scope_key,
        null, null, v_campaign_id, v_ad_group_id, v_loop_ad_id,
        'MANAGED', now(), now(), now()
      ) on conflict (platform_account_id, target_type, platform_object_id)
      do update set
        target_key = excluded.target_key,
        campaign_scope_key = excluded.campaign_scope_key,
        budget_owner_type = null,
        budget_owner_key = null,
        campaign_id = excluded.campaign_id,
        ad_group_id = excluded.ad_group_id,
        ad_id = excluded.ad_id,
        status = 'MANAGED',
        last_successful_mutation_at = now(),
        last_reconciled_at = now(),
        row_version = public.automation_targets.row_version + 1,
        updated_at = now()
      returning id into v_loop_ad_target_id;

      update public.remote_object_bindings
      set local_campaign_id = v_campaign_id,
          local_ad_group_id = v_ad_group_id,
          local_creative_id = v_loop_creative_id,
          local_ad_id = v_loop_ad_id,
          reconciled_at = now()
      where id = v_loop_binding.id;
    end loop;
  end if;

  update public.remote_object_bindings
  set local_campaign_id = v_campaign_id,
      reconciled_at = now()
  where id = v_campaign_binding.id;

  update public.remote_object_bindings
  set local_campaign_id = v_campaign_id,
      local_ad_group_id = v_ad_group_id,
      reconciled_at = now()
  where id = v_ad_set_binding.id;

  update public.remote_object_bindings
  set local_creative_id = v_creative_id,
      reconciled_at = now()
  where id = v_creative_binding.id;

  update public.remote_object_bindings
  set local_campaign_id = v_campaign_id,
      local_ad_group_id = v_ad_group_id,
      local_creative_id = v_creative_id,
      local_ad_id = v_ad_id,
      reconciled_at = now()
  where id = v_ad_binding.id;

  -- IMAGE bindings are canonically represented by brand_assets.meta_image_hash,
  -- which the Executor sets when the upload step completes. They therefore
  -- need no projection UUID, but still participate in reconciliation closure.
  update public.remote_object_bindings image_binding
  set reconciled_at = now()
  where image_binding.plan_id = v_plan.id
    and image_binding.user_id = v_plan.user_id
    and image_binding.platform_account_id = v_plan.platform_account_id
    and image_binding.object_type = 'IMAGE'
    and image_binding.reconciled_at is null;

  if v_budget_owner_type = 'CAMPAIGN' then
    v_canonical_budget_key := v_canonical_scope_key;
    v_budget_target_id := v_campaign_target_id;
  else
    v_canonical_budget_key := 'adset:' || v_ad_set_binding.remote_object_id;
    v_budget_target_id := v_ad_set_target_id;
  end if;

  -- Replace, rather than duplicate, the provisional launch reservation. The
  -- account, policy and exposure snapshot rows are already locked above, and
  -- the account execution lease serializes writers for this Meta account.
  delete from public.daily_budget_exposures exposure
  where exposure.plan_id = v_plan.id
    and exposure.user_id = v_plan.user_id
    and exposure.platform_account_id = v_plan.platform_account_id
    and exposure.policy_id = v_plan.policy_id
    and exposure.snapshot_id = v_exposure_snapshot.id
    and exposure.campaign_scope_key
      = v_plan.planned_payload->>'provisional_campaign_scope_key'
    and exposure.budget_owner_key
      = v_plan.planned_payload->>'provisional_budget_owner_key';

  if not found then
    raise exception 'Provisional launch exposure reservation is missing';
  end if;

  if v_contract_version = 3 and v_budget_type = 'LIFETIME' then
    select reserved.account_reserved_exposure_minor
      into v_reserved_exposure_minor
    from public.reserve_meta_lifetime_budget_exposure_v3(
      v_plan.user_id,
      v_plan.platform_account_id,
      v_plan.policy_id,
      v_exposure_snapshot.id,
      v_plan.id,
      v_budget_target_id,
      v_exposure_snapshot.account_day,
      v_canonical_scope_key,
      v_canonical_budget_key,
      'EUR',
      v_expected_budget,
      'RECONCILIATION'
    ) reserved;
  else
    select reserved.account_reserved_exposure_minor
      into v_reserved_exposure_minor
    from public.reserve_meta_daily_budget_exposure(
      v_plan.user_id,
      v_plan.platform_account_id,
      v_plan.policy_id,
      v_exposure_snapshot.id,
      v_plan.id,
      v_budget_target_id,
      v_exposure_snapshot.account_day,
      v_canonical_scope_key,
      v_canonical_budget_key,
      v_budget_owner_type,
      false,
      'EUR',
      v_expected_budget,
      v_flex_spend_multiplier_bps,
      'RECONCILIATION'
    ) reserved;
  end if;

  select mps.* into v_last_mutate_step
  from public.mutation_plan_steps mps
  where mps.plan_id = v_plan.id
    and mps.operation in ('CREATE', 'UPDATE', 'COMPENSATE')
    and mps.status in ('REMOTE_APPLIED', 'RECONCILED')
  order by mps.step_index desc
  limit 1;

  update public.mutation_plan_steps
  set status = 'RECONCILED',
      dispatch_state = 'RECONCILED',
      dispatch_started_at = coalesce(dispatch_started_at, now()),
      remote_applied_at = coalesce(remote_applied_at, now()),
      completed_at = now(),
      error_class = null,
      error_code = null,
      updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = 'SUCCEEDED',
      finished_at = now(),
      last_heartbeat_at = now(),
      error_class = null,
      error_code = null
  where id = v_execution.id;

  update public.mutation_plans
  set status = 'SUCCEEDED',
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = now(),
      blocked_reason = null,
      error_class = null,
      updated_at = now()
  where id = v_plan.id;

  perform public.release_meta_account_operation(
    v_plan.platform_account_id, v_plan.user_id, p_lease_token
  );

  update public.platform_accounts pa
  set automation_executor_status = 'success',
      automation_executor_error_code = null,
      automation_executor_last_run_at = now(),
      automation_executor_last_success_at = now(),
      automation_executor_last_plan_id = v_plan.id,
      updated_at = now()
  where pa.id = v_plan.platform_account_id
    and pa.user_id = v_plan.user_id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'RECONCILER',
    v_execution.worker_id, 'MUTATION_PLAN_RECONCILED',
    jsonb_build_object('plan_status', 'RECONCILING'),
    jsonb_build_object(
      'expected_status', 'ACTIVE',
      'budget_owner_type', v_budget_owner_type,
      'budget_type', v_budget_type
    ) || case
      when v_budget_type = 'DAILY' then
        jsonb_build_object('daily_budget_minor', v_expected_budget)
      else
        jsonb_build_object(
          'lifetime_budget_minor', v_expected_budget,
          'start_time', v_expected_start_time,
          'end_time', v_expected_end_time
        )
    end,
    jsonb_build_object(
      'campaign_snapshot_id', v_campaign_snapshot.id,
      'ad_set_snapshot_id', v_ad_set_snapshot.id,
      'creative_snapshot_id', v_creative_snapshot.id,
      'ad_snapshot_id', v_ad_snapshot.id
    ),
    jsonb_build_object(
      'plan_status', 'SUCCEEDED',
      'campaign_id', v_campaign_id,
      'ad_group_id', v_ad_group_id,
      'creative_id', v_creative_id,
      'ad_id', v_ad_id,
      'reserved_exposure_minor', v_reserved_exposure_minor
    ),
    jsonb_build_object(
      'campaign_target_id', v_campaign_target_id,
      'ad_set_target_id', v_ad_set_target_id,
      'ad_target_id', v_ad_target_id,
      'canonical_campaign_scope_key', v_canonical_scope_key,
      'canonical_budget_owner_key', v_canonical_budget_key
    ),
    'meta', null, null, v_last_mutate_step.remote_request_id,
    null, now()
  );

  return query select
    'SUCCEEDED'::text, v_plan.id, null::uuid, v_latest_snapshot_id;
end;
$$;

revoke all on function public.reconcile_meta_launch_mutation_plan(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.reconcile_meta_launch_mutation_plan(
  uuid, uuid, uuid
) to service_role;

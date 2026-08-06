-- Fix organic Beitrag-Push Meta payloads and stuck/failed plans.
-- 1) Ad set: destination_type=ON_POST for engagement boosts.
-- 2) Creative: never attach top-level CTA/link on organic object_story_id boosts.
-- 3) Repair existing plan payloads/steps and re-queue FAILED/stuck plans.
-- 4) Surface plan/step errors in list_meta_organic_boost_campaigns.
-- 5) Permanent preflight misses become BLOCKED with reason (not silent PENDING).

begin;

create or replace function public.materialize_meta_organic_boost_plan(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_content_candidate_id uuid,
  p_settings_id uuid,
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
  v_settings public.meta_boost_settings%rowtype;
  v_candidate public.meta_content_candidates%rowtype;
  v_override public.meta_content_boost_overrides%rowtype;
  v_page public.meta_assets%rowtype;
  v_domain public.allowed_domains%rowtype;
  v_kill_mode text;
  v_budget_mode text;
  v_daily_budget_minor bigint;
  v_lifetime_budget_minor bigint;
  v_duration_days integer;
  v_asset_included boolean;
  v_asset_daily_budget_minor bigint;
  v_asset_duration_days integer;
  v_budget_owner_type text;
  v_cta_type text;
  v_destination_url text;
  v_destination_host text;
  v_object_story_id text;
  v_boost_source text;
  v_instagram_user_id text;
  v_source_instagram_media_id text;
  v_ig_asset public.meta_assets%rowtype;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_campaign_payload jsonb;
  v_ad_set_payload jsonb;
  v_creative_payload jsonb;
  v_ad_payload jsonb;
  v_canonical_inputs jsonb;
  v_planned_payload jsonb;
  v_payload_hash text;
  v_idempotency_key text;
  v_provisional_scope_key text;
  v_provisional_budget_key text;
  v_plan_id uuid := gen_random_uuid();
  v_existing_plan public.mutation_plans%rowtype;
  v_existing_link public.meta_organic_boost_links%rowtype;
  v_exposure_minor bigint;
  v_require_manual_approval boolean;
  v_index integer := 0;
  v_previous_step uuid;
  v_step_validate_campaign uuid := gen_random_uuid();
  v_step_create_campaign uuid := gen_random_uuid();
  v_step_read_campaign_paused uuid := gen_random_uuid();
  v_step_validate_ad_set uuid := gen_random_uuid();
  v_step_create_ad_set uuid := gen_random_uuid();
  v_step_read_ad_set_paused uuid := gen_random_uuid();
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
  v_request jsonb;
  v_tracking_suffix text;
  v_campaign_name text;
  v_ad_set_name text;
  v_creative_name text;
  v_ad_name text;
begin
  if p_planned_at is null then
    raise exception 'Organic boost planned_at is required';
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
    and pa.marketing_currency = 'EUR'
  for share;

  if not found then
    raise exception 'Active EUR Meta account is required';
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
    raise exception 'Valid READ_SYNC lease is required for organic boost';
  end if;

  select policy.* into v_policy
  from public.automation_policies policy
  where policy.id = p_policy_id
    and policy.user_id = p_user_id
    and policy.platform_account_id = p_platform_account_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.allow_new_launches
    and policy.allow_status_changes
  for share;

  if not found then
    raise exception 'Active launch-enabled policy is required';
  end if;

  -- Identity is the snapshot id from the planner. Do not require the current
  -- policy/sync to match: Beitrag-Push reuses the latest COMPLETE snapshot when
  -- the exact marketing sync has none yet (or the policy was rotated).
  select snapshot.* into v_snapshot
  from public.daily_budget_exposure_snapshots snapshot
  where snapshot.id = p_snapshot_id
    and snapshot.user_id = p_user_id
    and snapshot.platform_account_id = p_platform_account_id
    and snapshot.status = 'COMPLETE'
    and snapshot.currency = 'EUR'
  for share;

  if not found then
    raise exception 'Complete exposure snapshot is required';
  end if;

  select settings.* into v_settings
  from public.meta_boost_settings settings
  where settings.id = p_settings_id
    and settings.user_id = p_user_id
    and settings.platform_account_id = p_platform_account_id
    and settings.is_current
    and settings.enabled
  for share;

  if not found then
    raise exception 'Enabled current boost settings are required';
  end if;

  select candidate.* into v_candidate
  from public.meta_content_candidates candidate
  where candidate.id = p_content_candidate_id
    and candidate.user_id = p_user_id
    and candidate.platform_account_id = p_platform_account_id
  for update;

  if not found then
    raise exception 'Content candidate not found';
  end if;

  select override_row.* into v_override
  from public.meta_content_boost_overrides override_row
  where override_row.content_candidate_id = p_content_candidate_id
    and override_row.user_id = p_user_id
    and override_row.platform_account_id = p_platform_account_id;

  if found and v_override.mode = 'SKIP' then
    return jsonb_build_object(
      'outcome', 'SKIPPED',
      'reason', 'candidate_override_skip',
      'content_candidate_id', p_content_candidate_id
    );
  end if;

  if v_settings.source_filter = 'facebook' and v_candidate.source <> 'facebook' then
    return jsonb_build_object(
      'outcome', 'SKIPPED',
      'reason', 'source_filter_facebook',
      'content_candidate_id', p_content_candidate_id
    );
  end if;

  if v_settings.source_filter = 'instagram' and v_candidate.source <> 'instagram' then
    return jsonb_build_object(
      'outcome', 'SKIPPED',
      'reason', 'source_filter_instagram',
      'content_candidate_id', p_content_candidate_id
    );
  end if;

  -- Facebook uses page_post object_story_id. Instagram uses source_instagram_media_id
  -- plus the linked page (object_id) and Instagram business user id.
  v_boost_source := v_candidate.source;
  v_instagram_user_id := null;
  v_source_instagram_media_id := null;

  if v_candidate.source = 'facebook' then
    if v_candidate.meta_content_id !~ '^[0-9]{5,}_[0-9]{5,}$' then
      return jsonb_build_object(
        'outcome', 'SKIPPED',
        'reason', 'unsupported_object_story_id',
        'content_candidate_id', p_content_candidate_id,
        'source', v_candidate.source
      );
    end if;

    v_object_story_id := v_candidate.meta_content_id;

    select page_asset.* into v_page
    from public.meta_assets page_asset
    where page_asset.id = v_candidate.meta_asset_id
      and page_asset.user_id = p_user_id
      and page_asset.platform_account_id = p_platform_account_id
      and page_asset.asset_type = 'facebook_page';

    if not found then
      raise exception 'Facebook page asset is required for organic boost';
    end if;

    if split_part(v_object_story_id, '_', 1) <> v_page.meta_asset_id then
      raise exception 'object_story_id does not belong to the candidate page';
    end if;
  elsif v_candidate.source = 'instagram' then
    if v_candidate.meta_content_id !~ '^[0-9]{5,}$' then
      return jsonb_build_object(
        'outcome', 'SKIPPED',
        'reason', 'unsupported_instagram_media_id',
        'content_candidate_id', p_content_candidate_id,
        'source', v_candidate.source
      );
    end if;

    -- Reuse object_story_id column as the boost identity for approvals/links.
    v_object_story_id := v_candidate.meta_content_id;
    v_source_instagram_media_id := v_candidate.meta_content_id;

    select ig_asset.* into v_ig_asset
    from public.meta_assets ig_asset
    where ig_asset.id = v_candidate.meta_asset_id
      and ig_asset.user_id = p_user_id
      and ig_asset.platform_account_id = p_platform_account_id
      and ig_asset.asset_type = 'instagram_account';

    if not found then
      raise exception 'Instagram account asset is required for organic boost';
    end if;

    if v_ig_asset.parent_meta_asset_id is null
      or char_length(v_ig_asset.parent_meta_asset_id) < 5 then
      raise exception 'Instagram account must be linked to a Facebook page';
    end if;

    v_instagram_user_id := v_ig_asset.meta_asset_id;

    select page_asset.* into v_page
    from public.meta_assets page_asset
    where page_asset.user_id = p_user_id
      and page_asset.platform_account_id = p_platform_account_id
      and page_asset.asset_type = 'facebook_page'
      and page_asset.meta_asset_id = v_ig_asset.parent_meta_asset_id;

    if not found then
      raise exception 'Linked Facebook page is required for Instagram organic boost';
    end if;
  else
    return jsonb_build_object(
      'outcome', 'SKIPPED',
      'reason', 'unsupported_content_source',
      'content_candidate_id', p_content_candidate_id,
      'source', v_candidate.source
    );
  end if;

  select link_row.* into v_existing_link
  from public.meta_organic_boost_links link_row
  where link_row.content_candidate_id = p_content_candidate_id;

  if found then
    select plan_row.* into v_existing_plan
    from public.mutation_plans plan_row
    where plan_row.id = v_existing_link.plan_id;

    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'candidate_already_linked',
      'plan_id', v_existing_link.plan_id,
      'status', coalesce(v_existing_plan.status, 'UNKNOWN'),
      'payload_hash', v_existing_plan.payload_hash,
      'content_candidate_id', p_content_candidate_id,
      'object_story_id', v_existing_link.object_story_id
    );
  end if;

  select
    asset_settings.included,
    asset_settings.daily_budget_minor,
    asset_settings.duration_days
  into
    v_asset_included,
    v_asset_daily_budget_minor,
    v_asset_duration_days
  from public.meta_boost_asset_settings asset_settings
  where asset_settings.platform_account_id = p_platform_account_id
    and asset_settings.user_id = p_user_id
    and asset_settings.meta_asset_id = v_candidate.meta_asset_id;

  if coalesce(v_settings.asset_scope, 'ALL') = 'SELECTED'
    and coalesce(v_asset_included, false) is not true then
    return jsonb_build_object(
      'outcome', 'SKIPPED',
      'reason', 'asset_not_selected_for_boost',
      'content_candidate_id', p_content_candidate_id
    );
  end if;

  v_budget_mode := coalesce(v_override.budget_mode, v_settings.budget_mode);
  v_duration_days := coalesce(
    v_override.duration_days,
    v_asset_duration_days,
    v_settings.duration_days
  );
  v_budget_owner_type := case
    when v_budget_mode = 'LIFETIME' then 'CAMPAIGN'
    else v_settings.budget_owner_type
  end;

  if v_budget_mode = 'DAILY' then
    v_daily_budget_minor := coalesce(
      v_override.daily_budget_minor,
      v_asset_daily_budget_minor,
      v_settings.daily_budget_minor
    );
    v_lifetime_budget_minor := null;
  else
    v_lifetime_budget_minor := coalesce(
      v_override.lifetime_budget_minor, v_settings.lifetime_budget_minor
    );
    v_daily_budget_minor := null;
  end if;

  if v_override.clear_cta then
    v_cta_type := null;
    v_destination_url := null;
  else
    v_cta_type := coalesce(v_override.cta_type, v_settings.default_cta_type);
    v_destination_url := coalesce(
      v_override.destination_url, v_settings.default_destination_url
    );
  end if;

  if v_destination_url is not null then
    v_destination_host := lower(
      substring(v_destination_url from '^https://([^/:?#]+)')
    );
    select domain_row.* into v_domain
    from public.allowed_domains domain_row
    where domain_row.user_id = p_user_id
      and domain_row.platform_account_id = p_platform_account_id
      and domain_row.status = 'VERIFIED'
      and domain_row.revoked_at is null
      and (
        domain_row.hostname = v_destination_host
        or domain_row.registrable_domain = v_destination_host
        or v_destination_host like '%.' || domain_row.registrable_domain
      )
    order by
      case when domain_row.hostname = v_destination_host then 0 else 1 end,
      domain_row.verified_at desc nulls last
    limit 1;

    if not found then
      raise exception 'Boost CTA destination is not covered by a verified domain';
    end if;
  end if;

  if v_budget_mode = 'DAILY'
    and v_daily_budget_minor > v_policy.default_campaign_daily_hard_cap_minor then
    raise exception 'Boost daily budget exceeds campaign hard cap';
  end if;

  if v_budget_mode = 'LIFETIME'
    and v_lifetime_budget_minor > v_policy.account_daily_hard_cap_minor * v_duration_days then
    raise exception 'Boost lifetime budget exceeds conservative account exposure bound';
  end if;

  select effective.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) effective;

  -- Lifetime exposure reservation is bound to the held canary contract.
  v_require_manual_approval := v_settings.require_manual_approval
    or v_budget_mode = 'LIFETIME'
    or coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'ALLOW'
    or not v_settings.auto_boost_new_candidates;

  if v_require_manual_approval then
    if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
      raise exception 'Organic boost canary preparation requires FREEZE_WRITES';
    end if;
  elsif coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'ALLOW' then
    raise exception 'Auto organic boost requires kill-switch ALLOW';
  end if;

  v_start_time := date_trunc('minute', p_planned_at);
  v_end_time := v_start_time + make_interval(days => v_duration_days);

  v_campaign_payload := jsonb_build_object(
    'name', 'Organic Boost',
    'objective', v_settings.objective,
    'status', 'PAUSED',
    'special_ad_categories', '[]'::jsonb
  );

  v_ad_set_payload := jsonb_build_object(
    'name', 'Organic Boost Ad Set',
    'campaign_id', jsonb_build_object('$binding_step_id', v_step_create_campaign),
    'status', 'PAUSED',
    'billing_event', v_settings.billing_event,
    'optimization_goal', v_settings.optimization_goal,
    'destination_type', 'ON_POST',
    'bid_strategy', 'LOWEST_COST_WITHOUT_CAP',
    'targeting', jsonb_build_object(
      'geo_locations', jsonb_build_object(
        'countries', to_jsonb(v_settings.default_countries)
      )
    ),
    'promoted_object', jsonb_build_object('page_id', v_page.meta_asset_id),
    'start_time', v_start_time,
    'end_time', v_end_time
  );

  if v_budget_mode = 'DAILY' and v_budget_owner_type = 'CAMPAIGN' then
    v_campaign_payload := jsonb_set(
      v_campaign_payload, '{daily_budget}',
      to_jsonb(v_daily_budget_minor::text), true
    );
  elsif v_budget_mode = 'DAILY' then
    v_ad_set_payload := jsonb_set(
      v_ad_set_payload, '{daily_budget}',
      to_jsonb(v_daily_budget_minor::text), true
    );
  else
    v_campaign_payload := jsonb_set(
      v_campaign_payload, '{lifetime_budget}',
      to_jsonb(v_lifetime_budget_minor::text), true
    );
  end if;

  if v_boost_source = 'instagram' then
    v_creative_payload := jsonb_build_object(
      'name', 'Organic Boost Creative',
      'object_id', v_page.meta_asset_id,
      'instagram_user_id', v_instagram_user_id,
      'source_instagram_media_id', v_source_instagram_media_id
    );
  else
    v_creative_payload := jsonb_build_object(
      'name', 'Organic Boost Creative',
      'object_story_id', v_object_story_id
    );
  end if;

  -- Organic post boosts must not attach top-level CTA/link fields.
  -- Meta rejects call_to_action_type/link_url next to object_story_id /
  -- source_instagram_media_id (Graph #100). Destination stays on the post.

  v_ad_payload := jsonb_build_object(
    'name', 'Organic Boost Ad',
    'adset_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set),
    'creative', jsonb_build_object(
      'creative_id', jsonb_build_object('$binding_step_id', v_step_create_creative)
    ),
    'status', 'PAUSED'
  );

  if v_domain.id is not null then
    v_ad_payload := jsonb_set(
      v_ad_payload, '{conversion_domain}',
      to_jsonb(v_domain.registrable_domain), true
    );
  end if;

  v_canonical_inputs := jsonb_build_object(
    'contract_version', case when v_budget_mode = 'LIFETIME' then 3 else 2 end,
    'launch_kind', 'ORGANIC_BOOST',
    'user_id', p_user_id,
    'platform_account_id', p_platform_account_id,
    'policy_id', p_policy_id,
    'policy_hash', v_policy.policy_hash,
    'snapshot_id', p_snapshot_id,
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'settings_id', p_settings_id,
    'settings_hash', v_settings.settings_hash,
    'content_candidate_id', p_content_candidate_id,
    'boost_source', v_boost_source,
    'object_story_id', v_object_story_id,
    'source_instagram_media_id', v_source_instagram_media_id,
    'instagram_user_id', v_instagram_user_id,
    'budget_mode', v_budget_mode,
    'budget_owner_type', v_budget_owner_type,
    'daily_budget_minor', v_daily_budget_minor,
    'lifetime_budget_minor', v_lifetime_budget_minor,
    'duration_days', v_duration_days,
    'start_time', v_start_time,
    'end_time', v_end_time,
    'cta_type', v_cta_type,
    'destination_url', v_destination_url,
    'require_manual_approval', v_require_manual_approval
  );
  v_idempotency_key := public.meta_sha256(v_canonical_inputs::text);
  v_tracking_suffix := substr(v_idempotency_key, 1, 12);
  v_campaign_name := 'Organic Boost [' || v_tracking_suffix || '-c]';
  v_ad_set_name := 'Organic Boost Ad Set [' || v_tracking_suffix || '-s]';
  v_creative_name := 'Organic Boost Creative [' || v_tracking_suffix || '-r]';
  v_ad_name := 'Organic Boost Ad [' || v_tracking_suffix || '-a]';

  v_campaign_payload := jsonb_set(v_campaign_payload, '{name}', to_jsonb(v_campaign_name), true);
  v_ad_set_payload := jsonb_set(v_ad_set_payload, '{name}', to_jsonb(v_ad_set_name), true);
  v_creative_payload := jsonb_set(v_creative_payload, '{name}', to_jsonb(v_creative_name), true);
  v_ad_payload := jsonb_set(v_ad_payload, '{name}', to_jsonb(v_ad_name), true);

  -- Stable per candidate so Abruf/snapshot rotation cannot stack fresh
  -- hard-cap reservations for the same post on the same account day.
  v_provisional_scope_key := 'boost:campaign:' || p_content_candidate_id::text;
  v_provisional_budget_key := case v_budget_owner_type
    when 'CAMPAIGN' then v_provisional_scope_key
    else 'boost:adset:' || p_content_candidate_id::text
  end;

  v_planned_payload := jsonb_build_object(
    'contract_version', case when v_budget_mode = 'LIFETIME' then 3 else 2 end,
    'launch_kind', 'ORGANIC_BOOST',
    'require_manual_approval', v_require_manual_approval,
    'objective', v_settings.objective,
    'content_candidate_id', p_content_candidate_id,
    'boost_source', v_boost_source,
    'object_story_id', v_object_story_id,
    'source_instagram_media_id', v_source_instagram_media_id,
    'instagram_user_id', v_instagram_user_id,
    'page_id', v_page.meta_asset_id,
    'settings_id', p_settings_id,
    'settings_hash', v_settings.settings_hash,
    'destination_url', v_destination_url,
    'destination_hostname', v_destination_host,
    'cta_type', v_cta_type,
    'conversion_domain', v_domain.registrable_domain,
    'budget_mode', v_budget_mode,
    'budget_type', v_budget_mode,
    'budget_owner_type', v_budget_owner_type,
    'daily_budget_minor', v_daily_budget_minor,
    'lifetime_budget_minor', v_lifetime_budget_minor,
    'duration_days', v_duration_days,
    'start_time', v_start_time,
    'end_time', v_end_time,
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
    p_source_marketing_sync_id, 'organic-boost', 1,
    'LAUNCH_CHAIN', 'CHAIN',
    'boost:' || substr(v_idempotency_key, 1, 48),
    v_provisional_scope_key, v_provisional_budget_key, null,
    v_idempotency_key,
    jsonb_build_object(
      'remote_objects_absent', true,
      'policy_hash', v_policy.policy_hash,
      'exposure_snapshot_id', p_snapshot_id,
      'source_marketing_sync_id', p_source_marketing_sync_id,
      'kill_switch_mode', v_kill_mode,
      'content_candidate_id', p_content_candidate_id
    ),
    jsonb_build_object(
      'status', 'ACTIVE',
      'objective', v_settings.objective,
      'budget_mode', v_budget_mode,
      'daily_budget_minor', v_daily_budget_minor,
      'lifetime_budget_minor', v_lifetime_budget_minor,
      'budget_owner_type', v_budget_owner_type,
      'end_time', v_end_time
    ),
    v_planned_payload, v_payload_hash,
    'PENDING', 55, false,
    case when v_require_manual_approval then 'infinity'::timestamptz else p_planned_at end,
    3,
    p_planned_at, p_planned_at
  ) on conflict (idempotency_key) do nothing
  returning id into v_plan_id;

  if v_plan_id is null then
    select plan_row.* into v_existing_plan
    from public.mutation_plans plan_row
    where plan_row.idempotency_key = v_idempotency_key;

    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'idempotent_replay',
      'plan_id', v_existing_plan.id,
      'status', v_existing_plan.status,
      'payload_hash', v_existing_plan.payload_hash,
      'content_candidate_id', p_content_candidate_id,
      'object_story_id', v_object_story_id
    );
  end if;

  -- Drop stale hash-based boost exposures for dead plans so earlier Abruf
  -- attempts cannot consume the account hard cap.
  delete from public.daily_budget_exposures dbe
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = v_snapshot.account_day
    and dbe.source = 'PLAN'
    and (
      dbe.budget_owner_key = v_provisional_budget_key
      or dbe.budget_owner_key like 'boost:campaign:%'
      or dbe.budget_owner_key like 'boost:adset:%'
    )
    and (
      dbe.plan_id is null
      or dbe.plan_id = v_plan_id
      or not exists (
        select 1
        from public.mutation_plans mp
        where mp.id = dbe.plan_id
          and mp.status in ('PENDING', 'CLAIMED', 'RUNNING', 'RETRYABLE', 'HELD')
      )
    );

  -- Paused/archived Meta campaigns must not block new organic boosts against
  -- the customer hard cap (snapshot ingestion previously ignored status).
  delete from public.daily_budget_exposures dbe
  using public.automation_targets target
  left join public.campaigns campaign
    on campaign.platform_account_id = target.platform_account_id
   and campaign.platform_campaign_id = target.platform_object_id
   and campaign.is_current
  left join public.ad_groups ad_group
    on ad_group.platform_account_id = target.platform_account_id
   and ad_group.platform_ad_group_id = target.platform_object_id
   and ad_group.is_current
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = v_snapshot.account_day
    and dbe.source = 'SNAPSHOT'
    and target.platform_account_id = dbe.platform_account_id
    and target.budget_owner_key = dbe.budget_owner_key
    and (
      (
        target.target_type = 'CAMPAIGN'
        and coalesce(campaign.effective_status, campaign.status, 'UNKNOWN') <> 'ACTIVE'
      )
      or (
        target.target_type = 'AD_SET'
        and coalesce(ad_group.effective_status, ad_group.status, 'UNKNOWN') <> 'ACTIVE'
      )
    );

  begin
    if v_budget_mode = 'DAILY' then
      select reserved.account_reserved_exposure_minor into v_exposure_minor
      from public.reserve_meta_daily_budget_exposure(
        p_user_id, p_platform_account_id, p_policy_id, p_snapshot_id,
        v_plan_id, null, v_snapshot.account_day,
        v_provisional_scope_key, v_provisional_budget_key,
        v_budget_owner_type, false, 'EUR', v_daily_budget_minor,
        v_policy.standard_flex_spend_multiplier_bps, 'PLAN'
      ) reserved;
    else
      select reserved.account_reserved_exposure_minor into v_exposure_minor
      from public.reserve_meta_lifetime_budget_exposure_v3(
        p_user_id, p_platform_account_id, p_policy_id, p_snapshot_id,
        v_plan_id, null, v_snapshot.account_day,
        v_provisional_scope_key, v_provisional_budget_key,
        'EUR', v_lifetime_budget_minor, 'PLAN'
      ) reserved;
    end if;
  exception when others then
    if SQLERRM like '%hard cap would be exceeded%' then
      raise exception '% (boost daily budget %, account reserved after reserve attempt — check stacked boost:* exposures and Autonomie Konto-Tageslimit)',
        SQLERRM, v_daily_budget_minor
        using errcode = 'P0001';
    end if;
    raise;
  end;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CAMPAIGN', 'object_type', 'CAMPAIGN',
    'mode', 'validate_only', 'payload', v_campaign_payload
  );
  perform public.meta_organic_boost_insert_step(
    v_step_validate_campaign, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-campaign', 'VALIDATE', 'CAMPAIGN', null, v_request,
    jsonb_build_object('validated', true), 'NONE'
  );
  v_previous_step := v_step_validate_campaign; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CAMPAIGN', 'object_type', 'CAMPAIGN',
    'mode', 'execute', 'payload', v_campaign_payload
  );
  perform public.meta_organic_boost_insert_step(
    v_step_create_campaign, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-campaign-paused', 'CREATE', 'CAMPAIGN', v_previous_step,
    v_request, jsonb_build_object('status', 'PAUSED'), 'PAUSE'
  );
  v_previous_step := v_step_create_campaign; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'CAMPAIGN',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_campaign)
  );
  perform public.meta_organic_boost_insert_step(
    v_step_read_campaign_paused, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-campaign-paused', 'READ', 'CAMPAIGN', v_previous_step,
    v_request, jsonb_build_object('status', 'PAUSED'), 'NONE'
  );
  v_previous_step := v_step_read_campaign_paused; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD_SET', 'object_type', 'AD_SET',
    'mode', 'validate_only', 'payload', v_ad_set_payload
  );
  perform public.meta_organic_boost_insert_step(
    v_step_validate_ad_set, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-ad-set', 'VALIDATE', 'AD_SET', v_previous_step,
    v_request, jsonb_build_object('validated', true), 'NONE'
  );
  v_previous_step := v_step_validate_ad_set; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD_SET', 'object_type', 'AD_SET',
    'mode', 'execute', 'payload', v_ad_set_payload
  );
  perform public.meta_organic_boost_insert_step(
    v_step_create_ad_set, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-ad-set-paused', 'CREATE', 'AD_SET', v_previous_step,
    v_request, jsonb_build_object('status', 'PAUSED'), 'PAUSE'
  );
  v_previous_step := v_step_create_ad_set; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD_SET',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set)
  );
  perform public.meta_organic_boost_insert_step(
    v_step_read_ad_set_paused, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-set-paused', 'READ', 'AD_SET', v_previous_step,
    v_request, jsonb_build_object('status', 'PAUSED'), 'NONE'
  );
  v_previous_step := v_step_read_ad_set_paused; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
    'mode', 'validate_only', 'payload', v_creative_payload
  );
  perform public.meta_organic_boost_insert_step(
    v_step_validate_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-creative', 'VALIDATE', 'CREATIVE', v_previous_step,
    v_request, jsonb_build_object('validated', true), 'NONE'
  );
  v_previous_step := v_step_validate_creative; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
    'payload', v_creative_payload
  );
  perform public.meta_organic_boost_insert_step(
    v_step_create_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-creative', 'CREATE', 'CREATIVE', v_previous_step,
    v_request, jsonb_build_object('created', true), 'NONE'
  );
  v_previous_step := v_step_create_creative; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'CREATIVE',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_creative)
  );
  perform public.meta_organic_boost_insert_step(
    v_step_read_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-creative', 'READ', 'CREATIVE', v_previous_step,
    v_request, jsonb_build_object('created', true), 'NONE'
  );
  v_previous_step := v_step_read_creative; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD', 'object_type', 'AD',
    'mode', 'validate_only', 'payload', v_ad_payload
  );
  perform public.meta_organic_boost_insert_step(
    v_step_validate_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-ad-paused', 'VALIDATE', 'AD', v_previous_step,
    v_request, jsonb_build_object('validated', true), 'NONE'
  );
  v_previous_step := v_step_validate_ad; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD', 'object_type', 'AD',
    'mode', 'execute', 'payload', v_ad_payload
  );
  perform public.meta_organic_boost_insert_step(
    v_step_create_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-ad-paused', 'CREATE', 'AD', v_previous_step,
    v_request, jsonb_build_object('status', 'PAUSED'), 'PAUSE'
  );
  v_previous_step := v_step_create_ad; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad)
  );
  perform public.meta_organic_boost_insert_step(
    v_step_read_ad_shadow, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-paused', 'READ', 'AD', v_previous_step,
    v_request, jsonb_build_object('status', 'PAUSED'), 'NONE'
  );
  v_previous_step := v_step_read_ad_shadow; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS', 'object_type', 'AD_SET',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set),
    'status', 'ACTIVE', 'mode', 'execute'
  );
  perform public.meta_organic_boost_insert_step(
    v_step_activate_ad_set, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'activate-ad-set', 'UPDATE', 'AD_SET', v_previous_step,
    v_request, jsonb_build_object('status', 'ACTIVE'), 'PAUSE'
  );
  v_previous_step := v_step_activate_ad_set; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD_SET',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set)
  );
  perform public.meta_organic_boost_insert_step(
    v_step_read_ad_set_active, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-set-active', 'READ', 'AD_SET', v_previous_step,
    v_request, jsonb_build_object('status', 'ACTIVE'), 'NONE'
  );
  v_previous_step := v_step_read_ad_set_active; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS', 'object_type', 'CAMPAIGN',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_campaign),
    'status', 'ACTIVE', 'mode', 'execute'
  );
  perform public.meta_organic_boost_insert_step(
    v_step_activate_campaign, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'activate-campaign', 'UPDATE', 'CAMPAIGN', v_previous_step,
    v_request, jsonb_build_object('status', 'ACTIVE'), 'PAUSE'
  );
  v_previous_step := v_step_activate_campaign; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad),
    'status', 'ACTIVE', 'mode', 'execute'
  );
  perform public.meta_organic_boost_insert_step(
    v_step_activate_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'activate-ad', 'UPDATE', 'AD', v_previous_step,
    v_request, jsonb_build_object('status', 'ACTIVE'), 'PAUSE'
  );
  v_previous_step := v_step_activate_ad; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'CAMPAIGN',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_campaign)
  );
  perform public.meta_organic_boost_insert_step(
    v_step_read_campaign_active, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-campaign-active', 'READ', 'CAMPAIGN', v_previous_step,
    v_request, jsonb_build_object('status', 'ACTIVE'), 'NONE'
  );
  v_previous_step := v_step_read_campaign_active; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad)
  );
  perform public.meta_organic_boost_insert_step(
    v_step_read_ad_active, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-active', 'READ', 'AD', v_previous_step,
    v_request, jsonb_build_object('status', 'ACTIVE'), 'NONE'
  );
  v_previous_step := v_step_read_ad_active; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD_SET',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad_set)
  );
  perform public.meta_organic_boost_insert_step(
    v_step_read_ad_set_final, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-ad-set-final', 'READ', 'AD_SET', v_previous_step,
    v_request, jsonb_build_object('status', 'ACTIVE'), 'NONE'
  );
  v_previous_step := v_step_read_ad_set_final; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'RECONCILE', 'object_type', 'ACCOUNT',
    'plan_id', v_plan_id
  );
  perform public.meta_organic_boost_insert_step(
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'reconcile-launch-chain', 'RECONCILE', 'ACCOUNT', v_previous_step,
    v_request, jsonb_build_object('reconciled', true), 'NONE'
  );

  insert into public.meta_organic_boost_links (
    user_id, platform_account_id, content_candidate_id, plan_id,
    object_story_id, settings_hash
  ) values (
    p_user_id, p_platform_account_id, p_content_candidate_id, v_plan_id,
    v_object_story_id, v_settings.settings_hash
  );

  -- REVIEW keeps is_new so the dashboard still lists posts awaiting approval.
  -- AUTO clears the candidate once an executable plan exists.
  if not v_require_manual_approval then
    update public.meta_content_candidates
    set is_new = false, updated_at = now()
    where id = p_content_candidate_id
      and user_id = p_user_id
      and platform_account_id = p_platform_account_id;
  end if;

  return jsonb_build_object(
    'outcome', 'QUEUED',
    'plan_id', v_plan_id,
    'idempotency_key', v_idempotency_key,
    'status', case when v_require_manual_approval then 'HELD' else 'PENDING' end,
    'payload_hash', v_payload_hash,
    'content_candidate_id', p_content_candidate_id,
    'object_story_id', v_object_story_id,
    'budget_mode', v_budget_mode,
    'daily_budget_minor', v_daily_budget_minor,
    'lifetime_budget_minor', v_lifetime_budget_minor,
    'duration_days', v_duration_days,
    'destination_url', v_destination_url,
    'require_manual_approval', v_require_manual_approval,
    'reserved_exposure_minor', v_exposure_minor,
    'campaign_name', v_campaign_name,
    'ad_set_name', v_ad_set_name,
    'creative_name', v_creative_name,
    'ad_name', v_ad_name,
    'objective', v_settings.objective,
    'target_status', 'ACTIVE',
    'step_count', v_index + 1
  );
end;
$$;

revoke all on function public.materialize_meta_organic_boost_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_meta_organic_boost_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.materialize_meta_organic_boost_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz
) is
  'Materialize one organic boost plan. Engagement ad sets use destination_type=ON_POST; organic creatives omit top-level CTA/link fields.';

-- Permanent organic preflight misses become BLOCKED with a reason.
create or replace function public.meta_launch_chain_preflight_action(
  p_plan_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_kill text;
  v_reason text;
begin
  select * into v_plan
  from public.mutation_plans
  where id = p_plan_id;

  if not found or v_plan.action_type <> 'LAUNCH_CHAIN' then
    return 'ok';
  end if;

  if public.meta_launch_canary_preflight_ok(p_plan_id) then
    return 'ok';
  end if;

  if v_plan.source_rule_key is distinct from 'organic-boost' then
    return 'stale';
  end if;

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    v_plan.user_id, v_plan.platform_account_id, v_plan.id
  ) ks;

  if coalesce(v_kill, 'FREEZE_WRITES') <> 'ALLOW' then
    v_reason := 'organic_preflight_kill_switch';
    update public.mutation_plans
    set
      status = 'BLOCKED',
      blocked_reason = v_reason,
      error_class = 'KILL_SWITCH',
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = now(),
      updated_at = now()
    where id = p_plan_id
      and status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'EXECUTING');
    return 'skip';
  end if;

  if not exists (
    select 1
    from public.platform_accounts account
    where account.id = v_plan.platform_account_id
      and account.user_id = v_plan.user_id
      and account.marketing_sync_status = 'success'
      and account.marketing_last_success_at >= now() - interval '48 hours'
      and 'ads_management' = any(account.meta_scopes)
      and nullif(account.marketing_meta_ad_account_id, '') is not null
  ) then
    v_reason := 'organic_preflight_marketing_sync_stale';
  else
    v_reason := 'organic_preflight_not_ready';
  end if;

  -- Soft miss: keep PENDING, delay the next claim tick, surface reason in UI.
  update public.mutation_plans
  set
    blocked_reason = v_reason,
    error_class = 'PREFLIGHT',
    not_before = greatest(coalesce(not_before, now()), now() + interval '1 minute'),
    updated_at = now()
  where id = p_plan_id
    and status in ('PENDING', 'RETRYABLE');

  return 'skip';
end;
$$;

-- Repair + re-queue existing organic AUTO plans with corrected payloads.
with repaired as (
  select
    mp.id,
    jsonb_set(
      (mp.planned_payload #- '{creative,call_to_action_type}' #- '{creative,link_url}'),
      '{ad_set,destination_type}',
      '"ON_POST"'::jsonb,
      true
    ) as payload
  from public.mutation_plans mp
  where mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
    and mp.status in (
      'FAILED', 'PENDING', 'RETRYABLE', 'STALE', 'BLOCKED',
      'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING'
    )
)
update public.mutation_plans mp
set
  planned_payload = repaired.payload,
  payload_hash = public.meta_sha256(repaired.payload::text),
  status = 'PENDING',
  attempt_count = 0,
  max_attempts = greatest(coalesce(mp.max_attempts, 1), 3),
  lease_token = null,
  lease_owner = null,
  lease_expires_at = null,
  error_class = null,
  blocked_reason = null,
  terminal_at = null,
  not_before = least(coalesce(mp.not_before, now()), now()),
  updated_at = now()
from repaired
where mp.id = repaired.id;

update public.mutation_plan_steps mps
set
  planned_request = case
    when mps.step_key in ('validate-ad-set', 'create-ad-set-paused') then
      jsonb_set(
        coalesce(mps.planned_request, '{}'::jsonb),
        '{payload,destination_type}',
        '"ON_POST"'::jsonb,
        true
      )
    when mps.step_key in ('validate-creative', 'create-creative') then
      (coalesce(mps.planned_request, '{}'::jsonb)
        #- '{payload,call_to_action_type}'
        #- '{payload,link_url}')
    else mps.planned_request
  end,
  request_hash = public.meta_sha256((
    case
      when mps.step_key in ('validate-ad-set', 'create-ad-set-paused') then
        jsonb_set(
          coalesce(mps.planned_request, '{}'::jsonb),
          '{payload,destination_type}',
          '"ON_POST"'::jsonb,
          true
        )
      when mps.step_key in ('validate-creative', 'create-creative') then
        (coalesce(mps.planned_request, '{}'::jsonb)
          #- '{payload,call_to_action_type}'
          #- '{payload,link_url}')
      else mps.planned_request
    end
  )::text),
  status = 'PENDING',
  dispatch_state = 'NOT_DISPATCHED',
  dispatch_started_at = null,
  remote_applied_at = null,
  remote_request_id = null,
  response_fingerprint = null,
  validation_fingerprint = null,
  validated_at = null,
  started_at = null,
  error_class = null,
  error_code = null,
  attempt_count = 0,
  completed_at = null,
  updated_at = now()
from public.mutation_plans mp
where mps.plan_id = mp.id
  and mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status = 'PENDING'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and mps.status <> 'SKIPPED';

-- Abandon in-flight executions so repaired plans can be claimed again.
update public.mutation_executions me
set
  status = 'ABANDONED',
  finished_at = coalesce(me.finished_at, now()),
  error_class = coalesce(me.error_class, 'PREFLIGHT'),
  error_code = coalesce(me.error_code, 'organic_payload_repaired')
from public.mutation_plans mp
where me.plan_id = mp.id
  and mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status = 'PENDING'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING', 'RETRYABLE');

-- Return type gains error columns; replace the function.
drop function if exists public.list_meta_organic_boost_campaigns(uuid);

create or replace function public.list_meta_organic_boost_campaigns(
  p_platform_account_id uuid
)
returns table (
  link_id uuid,
  plan_id uuid,
  plan_status text,
  content_candidate_id uuid,
  object_story_id text,
  campaign_id uuid,
  campaign_name text,
  objective text,
  status text,
  effective_status text,
  budget_mode text,
  daily_budget_minor bigint,
  lifetime_budget_minor bigint,
  budget_remaining_minor bigint,
  duration_days integer,
  start_time timestamptz,
  end_time timestamptz,
  spend numeric,
  impressions bigint,
  post_engagements bigint,
  currency text,
  created_at timestamptz,
  plan_error_class text,
  plan_blocked_reason text,
  failed_step_key text,
  failed_step_error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_platform_account_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.platform_accounts account
    where account.id = p_platform_account_id
      and account.user_id = v_user_id
      and account.platform = 'meta'
      and account.revoked_at is null
  ) then
    return;
  end if;

  return query
  with boost_links as (
    select
      link.id as link_id,
      link.plan_id,
      link.content_candidate_id,
      link.object_story_id,
      link.created_at,
      plan.status as plan_status,
      plan.planned_payload,
      plan.error_class as plan_error_class,
      plan.blocked_reason as plan_blocked_reason
    from public.meta_organic_boost_links link
    join public.mutation_plans plan
      on plan.id = link.plan_id
     and plan.user_id = link.user_id
     and plan.platform_account_id = link.platform_account_id
    where link.user_id = v_user_id
      and link.platform_account_id = p_platform_account_id
    order by link.created_at desc
    limit 50
  ),
  failed_steps as (
    select distinct on (step.plan_id)
      step.plan_id,
      step.step_key,
      step.error_code
    from public.mutation_plan_steps step
    join boost_links boost on boost.plan_id = step.plan_id
    where step.status = 'FAILED'
      and step.error_code is not null
    order by step.plan_id, step.step_index desc
  ),
  bound as (
    select
      boost.link_id,
      coalesce(binding.local_campaign_id, campaign.id) as campaign_id,
      coalesce(
        campaign.name,
        boost.planned_payload#>>'{campaign,name}',
        'Beitrag-Push'
      ) as campaign_name,
      coalesce(
        campaign.objective,
        boost.planned_payload->>'objective'
      ) as objective,
      campaign.status,
      campaign.effective_status,
      campaign.daily_budget_minor as campaign_daily_budget_minor,
      campaign.lifetime_budget_minor as campaign_lifetime_budget_minor,
      campaign.budget_remaining_minor,
      campaign.start_time as campaign_start_time,
      campaign.stop_time as campaign_stop_time
    from boost_links boost
    left join public.remote_object_bindings binding
      on binding.plan_id = boost.plan_id
     and binding.user_id = v_user_id
     and binding.platform_account_id = p_platform_account_id
     and binding.object_type = 'CAMPAIGN'
    left join public.campaigns campaign
      on campaign.platform_account_id = p_platform_account_id
     and campaign.user_id = v_user_id
     and campaign.is_current
     and (
       (binding.local_campaign_id is not null and campaign.id = binding.local_campaign_id)
       or (
         binding.remote_object_id is not null
         and campaign.platform_campaign_id = binding.remote_object_id
       )
       or (
         binding.id is null
         and campaign.name = boost.planned_payload#>>'{campaign,name}'
       )
     )
  ),
  perf as (
    select
      pd.campaign_id,
      min(pd.currency) as currency,
      sum(pd.spend) as spend,
      sum(pd.impressions)::bigint as impressions,
      round(sum(
        coalesce(nullif(pd.actions->>'post_engagement', ''), '0')::numeric
      ))::bigint as post_engagements
    from public.performance_data pd
    where pd.user_id = v_user_id
      and pd.platform_account_id = p_platform_account_id
      and pd.platform = 'meta'
      and pd.campaign_id in (select b.campaign_id from bound b where b.campaign_id is not null)
      and pd.date >= current_date - 90
    group by pd.campaign_id
  )
  select
    boost.link_id,
    boost.plan_id,
    boost.plan_status,
    boost.content_candidate_id,
    boost.object_story_id,
    bound.campaign_id,
    bound.campaign_name,
    bound.objective,
    bound.status,
    bound.effective_status,
    coalesce(boost.planned_payload->>'budget_mode', 'DAILY') as budget_mode,
    coalesce(
      nullif(boost.planned_payload->>'daily_budget_minor', '')::bigint,
      bound.campaign_daily_budget_minor
    ) as daily_budget_minor,
    coalesce(
      nullif(boost.planned_payload->>'lifetime_budget_minor', '')::bigint,
      bound.campaign_lifetime_budget_minor
    ) as lifetime_budget_minor,
    bound.budget_remaining_minor,
    coalesce(nullif(boost.planned_payload->>'duration_days', '')::integer, null) as duration_days,
    coalesce(
      nullif(boost.planned_payload->>'start_time', '')::timestamptz,
      bound.campaign_start_time
    ) as start_time,
    coalesce(
      nullif(boost.planned_payload->>'end_time', '')::timestamptz,
      bound.campaign_stop_time
    ) as end_time,
    perf.spend,
    perf.impressions,
    perf.post_engagements,
    coalesce(perf.currency, 'EUR') as currency,
    boost.created_at,
    boost.plan_error_class,
    boost.plan_blocked_reason,
    failed_steps.step_key,
    failed_steps.error_code
  from boost_links boost
  left join bound on bound.link_id = boost.link_id
  left join perf on perf.campaign_id = bound.campaign_id
  left join failed_steps on failed_steps.plan_id = boost.plan_id
  order by boost.created_at desc;
end;
$$;

revoke all on function public.list_meta_organic_boost_campaigns(uuid)
  from public, anon, authenticated;
grant execute on function public.list_meta_organic_boost_campaigns(uuid)
  to authenticated, service_role;

commit;

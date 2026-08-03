-- Organic boost materializer, customer wrappers, approval, and sync planner.

begin;

create or replace function public.meta_organic_boost_insert_step(
  p_step_id uuid,
  p_plan_id uuid,
  p_user_id uuid,
  p_platform_account_id uuid,
  p_step_index integer,
  p_step_key text,
  p_operation text,
  p_object_type text,
  p_depends_on uuid,
  p_request jsonb,
  p_expected jsonb,
  p_compensation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    p_step_id, p_plan_id, p_user_id, p_platform_account_id,
    p_step_index, p_step_key, p_operation, p_object_type, p_depends_on,
    p_request, public.meta_sha256(p_request::text), p_expected,
    p_compensation, 'PENDING'
  );
end;
$$;

revoke all on function public.meta_organic_boost_insert_step(
  uuid, uuid, uuid, uuid, integer, text, text, text, uuid, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.meta_organic_boost_insert_step(
  uuid, uuid, uuid, uuid, integer, text, text, text, uuid, jsonb, jsonb, text
) to service_role;

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
  v_budget_owner_type text;
  v_cta_type text;
  v_destination_url text;
  v_destination_host text;
  v_object_story_id text;
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

  select snapshot.* into v_snapshot
  from public.daily_budget_exposure_snapshots snapshot
  where snapshot.id = p_snapshot_id
    and snapshot.user_id = p_user_id
    and snapshot.platform_account_id = p_platform_account_id
    and snapshot.policy_id = p_policy_id
    and snapshot.source_marketing_sync_id = p_source_marketing_sync_id
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

  -- Phase-1 boost uses Facebook page_post object_story_id. Instagram media IDs
  -- are not page_post story IDs and are skipped until a dedicated IG path lands.
  if v_candidate.source <> 'facebook'
    or v_candidate.meta_content_id !~ '^[0-9]{5,}_[0-9]{5,}$' then
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

  v_budget_mode := coalesce(v_override.budget_mode, v_settings.budget_mode);
  v_duration_days := coalesce(v_override.duration_days, v_settings.duration_days);
  v_budget_owner_type := case
    when v_budget_mode = 'LIFETIME' then 'CAMPAIGN'
    else v_settings.budget_owner_type
  end;

  if v_budget_mode = 'DAILY' then
    v_daily_budget_minor := coalesce(v_override.daily_budget_minor, v_settings.daily_budget_minor);
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

  v_creative_payload := jsonb_build_object(
    'name', 'Organic Boost Creative',
    'object_story_id', v_object_story_id
  );

  if v_cta_type is not null and v_destination_url is not null then
    -- Use allowlisted creative fields; Meta validate_only rejects unsupported
    -- CTA combinations for a given organic post type.
    v_creative_payload := v_creative_payload || jsonb_build_object(
      'call_to_action_type', v_cta_type,
      'link_url', v_destination_url
    );
  end if;

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
    'object_story_id', v_object_story_id,
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

  v_provisional_scope_key := 'boost:campaign:' || substr(v_idempotency_key, 1, 48);
  v_provisional_budget_key := case v_budget_owner_type
    when 'CAMPAIGN' then v_provisional_scope_key
    else 'boost:adset:' || substr(v_idempotency_key, 1, 48)
  end;

  v_planned_payload := jsonb_build_object(
    'contract_version', case when v_budget_mode = 'LIFETIME' then 3 else 2 end,
    'launch_kind', 'ORGANIC_BOOST',
    'require_manual_approval', v_require_manual_approval,
    'objective', v_settings.objective,
    'content_candidate_id', p_content_candidate_id,
    'object_story_id', v_object_story_id,
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
    1,
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

  update public.meta_content_candidates
  set is_new = false, updated_at = now()
  where id = p_content_candidate_id
    and user_id = p_user_id
    and platform_account_id = p_platform_account_id;

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

create or replace function public.materialize_meta_customer_organic_boost_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_read_lease_token uuid,
  p_content_candidate_id uuid,
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
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_read_lease_token is null
    or p_content_candidate_id is null
    or p_planned_at is null then
    raise exception 'Customer organic boost command is incomplete';
  end if;

  select account.* into v_account
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
    raise exception 'Customer organic boost requires ads_management and a current EUR Meta snapshot';
  end if;

  select policy.* into v_policy
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
    raise exception 'Active launch-enabled customer policy is required';
  end if;

  select settings.* into v_settings
  from public.meta_boost_settings settings
  where settings.user_id = p_user_id
    and settings.platform_account_id = p_platform_account_id
    and settings.is_current
    and settings.enabled
  for update;

  if not found then
    raise exception 'Enabled boost settings are required';
  end if;

  select snapshot.* into v_snapshot
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

  return public.materialize_meta_organic_boost_plan(
    p_platform_account_id,
    p_user_id,
    v_policy.id,
    v_snapshot.id,
    v_account.marketing_sync_id,
    p_read_lease_token,
    p_content_candidate_id,
    v_settings.id,
    p_planned_at
  );
end;
$$;

revoke all on function public.materialize_meta_customer_organic_boost_plan(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_meta_customer_organic_boost_plan(
  uuid, uuid, uuid, uuid, timestamptz
) to service_role;

create or replace function public.approve_meta_organic_boost_canary_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid,
  p_expected_payload_hash text,
  p_expected_object_story_id text,
  p_expected_budget_mode text,
  p_expected_daily_budget_minor bigint,
  p_expected_lifetime_budget_minor bigint,
  p_expected_duration_days integer,
  p_expected_destination_url text,
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
  v_link public.meta_organic_boost_links%rowtype;
  v_approval_id uuid := gen_random_uuid();
  v_approved_at timestamptz := now();
  v_executable_at timestamptz := now();
  v_kill_mode text;
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_plan_id is null
    or p_expected_payload_hash is null
    or p_expected_payload_hash !~ '^[0-9a-f]{64}$'
    or p_expected_object_story_id is null
    or p_expected_budget_mode not in ('DAILY', 'LIFETIME')
    or p_expected_duration_days is null
    or p_expected_duration_days < 1
    or char_length(coalesce(p_reason, '')) < 12 then
    raise exception 'Organic boost approval input is invalid';
  end if;

  select plan_row.* into v_plan
  from public.mutation_plans plan_row
  where plan_row.id = p_plan_id
    and plan_row.user_id = p_user_id
    and plan_row.platform_account_id = p_platform_account_id
    and plan_row.action_type = 'LAUNCH_CHAIN'
    and plan_row.source_rule_key = 'organic-boost'
  for update;

  if not found then
    raise exception 'Organic boost plan not found';
  end if;

  select link_row.* into v_link
  from public.meta_organic_boost_links link_row
  where link_row.plan_id = p_plan_id
    and link_row.user_id = p_user_id
    and link_row.platform_account_id = p_platform_account_id;

  if not found then
    raise exception 'Organic boost link not found';
  end if;

  if v_plan.status <> 'PENDING'
    or v_plan.not_before <> 'infinity'::timestamptz
    or v_plan.payload_hash is distinct from p_expected_payload_hash
    or v_plan.planned_payload->>'object_story_id' is distinct from p_expected_object_story_id
    or v_plan.planned_payload->>'budget_mode' is distinct from p_expected_budget_mode
    or coalesce((v_plan.planned_payload->>'duration_days')::integer, -1)
         is distinct from p_expected_duration_days
    or coalesce(v_plan.planned_payload->>'destination_url', '')
         is distinct from coalesce(p_expected_destination_url, '')
    or (
      p_expected_budget_mode = 'DAILY'
      and (v_plan.planned_payload->>'daily_budget_minor')::bigint
            is distinct from p_expected_daily_budget_minor
    )
    or (
      p_expected_budget_mode = 'LIFETIME'
      and (v_plan.planned_payload->>'lifetime_budget_minor')::bigint
            is distinct from p_expected_lifetime_budget_minor
    ) then
    raise exception 'Organic boost approval fingerprint mismatch';
  end if;

  select effective.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, p_plan_id
  ) effective;

  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    raise exception 'Organic boost approval requires FREEZE_WRITES';
  end if;

  insert into public.meta_organic_boost_canary_approvals (
    id, user_id, platform_account_id, plan_id, content_candidate_id,
    payload_hash, object_story_id, budget_mode, daily_budget_minor,
    lifetime_budget_minor, duration_days, destination_url, reason,
    approved_by, approved_at
  ) values (
    v_approval_id, p_user_id, p_platform_account_id, p_plan_id,
    v_link.content_candidate_id, p_expected_payload_hash,
    p_expected_object_story_id, p_expected_budget_mode,
    p_expected_daily_budget_minor, p_expected_lifetime_budget_minor,
    p_expected_duration_days, p_expected_destination_url, p_reason,
    p_user_id, v_approved_at
  );

  update public.mutation_plans
  set
    not_before = v_executable_at,
    updated_at = v_approved_at
  where id = p_plan_id;

  perform public.append_meta_kill_switch_state(
    'PLAN', p_user_id, p_platform_account_id, p_plan_id, 'ALLOW',
    'Organic boost canary approved by customer', 'CUSTOMER', p_user_id::text
  );
  perform public.append_meta_kill_switch_state(
    'ACCOUNT', p_user_id, p_platform_account_id, null, 'ALLOW',
    'Organic boost canary briefly opens account writes', 'CUSTOMER', p_user_id::text
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, v_plan.policy_id, p_plan_id,
    null, null, 'CUSTOMER', p_user_id::text, 'ORGANIC_BOOST_CANARY_APPROVED',
    jsonb_build_object('payload_hash', p_expected_payload_hash),
    jsonb_build_object(
      'object_story_id', p_expected_object_story_id,
      'budget_mode', p_expected_budget_mode,
      'duration_days', p_expected_duration_days
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'approval_id', v_approval_id,
      'plan_status', 'PENDING',
      'executable_at', v_executable_at
    ),
    jsonb_build_object('reason', p_reason),
    null, null, null, null, null, v_approved_at
  );

  return query
  select v_approval_id, p_plan_id, 'PENDING'::text, v_executable_at, v_approved_at;
end;
$$;

revoke all on function public.approve_meta_organic_boost_canary_plan(
  uuid, uuid, uuid, text, text, text, bigint, bigint, integer, text, text
) from public, anon, authenticated;
grant execute on function public.approve_meta_organic_boost_canary_plan(
  uuid, uuid, uuid, text, text, text, bigint, bigint, integer, text, text
) to service_role;

create or replace function public.run_meta_organic_boost_planner(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_planned_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.meta_boost_settings%rowtype;
  v_policy public.automation_policies%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_account public.platform_accounts%rowtype;
  v_candidate record;
  v_result jsonb;
  v_created integer := 0;
  v_existing integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  if p_platform_account_id is null
    or p_user_id is null
    or p_source_marketing_sync_id is null
    or p_read_lease_token is null
    or p_planned_at is null then
    return jsonb_build_object('status', 'INVALID_INPUT');
  end if;

  select settings.* into v_settings
  from public.meta_boost_settings settings
  where settings.platform_account_id = p_platform_account_id
    and settings.user_id = p_user_id
    and settings.is_current
    and settings.enabled
    and settings.auto_boost_new_candidates;

  if not found then
    return jsonb_build_object(
      'status', 'DISABLED',
      'plans_created', 0,
      'plans_existing', 0,
      'candidates_skipped', 0,
      'candidates_failed', 0
    );
  end if;

  select account.* into v_account
  from public.platform_accounts account
  where account.id = p_platform_account_id
    and account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null
    and account.marketing_currency = 'EUR'
    and account.marketing_sync_id = p_source_marketing_sync_id
    and account.marketing_sync_status = 'success'
    and 'ads_management' = any(account.meta_scopes);

  if not found then
    return jsonb_build_object('status', 'ACCOUNT_UNAVAILABLE');
  end if;

  select policy.* into v_policy
  from public.automation_policies policy
  where policy.platform_account_id = p_platform_account_id
    and policy.user_id = p_user_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.allow_new_launches
    and policy.allow_status_changes;

  if not found then
    return jsonb_build_object('status', 'NO_ACTIVE_POLICY');
  end if;

  select snapshot.* into v_snapshot
  from public.daily_budget_exposure_snapshots snapshot
  where snapshot.user_id = p_user_id
    and snapshot.platform_account_id = p_platform_account_id
    and snapshot.policy_id = v_policy.id
    and snapshot.source_marketing_sync_id = p_source_marketing_sync_id
    and snapshot.status = 'COMPLETE'
    and snapshot.currency = 'EUR'
  order by snapshot.completed_at desc nulls last, snapshot.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('status', 'STALE_OR_INVALID_SNAPSHOT');
  end if;

  for v_candidate in
    select candidate.id
    from public.meta_content_candidates candidate
    left join public.meta_organic_boost_links link_row
      on link_row.content_candidate_id = candidate.id
    left join public.meta_content_boost_overrides override_row
      on override_row.content_candidate_id = candidate.id
     and override_row.platform_account_id = candidate.platform_account_id
    where candidate.platform_account_id = p_platform_account_id
      and candidate.user_id = p_user_id
      and candidate.is_new
      and link_row.id is null
      and coalesce(override_row.mode, 'INHERIT') <> 'SKIP'
      and (
        v_settings.source_filter = 'both'
        or candidate.source = v_settings.source_filter
      )
    order by candidate.published_at desc nulls last, candidate.first_seen_at desc
    limit 20
  loop
    begin
      v_result := public.materialize_meta_organic_boost_plan(
        p_platform_account_id,
        p_user_id,
        v_policy.id,
        v_snapshot.id,
        p_source_marketing_sync_id,
        p_read_lease_token,
        v_candidate.id,
        v_settings.id,
        p_planned_at
      );

      if v_result->>'outcome' = 'QUEUED' then
        v_created := v_created + 1;
      elsif v_result->>'outcome' = 'EXISTING' then
        v_existing := v_existing + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'status', 'PLANNED',
    'plans_created', v_created,
    'plans_existing', v_existing,
    'candidates_skipped', v_skipped,
    'candidates_failed', v_failed,
    'settings_id', v_settings.id
  );
end;
$$;

revoke all on function public.run_meta_organic_boost_planner(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.run_meta_organic_boost_planner(
  uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on table public.meta_boost_settings is
  'Per-tenant Meta organic post-boost defaults; one current version per account.';
comment on table public.meta_content_boost_overrides is
  'Optional per-post overrides for organic boost budget, duration, CTA, or skip.';
comment on function public.run_meta_organic_boost_planner(uuid, uuid, uuid, uuid, timestamptz) is
  'After marketing sync: turns new Facebook page posts into organic boost plans when auto-boost is enabled.';

commit;

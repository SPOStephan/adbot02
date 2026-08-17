-- Narrow exclusive-idle for Aktiv-Launch Freigabe:
-- held canaries (not_before=infinity) and future-scheduled plans no longer block.
-- Still blocks due PENDING/RETRYABLE, in-flight statuses, and live leases.

create or replace function public.meta_launch_account_blocks_exclusive_approve(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_excluding_plan_id uuid,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.mutation_plans other
      where other.user_id = p_user_id
        and other.platform_account_id = p_platform_account_id
        and other.id is distinct from p_excluding_plan_id
        and not other.safety_action
        and (
          other.status in (
            'CLAIMED',
            'EXECUTING',
            'RECONCILING',
            'COMPENSATION_REQUIRED'
          )
          or (
            other.status in ('PENDING', 'RETRYABLE')
            and coalesce(other.not_before, '-infinity'::timestamptz) <= p_as_of
          )
        )
    )
    or exists (
      select 1
      from public.meta_account_operation_leases lease
      where lease.user_id = p_user_id
        and lease.platform_account_id = p_platform_account_id
        and lease.expires_at > p_as_of
    );
$$;

revoke all on function public.meta_launch_account_blocks_exclusive_approve(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.meta_launch_account_blocks_exclusive_approve(
  uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.meta_launch_account_blocks_exclusive_approve(
  uuid, uuid, uuid, timestamptz
) is
  'True when another due/executing mutation or live lease blocks exclusive Aktiv-Launch approve. Held (infinity) and future-scheduled plans are ignored.';


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

-- Asset-scoped organic boost defaults + Kampagnen overview for Adbot push campaigns.
-- Customers can boost all connected page/IG assets or only selected ones, with
-- optional per-asset daily budget and duration overrides. Kampagnen lists
-- Adbot-started organic boost campaigns with spend, remaining budget, and runtime.

begin;

alter table public.meta_boost_settings
  add column if not exists asset_scope text;

update public.meta_boost_settings
set asset_scope = 'ALL'
where asset_scope is null;

alter table public.meta_boost_settings
  alter column asset_scope set default 'ALL';

alter table public.meta_boost_settings
  alter column asset_scope set not null;

alter table public.meta_boost_settings
  drop constraint if exists meta_boost_settings_asset_scope_check;

alter table public.meta_boost_settings
  add constraint meta_boost_settings_asset_scope_check
  check (asset_scope in ('ALL', 'SELECTED'));

create table if not exists public.meta_boost_asset_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  meta_asset_id uuid not null
    references public.meta_assets(id) on delete cascade,
  included boolean not null default false,
  daily_budget_minor bigint
    check (daily_budget_minor is null or daily_budget_minor > 0),
  duration_days integer
    check (duration_days is null or duration_days between 1 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_boost_asset_settings_account_asset_key
    unique (platform_account_id, meta_asset_id),
  constraint meta_boost_asset_settings_override_check check (
    daily_budget_minor is null
    or duration_days is null
    or true
  )
);

create index if not exists meta_boost_asset_settings_user_idx
  on public.meta_boost_asset_settings (user_id, platform_account_id);

create index if not exists meta_boost_asset_settings_included_idx
  on public.meta_boost_asset_settings (platform_account_id, included)
  where included;

drop trigger if exists guard_meta_boost_asset_settings_tenant_scope
  on public.meta_boost_asset_settings;
create trigger guard_meta_boost_asset_settings_tenant_scope
  before insert or update on public.meta_boost_asset_settings
  for each row execute function public.guard_meta_control_tenant_scope();

alter table public.meta_boost_asset_settings enable row level security;

revoke all on public.meta_boost_asset_settings from anon, authenticated;
grant select on public.meta_boost_asset_settings to authenticated;
grant all on public.meta_boost_asset_settings to service_role;

drop policy if exists meta_boost_asset_settings_select_own
  on public.meta_boost_asset_settings;
create policy meta_boost_asset_settings_select_own
  on public.meta_boost_asset_settings for select to authenticated
  using ((select auth.uid()) = user_id);

-- Dashboard reads for boost campaign budget / runtime.
grant select (
  id,
  user_id,
  platform_account_id,
  name,
  objective,
  status,
  effective_status,
  platform_campaign_id,
  daily_budget_minor,
  lifetime_budget_minor,
  budget_remaining_minor,
  start_time,
  stop_time,
  platform_updated_time,
  is_current
) on table public.campaigns to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  status,
  created_at,
  action_type,
  source_rule_key,
  payload_hash,
  planned_payload
) on table public.mutation_plans to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  asset_type,
  meta_asset_id,
  name,
  username,
  last_synced_at
) on table public.meta_assets to authenticated;

drop function if exists public.put_meta_boost_settings_version(
  uuid, uuid, text, text, bigint, bigint, integer, text, text, text, text[], text, text
);

create or replace function public.put_meta_boost_settings_version(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_boost_mode text,
  p_budget_mode text,
  p_daily_budget_minor bigint,
  p_lifetime_budget_minor bigint,
  p_duration_days integer,
  p_budget_owner_type text,
  p_objective text,
  p_source_filter text,
  p_default_countries text[],
  p_default_cta_type text,
  p_default_destination_url text,
  p_asset_scope text default 'ALL',
  p_asset_settings jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_version integer;
  v_current public.meta_boost_settings%rowtype;
  v_payload jsonb;
  v_hash text;
  v_countries text[];
  v_enabled boolean;
  v_auto boolean;
  v_require_manual boolean;
  v_asset_scope text;
  v_asset jsonb;
  v_asset_id uuid;
  v_included boolean;
  v_asset_daily bigint;
  v_asset_days integer;
  v_selected_count integer := 0;
  v_normalized_assets jsonb := '[]'::jsonb;
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_boost_mode not in ('OFF', 'REVIEW', 'AUTO')
    or p_budget_mode not in ('DAILY', 'LIFETIME')
    or p_duration_days is null
    or p_duration_days < 1
    or p_duration_days > 90
    or p_budget_owner_type not in ('CAMPAIGN', 'AD_SET')
    or p_objective not in ('OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT')
    or p_source_filter not in ('facebook', 'instagram', 'both')
    or coalesce(p_asset_scope, 'ALL') not in ('ALL', 'SELECTED') then
    raise exception 'Boost settings input is incomplete or invalid';
  end if;

  v_asset_scope := coalesce(p_asset_scope, 'ALL');

  if p_boost_mode = 'AUTO' and p_budget_mode <> 'DAILY' then
    raise exception 'Automatic boost mode requires a daily budget with fixed duration';
  end if;

  if p_budget_mode = 'DAILY' then
    if p_daily_budget_minor is null or p_daily_budget_minor <= 0
      or p_lifetime_budget_minor is not null then
      raise exception 'Daily boost budget is invalid';
    end if;
  else
    if p_lifetime_budget_minor is null or p_lifetime_budget_minor <= 0
      or p_daily_budget_minor is not null
      or p_budget_owner_type <> 'CAMPAIGN' then
      raise exception 'Lifetime boost budget is invalid';
    end if;
  end if;

  if (p_default_cta_type is null) <> (p_default_destination_url is null) then
    raise exception 'CTA type and destination URL must be set together';
  end if;

  if p_default_destination_url is not null
    and p_default_destination_url !~ '^https://[^/\s]+' then
    raise exception 'Boost destination URL must be HTTPS';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and pa.marketing_currency = 'EUR'
  ) then
    raise exception 'Boost settings require an active EUR Meta account';
  end if;

  v_countries := coalesce(p_default_countries, array['DE']::text[]);
  if cardinality(v_countries) < 1 or cardinality(v_countries) > 50 then
    raise exception 'Boost country targeting is invalid';
  end if;

  if jsonb_typeof(coalesce(p_asset_settings, '[]'::jsonb)) <> 'array' then
    raise exception 'Boost asset settings must be a JSON array';
  end if;

  if jsonb_array_length(coalesce(p_asset_settings, '[]'::jsonb)) > 100 then
    raise exception 'Too many boost asset settings';
  end if;

  for v_asset in
    select value
    from jsonb_array_elements(coalesce(p_asset_settings, '[]'::jsonb))
  loop
    if jsonb_typeof(v_asset) <> 'object'
      or coalesce(v_asset->>'meta_asset_id', '') !~ '^[0-9a-f-]{36}$' then
      raise exception 'Boost asset setting is invalid';
    end if;

    v_asset_id := (v_asset->>'meta_asset_id')::uuid;
    v_included := coalesce((v_asset->>'included')::boolean, false);

    if v_asset ? 'daily_budget_minor'
      and v_asset->>'daily_budget_minor' is not null
      and v_asset->>'daily_budget_minor' <> '' then
      if (v_asset->>'daily_budget_minor') !~ '^[1-9][0-9]*$' then
        raise exception 'Asset daily budget is invalid';
      end if;
      v_asset_daily := (v_asset->>'daily_budget_minor')::bigint;
    else
      v_asset_daily := null;
    end if;

    if v_asset ? 'duration_days'
      and v_asset->>'duration_days' is not null
      and v_asset->>'duration_days' <> '' then
      if (v_asset->>'duration_days') !~ '^[1-9][0-9]*$'
        or (v_asset->>'duration_days')::integer > 90 then
        raise exception 'Asset duration is invalid';
      end if;
      v_asset_days := (v_asset->>'duration_days')::integer;
    else
      v_asset_days := null;
    end if;

    if not exists (
      select 1
      from public.meta_assets asset
      where asset.id = v_asset_id
        and asset.user_id = p_user_id
        and asset.platform_account_id = p_platform_account_id
        and asset.asset_type in ('facebook_page', 'instagram_account')
    ) then
      raise exception 'Boost asset is not a connected page or Instagram account';
    end if;

    if v_included then
      v_selected_count := v_selected_count + 1;
    end if;

    v_normalized_assets := v_normalized_assets || jsonb_build_array(
      jsonb_build_object(
        'meta_asset_id', v_asset_id,
        'included', v_included,
        'daily_budget_minor', v_asset_daily,
        'duration_days', v_asset_days
      )
    );
  end loop;

  if p_boost_mode <> 'OFF'
    and v_asset_scope = 'SELECTED'
    and v_selected_count < 1 then
    raise exception 'Selected asset boost scope requires at least one included asset';
  end if;

  if p_boost_mode = 'OFF' then
    v_enabled := false;
    v_auto := false;
    v_require_manual := true;
  elsif p_boost_mode = 'REVIEW' then
    v_enabled := true;
    v_auto := true;
    v_require_manual := true;
  else
    v_enabled := true;
    v_auto := true;
    v_require_manual := false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('boost-settings:' || p_platform_account_id::text, 0)
  );

  select settings.* into v_current
  from public.meta_boost_settings settings
  where settings.platform_account_id = p_platform_account_id
    and settings.user_id = p_user_id
    and settings.is_current
  for update;

  v_payload := jsonb_build_object(
    'schema_version', 3,
    'boost_mode', p_boost_mode,
    'enabled', v_enabled,
    'auto_boost_new_candidates', v_auto,
    'require_manual_approval', v_require_manual,
    'budget_mode', p_budget_mode,
    'daily_budget_minor', p_daily_budget_minor,
    'lifetime_budget_minor', p_lifetime_budget_minor,
    'duration_days', p_duration_days,
    'budget_owner_type', p_budget_owner_type,
    'objective', p_objective,
    'optimization_goal', 'POST_ENGAGEMENT',
    'source_filter', p_source_filter,
    'default_countries', to_jsonb(v_countries),
    'default_cta_type', p_default_cta_type,
    'default_destination_url', p_default_destination_url,
    'asset_scope', v_asset_scope,
    'asset_settings', v_normalized_assets
  );
  v_hash := public.meta_sha256(v_payload::text);

  if v_current.id is not null and v_current.settings_hash = v_hash then
    return v_current.id;
  end if;

  select coalesce(max(settings.version), 0) + 1
  into v_version
  from public.meta_boost_settings settings
  where settings.platform_account_id = p_platform_account_id
    and settings.user_id = p_user_id;

  if v_current.id is not null then
    update public.meta_boost_settings
    set is_current = false, updated_at = now()
    where id = v_current.id;
  end if;

  insert into public.meta_boost_settings (
    id, user_id, platform_account_id, version, is_current,
    boost_mode, enabled, auto_boost_new_candidates, require_manual_approval,
    budget_mode, daily_budget_minor, lifetime_budget_minor, duration_days,
    budget_owner_type, objective, optimization_goal, billing_event,
    source_filter, default_countries, default_cta_type, default_destination_url,
    asset_scope, settings_hash, customer_confirmed_at, customer_confirmed_by
  ) values (
    v_id, p_user_id, p_platform_account_id, v_version, true,
    p_boost_mode, v_enabled, v_auto, v_require_manual,
    p_budget_mode, p_daily_budget_minor, p_lifetime_budget_minor, p_duration_days,
    p_budget_owner_type, p_objective, 'POST_ENGAGEMENT', 'IMPRESSIONS',
    p_source_filter, v_countries, p_default_cta_type, p_default_destination_url,
    v_asset_scope, v_hash, now(), p_user_id
  );

  delete from public.meta_boost_asset_settings
  where platform_account_id = p_platform_account_id
    and user_id = p_user_id;

  insert into public.meta_boost_asset_settings (
    user_id, platform_account_id, meta_asset_id, included,
    daily_budget_minor, duration_days
  )
  select
    p_user_id,
    p_platform_account_id,
    (item->>'meta_asset_id')::uuid,
    coalesce((item->>'included')::boolean, false),
    case
      when item->>'daily_budget_minor' is null then null
      else (item->>'daily_budget_minor')::bigint
    end,
    case
      when item->>'duration_days' is null then null
      else (item->>'duration_days')::integer
    end
  from jsonb_array_elements(v_normalized_assets) as item;

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'CUSTOMER_BOOST_SETTINGS_CONFIRMED',
    coalesce(to_jsonb(v_current), '{}'::jsonb),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object(
      'settings_id', v_id,
      'version', v_version,
      'boost_mode', p_boost_mode,
      'asset_scope', v_asset_scope,
      'selected_asset_count', v_selected_count
    ),
    jsonb_build_object('settings_hash', v_hash),
    null, null, null, null, null, now()
  );

  return v_id;
end;
$$;

revoke all on function public.put_meta_boost_settings_version(
  uuid, uuid, text, text, bigint, bigint, integer, text, text, text, text[], text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.put_meta_boost_settings_version(
  uuid, uuid, text, text, bigint, bigint, integer, text, text, text, text[], text, text, text, jsonb
) to service_role;

comment on column public.meta_boost_settings.asset_scope is
  'ALL = every connected page/IG asset (subject to source filter); SELECTED = only assets marked included in meta_boost_asset_settings.';
comment on table public.meta_boost_asset_settings is
  'Optional per-asset organic boost inclusion and budget/duration overrides for the current account settings.';


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
    left join public.meta_boost_asset_settings asset_settings
      on asset_settings.meta_asset_id = candidate.meta_asset_id
     and asset_settings.platform_account_id = candidate.platform_account_id
     and asset_settings.user_id = candidate.user_id
    where candidate.platform_account_id = p_platform_account_id
      and candidate.user_id = p_user_id
      and candidate.is_new
      and link_row.id is null
      and coalesce(override_row.mode, 'INHERIT') <> 'SKIP'
      and (
        v_settings.source_filter = 'both'
        or candidate.source = v_settings.source_filter
      )
      and (
        coalesce(v_settings.asset_scope, 'ALL') = 'ALL'
        or coalesce(asset_settings.included, false) is true
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
  created_at timestamptz
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
      plan.planned_payload
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
    boost.created_at
  from boost_links boost
  left join bound on bound.link_id = boost.link_id
  left join perf on perf.campaign_id = bound.campaign_id
  order by boost.created_at desc;
end;
$$;

revoke all on function public.list_meta_organic_boost_campaigns(uuid)
  from public, anon, authenticated;
grant execute on function public.list_meta_organic_boost_campaigns(uuid)
  to authenticated, service_role;

comment on function public.list_meta_organic_boost_campaigns(uuid) is
  'Customer dashboard: Adbot organic Beitrag-Push campaigns with budget, runtime, spend, and Meta post engagements when available.';

commit;

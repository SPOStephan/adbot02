begin;

alter table public.ad_platform_launches
  add column if not exists operation_token uuid,
  add column if not exists operation_started_at timestamptz;

alter table public.platform_accounts
  add column if not exists credential_generation uuid not null default gen_random_uuid(),
  add column if not exists provider_sync_claim_token uuid,
  add column if not exists provider_sync_claimed_at timestamptz;

alter table public.ad_platform_sync_runs
  add column if not exists sync_claim_token uuid,
  add column if not exists credential_generation uuid;

create index if not exists ad_platform_launches_openai_recovery_idx
  on public.ad_platform_launches (status, updated_at)
  where platform = 'openai_ads'
    and status in ('creating', 'activating', 'activation_uncertain');

create or replace function public.guard_openai_ads_launch_contract_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.request_payload is distinct from new.request_payload
     or old.idempotency_key is distinct from new.idempotency_key
     or old.platform_account_id is distinct from new.platform_account_id
     or old.user_id is distinct from new.user_id
     or old.platform is distinct from new.platform then
    raise exception 'openai_ads_launch_contract_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_openai_ads_launch_contract_immutable()
  from public, anon, authenticated;
grant execute on function public.guard_openai_ads_launch_contract_immutable()
  to service_role;

drop trigger if exists guard_openai_ads_launch_contract_immutable
  on public.ad_platform_launches;
create trigger guard_openai_ads_launch_contract_immutable
before update on public.ad_platform_launches
for each row
when (old.platform = 'openai_ads' or new.platform = 'openai_ads')
execute function public.guard_openai_ads_launch_contract_immutable();

create or replace function public.is_valid_openai_ads_paused_daily_contract(
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_daily numeric;
  v_bid numeric;
  v_start numeric;
  v_end numeric;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'contractVersion' <> 'paused_campaign_daily_v1'
    or coalesce(btrim(p_payload->>'remoteAccountId'), '') = ''
    or coalesce(p_payload->>'currency', '') !~ '^[A-Z]{3}$'
    or coalesce(btrim(p_payload->>'accountTimezone'), '') = ''
    or coalesce(btrim(p_payload->>'campaignName'), '') = ''
    or not (p_payload ? 'campaignDescription')
    or coalesce(
      jsonb_typeof(p_payload->'campaignDescription') not in ('string', 'null'),
      true
    )
    or (
      jsonb_typeof(p_payload->'campaignDescription') = 'string'
      and btrim(p_payload->>'campaignDescription') = ''
    )
    or coalesce(p_payload->>'biddingType', '') not in ('impressions', 'clicks')
    or coalesce(p_payload->>'billingEventType', '') not in ('impression', 'click')
    or (p_payload->>'biddingType' = 'clicks'
      and p_payload->>'billingEventType' <> 'click')
    or (p_payload->>'biddingType' = 'impressions'
      and p_payload->>'billingEventType' <> 'impression')
    or coalesce(jsonb_typeof(p_payload->'dailyBudgetMicros') <> 'number', true)
    or coalesce(jsonb_typeof(p_payload->'maxBidMicros') <> 'number', true)
    or not (p_payload ? 'startTime')
    or coalesce(
      jsonb_typeof(p_payload->'startTime') not in ('number', 'null'),
      true
    )
    or not (p_payload ? 'endTime')
    or coalesce(
      jsonb_typeof(p_payload->'endTime') not in ('number', 'null'),
      true
    )
    or coalesce(jsonb_typeof(p_payload->'locationIds') <> 'array', true)
    or coalesce(btrim(p_payload->>'adGroupName'), '') = ''
    or coalesce(jsonb_typeof(p_payload->'contextHints') <> 'array', true)
    or coalesce(btrim(p_payload->>'adName'), '') = ''
    or coalesce(btrim(p_payload->>'title'), '') = ''
    or coalesce(btrim(p_payload->>'body'), '') = ''
    or coalesce(p_payload->>'targetUrl', '') !~ '^https://'
    or coalesce(p_payload->>'imageUrl', '') !~ '^https://'
  then
    return false;
  end if;

  if jsonb_array_length(p_payload->'locationIds') = 0
    or exists (
      select 1 from jsonb_array_elements(p_payload->'locationIds') item
      where jsonb_typeof(item) <> 'string' or btrim(item #>> '{}') = ''
    )
    or jsonb_array_length(p_payload->'contextHints') = 0
    or exists (
      select 1 from jsonb_array_elements(p_payload->'contextHints') item
      where jsonb_typeof(item) <> 'string' or btrim(item #>> '{}') = ''
    )
  then
    return false;
  end if;

  begin
    v_daily := (p_payload->>'dailyBudgetMicros')::numeric;
    v_bid := (p_payload->>'maxBidMicros')::numeric;
    v_start := case when jsonb_typeof(p_payload->'startTime') = 'number'
      then (p_payload->>'startTime')::numeric else null end;
    v_end := case when jsonb_typeof(p_payload->'endTime') = 'number'
      then (p_payload->>'endTime')::numeric else null end;
  exception when others then
    return false;
  end;

  if v_daily < 1000000
    or v_daily <> trunc(v_daily)
    or v_daily > 9007199254740991
    or v_bid <= 0
    or v_bid <> trunc(v_bid)
    or v_bid > 30400000000000
    or (v_start is not null and (
      v_start <> trunc(v_start) or v_start < 946684800 or v_start > 4102444800
    ))
    or (v_end is not null and (
      v_end <> trunc(v_end) or v_end < 946684800 or v_end > 4102444800
    ))
    or (v_start is not null and v_end is not null and v_end <= v_start)
  then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.is_valid_openai_ads_paused_daily_contract(jsonb)
  from public, anon, authenticated;
grant execute on function public.is_valid_openai_ads_paused_daily_contract(jsonb)
  to service_role;

create or replace function public.is_empty_openai_ads_targeting_dimension(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_value is null or p_value = 'null'::jsonb then
    return true;
  end if;
  if jsonb_typeof(p_value) = 'array' then
    return not exists (
      select 1
      from jsonb_array_elements(p_value) item
      where not public.is_empty_openai_ads_targeting_dimension(item)
    );
  end if;
  if jsonb_typeof(p_value) = 'object' then
    return not exists (
      select 1
      from jsonb_each(p_value) item
      where not public.is_empty_openai_ads_targeting_dimension(item.value)
    );
  end if;
  return false;
end;
$$;

create or replace function public.is_neutral_openai_ads_landing_configuration(
  p_value jsonb
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then true
    when jsonb_typeof(p_value) <> 'object' then false
    when exists (
      select 1 from jsonb_object_keys(p_value) key
      where key <> 'query_string_template'
    ) then false
    when not (p_value ? 'query_string_template') then false
    else coalesce(p_value->>'query_string_template', '') = ''
  end
$$;

create or replace function public.openai_ads_jsonb_text_sets_equal(
  p_left jsonb,
  p_right jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_left text[];
  v_right text[];
begin
  if jsonb_typeof(p_left) <> 'array' or jsonb_typeof(p_right) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(p_left) item
      where jsonb_typeof(item) <> 'string' or btrim(item #>> '{}') = ''
    )
    or exists (
      select 1 from jsonb_array_elements(p_right) item
      where jsonb_typeof(item) <> 'string' or btrim(item #>> '{}') = ''
    )
  then
    return false;
  end if;
  select array_agg(distinct item #>> '{}' order by item #>> '{}')
    into v_left from jsonb_array_elements(p_left) item;
  select array_agg(distinct item #>> '{}' order by item #>> '{}')
    into v_right from jsonb_array_elements(p_right) item;
  return coalesce(v_left = v_right, false);
end;
$$;

create or replace function public.openai_ads_targeting_matches_locations(
  p_targeting jsonb,
  p_locations jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_dimension record;
  v_provider_ids text[];
  v_contract_ids text[];
begin
  if jsonb_typeof(p_targeting) <> 'object'
    or jsonb_typeof(p_targeting->'locations') <> 'object'
    or jsonb_typeof(p_targeting->'locations'->'include') <> 'array'
    or jsonb_typeof(p_locations) <> 'array'
  then
    return false;
  end if;

  for v_dimension in select key, value from jsonb_each(p_targeting) loop
    if v_dimension.key <> 'locations'
      and not public.is_empty_openai_ads_targeting_dimension(v_dimension.value)
    then
      return false;
    end if;
  end loop;
  for v_dimension in
    select key, value from jsonb_each(p_targeting->'locations')
  loop
    if v_dimension.key <> 'include'
      and not public.is_empty_openai_ads_targeting_dimension(v_dimension.value)
    then
      return false;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_targeting->'locations'->'include') item
    where jsonb_typeof(item) <> 'object'
      or coalesce(btrim(item->>'id'), '') = ''
  ) then
    return false;
  end if;

  select array_agg(distinct item->>'id' order by item->>'id')
    into v_provider_ids
  from jsonb_array_elements(p_targeting->'locations'->'include') item;
  select array_agg(distinct item #>> '{}' order by item #>> '{}')
    into v_contract_ids
  from jsonb_array_elements(p_locations) item;
  return coalesce(v_provider_ids = v_contract_ids, false);
end;
$$;

create or replace function public.openai_ads_serving_issues_allowed(
  p_value jsonb,
  p_level text,
  p_expected_status text,
  p_review_status text
)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_code text;
begin
  if jsonb_typeof(p_value) <> 'array'
    or p_level not in ('campaign', 'ad_group', 'ad')
    or p_expected_status not in ('paused', 'active')
  then
    return false;
  end if;
  if p_expected_status = 'active' then
    return jsonb_array_length(p_value) = 0;
  end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item) <> 'object' then return false; end if;
    v_code := v_item->>'code';
    if coalesce(v_code, '') = '' then return false; end if;
    if p_level = 'campaign' and v_code in (
      'campaign_not_active', 'campaign_has_no_serving_ready_ad_groups',
      'ad_group_not_active'
    ) then continue; end if;
    if p_level = 'ad_group' and v_code in (
      'campaign_not_active', 'ad_group_not_active',
      'ad_group_has_no_serving_ready_ads'
    ) then continue; end if;
    if p_level = 'ad' and v_code in (
      'campaign_not_active', 'ad_group_not_active', 'ad_not_active'
    ) then continue; end if;
    if lower(coalesce(p_review_status, '')) = 'in_review'
      and v_code in ('review_not_approved', 'ad_in_review')
    then continue; end if;
    if lower(coalesce(p_review_status, '')) = 'in_review'
      and p_level in ('campaign', 'ad_group')
      and v_code in (
        'partial_serving_review_not_approved', 'partial_serving_ad_in_review'
      )
    then continue; end if;
    return false;
  end loop;
  return true;
end;
$$;

create or replace function public.openai_ads_jsonb_nonnegative_number(
  p_value jsonb,
  p_require_integer boolean
)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_value numeric;
begin
  if jsonb_typeof(p_value) <> 'number' then return false; end if;
  v_value := (p_value #>> '{}')::numeric;
  return v_value >= 0
    and (not p_require_integer or trunc(v_value) = v_value)
    and (not p_require_integer or v_value <= 9007199254740991);
exception when others then
  return false;
end;
$$;

revoke all on function public.is_empty_openai_ads_targeting_dimension(jsonb)
  from public, anon, authenticated;
revoke all on function public.is_neutral_openai_ads_landing_configuration(jsonb)
  from public, anon, authenticated;
revoke all on function public.openai_ads_jsonb_text_sets_equal(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.openai_ads_targeting_matches_locations(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.openai_ads_serving_issues_allowed(jsonb, text, text, text)
  from public, anon, authenticated;
revoke all on function public.openai_ads_jsonb_nonnegative_number(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.is_empty_openai_ads_targeting_dimension(jsonb)
  to service_role;
grant execute on function public.is_neutral_openai_ads_landing_configuration(jsonb)
  to service_role;
grant execute on function public.openai_ads_jsonb_text_sets_equal(jsonb, jsonb)
  to service_role;
grant execute on function public.openai_ads_targeting_matches_locations(jsonb, jsonb)
  to service_role;
grant execute on function public.openai_ads_serving_issues_allowed(jsonb, text, text, text)
  to service_role;
grant execute on function public.openai_ads_jsonb_nonnegative_number(jsonb, boolean)
  to service_role;

create or replace function public.claim_openai_ads_account_sync(
  p_platform_account_id uuid,
  p_user_id uuid default null,
  p_stale_after_seconds integer default 900
)
returns table (sync_claim_token uuid, credential_generation uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_token uuid := gen_random_uuid();
begin
  if p_stale_after_seconds < 60 or p_stale_after_seconds > 3600 then
    raise exception 'invalid_stale_after_seconds';
  end if;
  return query
  update public.platform_accounts pa
  set
    provider_sync_status = 'syncing',
    provider_sync_error_code = null,
    provider_last_sync_started_at = now(),
    provider_sync_claim_token = v_claim_token,
    provider_sync_claimed_at = now(),
    updated_at = now()
  where pa.id = p_platform_account_id
    and pa.platform = 'openai_ads'
    and pa.revoked_at is null
    and pa.access_token_encrypted is not null
    and (p_user_id is null or pa.user_id = p_user_id)
    and (
      pa.provider_sync_status <> 'syncing'
      or pa.provider_sync_claimed_at is null
      or pa.provider_sync_claimed_at
        < now() - make_interval(secs => p_stale_after_seconds)
    )
    and (
      pa.provider_backoff_until is null
      or pa.provider_backoff_until <= now()
    )
  returning pa.provider_sync_claim_token, pa.credential_generation;
end;
$$;

create or replace function public.fail_openai_ads_account_sync(
  p_platform_account_id uuid,
  p_sync_run_id uuid,
  p_sync_claim_token uuid,
  p_credential_generation uuid,
  p_error_code text,
  p_backoff_until timestamptz,
  p_retire_credential boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finished boolean := false;
begin
  update public.platform_accounts pa
  set
    provider_sync_status = case
      when p_retire_credential then 'revoked' else 'error'
    end,
    provider_sync_error_code = p_error_code,
    provider_backoff_until = case
      when p_retire_credential then null else p_backoff_until
    end,
    provider_next_sync_at = case
      when p_retire_credential then null else p_backoff_until
    end,
    provider_consecutive_failures = pa.provider_consecutive_failures + 1,
    access_token_encrypted = case
      when p_retire_credential then null else pa.access_token_encrypted
    end,
    token_iv = case when p_retire_credential then null else pa.token_iv end,
    token_auth_tag = case
      when p_retire_credential then null else pa.token_auth_tag
    end,
    credential_kind = case
      when p_retire_credential then null else pa.credential_kind
    end,
    revoked_at = case when p_retire_credential then now() else pa.revoked_at end,
    provider_sync_claim_token = null,
    provider_sync_claimed_at = null,
    updated_at = now()
  where pa.id = p_platform_account_id
    and pa.platform = 'openai_ads'
    and pa.provider_sync_claim_token = p_sync_claim_token
    and pa.credential_generation = p_credential_generation;
  v_finished := found;

  if p_sync_run_id is not null then
    update public.ad_platform_sync_runs sr
    set
      status = 'error',
      completed_at = now(),
      error_code = case when v_finished then p_error_code else 'sync_superseded' end
    where sr.id = p_sync_run_id
      and sr.platform_account_id = p_platform_account_id
      and sr.platform = 'openai_ads'
      and sr.status = 'running'
      and sr.sync_claim_token = p_sync_claim_token
      and sr.credential_generation = p_credential_generation;
  end if;
  return v_finished;
end;
$$;

revoke all on function public.claim_openai_ads_account_sync(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fail_openai_ads_account_sync(
  uuid, uuid, uuid, uuid, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.claim_openai_ads_account_sync(uuid, uuid, integer)
  to service_role;
grant execute on function public.fail_openai_ads_account_sync(
  uuid, uuid, uuid, uuid, text, timestamptz, boolean
) to service_role;

update public.ad_platform_launches
set
  status = 'activation_uncertain',
  error_code = 'legacy_active_contract_unverified',
  updated_at = now()
where platform = 'openai_ads'
  and status = 'active'
  and not coalesce(
    public.is_valid_openai_ads_paused_daily_contract(request_payload),
    false
  );

create or replace function public.claim_openai_ads_launch_operation(
  p_launch_id uuid,
  p_user_id uuid,
  p_from_statuses text[],
  p_to_status text,
  p_stale_after_seconds integer default 300
)
returns table (
  id uuid,
  user_id uuid,
  platform_account_id uuid,
  status text,
  idempotency_key text,
  request_payload jsonb,
  remote_campaign_id text,
  remote_ad_group_id text,
  remote_ad_id text,
  remote_file_id text,
  review_status text,
  operation_token uuid,
  operation_started_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  if p_to_status not in ('creating', 'activating') then
    raise exception 'invalid_target_status';
  end if;
  if coalesce(cardinality(p_from_statuses), 0) = 0 then
    raise exception 'source_status_required';
  end if;

  return query
  update public.ad_platform_launches launch
  set status = p_to_status,
      operation_token = v_token,
      operation_started_at = now(),
      error_code = null,
      updated_at = now()
  where launch.id = p_launch_id
    and launch.user_id = p_user_id
    and launch.platform = 'openai_ads'
    and (
      (
        launch.status = any(p_from_statuses)
        and launch.status <> p_to_status
      )
      or (
        launch.status = p_to_status
        and (
          launch.operation_token is null
          or launch.operation_started_at is null
          or launch.operation_started_at < now() - make_interval(
            secs => greatest(60, least(3600, p_stale_after_seconds))
          )
        )
      )
    )
  returning
    launch.id,
    launch.user_id,
    launch.platform_account_id,
    launch.status,
    launch.idempotency_key,
    launch.request_payload,
    launch.remote_campaign_id,
    launch.remote_ad_group_id,
    launch.remote_ad_id,
    launch.remote_file_id,
    launch.review_status,
    launch.operation_token,
    launch.operation_started_at;
end;
$$;

revoke all on function public.claim_openai_ads_launch_operation(
  uuid, uuid, text[], text, integer
) from public, anon, authenticated;
grant execute on function public.claim_openai_ads_launch_operation(
  uuid, uuid, text[], text, integer
) to service_role;

create or replace function public.finish_openai_ads_launch_operation(
  p_launch_id uuid,
  p_operation_token uuid,
  p_values jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := nullif(p_values->>'status', '');
begin
  if v_status is null or v_status not in (
    'creating', 'paused', 'in_review', 'ready_to_activate', 'activating',
    'active', 'blocked', 'failed', 'activation_uncertain'
  ) then
    raise exception 'invalid_launch_status';
  end if;
  if p_values - array[
    'status', 'remote_campaign_id', 'remote_ad_group_id', 'remote_ad_id',
    'remote_file_id', 'review_status', 'error_code', 'activated_at'
  ] <> '{}'::jsonb then
    raise exception 'unsupported_launch_update';
  end if;

  update public.ad_platform_launches launch
  set status = v_status,
      remote_campaign_id = case when p_values ? 'remote_campaign_id'
        then nullif(p_values->>'remote_campaign_id', '') else launch.remote_campaign_id end,
      remote_ad_group_id = case when p_values ? 'remote_ad_group_id'
        then nullif(p_values->>'remote_ad_group_id', '') else launch.remote_ad_group_id end,
      remote_ad_id = case when p_values ? 'remote_ad_id'
        then nullif(p_values->>'remote_ad_id', '') else launch.remote_ad_id end,
      remote_file_id = case when p_values ? 'remote_file_id'
        then nullif(p_values->>'remote_file_id', '') else launch.remote_file_id end,
      review_status = case when p_values ? 'review_status'
        then nullif(p_values->>'review_status', '') else launch.review_status end,
      error_code = case when p_values ? 'error_code'
        then nullif(p_values->>'error_code', '') else launch.error_code end,
      activated_at = case when p_values ? 'activated_at'
        then nullif(p_values->>'activated_at', '')::timestamptz else launch.activated_at end,
      operation_token = null,
      operation_started_at = null,
      updated_at = now()
  where launch.id = p_launch_id
    and launch.platform = 'openai_ads'
    and launch.operation_token = p_operation_token;

  return found;
end;
$$;

revoke all on function public.finish_openai_ads_launch_operation(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_openai_ads_launch_operation(uuid, uuid, jsonb)
  to service_role;

-- Replace the connector-foundation snapshot function explicitly so migration
-- behavior stays deterministic across fresh and already-migrated databases.
create or replace function public.replace_openai_ads_snapshot(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_sync_run_id uuid,
  p_account jsonb,
  p_campaigns jsonb,
  p_ad_groups jsonb,
  p_ads jsonb,
  p_insights jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_count integer;
  ad_group_count integer;
  ad_count integer;
  insight_count integer;
  unsafe_launch_count integer := 0;
  now_at timestamptz := now();
begin
  if jsonb_typeof(p_account) <> 'object'
    or jsonb_typeof(p_campaigns) <> 'array'
    or jsonb_typeof(p_ad_groups) <> 'array'
    or jsonb_typeof(p_ads) <> 'array'
    or jsonb_typeof(p_insights) <> 'array'
  then
    raise exception 'invalid_snapshot_payload';
  end if;

  if jsonb_array_length(p_campaigns) > 10000
    or jsonb_array_length(p_ad_groups) > 50000
    or jsonb_array_length(p_ads) > 100000
    or jsonb_array_length(p_insights) > 500000
  then
    raise exception 'snapshot_payload_limit_exceeded';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_insights) item
    where jsonb_typeof(item) <> 'object'
      or coalesce(btrim(item->>'campaign_id'), '') = ''
      or coalesce(btrim(item->>'date'), '') = ''
      or not coalesce(public.openai_ads_jsonb_nonnegative_number(
        item->'impressions', true
      ), false)
      or not coalesce(public.openai_ads_jsonb_nonnegative_number(
        item->'clicks', true
      ), false)
      or not coalesce(public.openai_ads_jsonb_nonnegative_number(
        item->'spend', false
      ), false)
      or not (item ? 'conversions')
      or (
        item->'conversions' <> 'null'::jsonb
        and not coalesce(public.openai_ads_jsonb_nonnegative_number(
          item->'conversions', true
        ), false)
      )
  ) then
    raise exception 'invalid_snapshot_payload';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'openai_ads'
      and pa.revoked_at is null
      and pa.platform_account_id = p_account->>'id'
  ) then
    raise exception 'openai_ads_connection_not_found';
  end if;

  if (
    select count(*) <> count(distinct item->>'id')
    from jsonb_array_elements(p_campaigns) item
  ) or (
    select count(*) <> count(distinct item->>'id')
    from jsonb_array_elements(p_ad_groups) item
  ) or (
    select count(*) <> count(distinct item->>'id')
    from jsonb_array_elements(p_ads) item
  ) or (
    select count(*) <> count(distinct concat_ws(':', item->>'campaign_id', item->>'date'))
    from jsonb_array_elements(p_insights) item
  ) then
    raise exception 'duplicate_snapshot_identity';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ad_groups) ad_group
    where not exists (
      select 1
      from jsonb_array_elements(p_campaigns) campaign
      where campaign->>'id' = ad_group->>'campaign_id'
    )
  ) or exists (
    select 1
    from jsonb_array_elements(p_ads) ad_item
    where not exists (
      select 1
      from jsonb_array_elements(p_ad_groups) ad_group
      where ad_group->>'id' = ad_item->>'ad_group_id'
    )
  ) or exists (
    select 1
    from jsonb_array_elements(p_insights) insight
    where not exists (
      select 1
      from jsonb_array_elements(p_campaigns) campaign
      where campaign->>'id' = insight->>'campaign_id'
    )
  ) then
    raise exception 'invalid_snapshot_hierarchy';
  end if;

  perform 1
  from public.ad_platform_sync_runs sr
  join public.platform_accounts pa
    on pa.id = sr.platform_account_id
  where sr.id = p_sync_run_id
    and sr.user_id = p_user_id
    and sr.platform_account_id = p_platform_account_id
    and sr.platform = 'openai_ads'
    and sr.status = 'running'
    and sr.sync_claim_token is not null
    and sr.credential_generation is not null
    and pa.provider_sync_claim_token = sr.sync_claim_token
    and pa.credential_generation = sr.credential_generation
    and pa.provider_sync_status = 'syncing'
    and pa.revoked_at is null
  for update of pa, sr;
  if not found then
    raise exception 'openai_ads_sync_run_not_found';
  end if;

  update public.campaigns
  set is_current = false
  where user_id = p_user_id
    and platform_account_id = p_platform_account_id
    and is_current = true;

  insert into public.campaigns (
    user_id,
    platform_account_id,
    platform_campaign_id,
    name,
    status,
    effective_status,
    objective,
    budget_amount,
    budget_amount_micros,
    daily_budget_amount_micros,
    bid_strategy,
    start_time,
    stop_time,
    platform_created_time,
    platform_updated_time,
    provider_data,
    last_seen_at,
    last_seen_sync_id,
    is_current
  )
  select
    p_user_id,
    p_platform_account_id,
    item->>'id',
    item->>'name',
    item->>'status',
    item->>'status',
    coalesce(item->>'objective', item->>'bidding_type'),
    case
      when nullif(item->>'budget_amount_micros', '') is null then null
      else (item->>'budget_amount_micros')::numeric / 1000000
    end,
    nullif(item->>'budget_amount_micros', '')::bigint,
    nullif(item->>'daily_budget_amount_micros', '')::bigint,
    item->>'bidding_type',
    case
      when nullif(item->>'start_time', '') is null then null
      else to_timestamp((item->>'start_time')::double precision)
    end,
    case
      when nullif(item->>'end_time', '') is null then null
      else to_timestamp((item->>'end_time')::double precision)
    end,
    to_timestamp((item->>'created_at')::double precision),
    to_timestamp((item->>'updated_at')::double precision),
    coalesce(item->'provider_data', '{}'::jsonb),
    now_at,
    p_sync_run_id,
    true
  from jsonb_array_elements(p_campaigns) item
  where nullif(item->>'id', '') is not null
    and nullif(item->>'name', '') is not null
  on conflict (platform_account_id, platform_campaign_id)
  do update set
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    objective = excluded.objective,
    budget_amount = excluded.budget_amount,
    budget_amount_micros = excluded.budget_amount_micros,
    daily_budget_amount_micros = excluded.daily_budget_amount_micros,
    bid_strategy = excluded.bid_strategy,
    start_time = excluded.start_time,
    stop_time = excluded.stop_time,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    provider_data = excluded.provider_data,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true;

  update public.ad_groups
  set is_current = false
  where user_id = p_user_id
    and platform_account_id = p_platform_account_id
    and is_current = true;

  insert into public.ad_groups (
    user_id,
    platform_account_id,
    campaign_id,
    platform_ad_group_id,
    name,
    status,
    effective_status,
    billing_event,
    bid_amount_micros,
    bid_strategy,
    platform_created_time,
    platform_updated_time,
    provider_data,
    last_seen_at,
    last_seen_sync_id,
    is_current
  )
  select
    p_user_id,
    p_platform_account_id,
    campaign.id,
    item->>'id',
    item->>'name',
    item->>'status',
    item->>'status',
    item->>'billing_event_type',
    nullif(item->>'max_bid_micros', '')::bigint,
    item->>'bid_strategy',
    to_timestamp((item->>'created_at')::double precision),
    to_timestamp((item->>'updated_at')::double precision),
    coalesce(item->'provider_data', '{}'::jsonb),
    now_at,
    p_sync_run_id,
    true
  from jsonb_array_elements(p_ad_groups) item
  join public.campaigns campaign
    on campaign.platform_account_id = p_platform_account_id
   and campaign.platform_campaign_id = item->>'campaign_id'
  where nullif(item->>'id', '') is not null
    and nullif(item->>'name', '') is not null
  on conflict (platform_account_id, platform_ad_group_id)
  do update set
    campaign_id = excluded.campaign_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    billing_event = excluded.billing_event,
    bid_amount_micros = excluded.bid_amount_micros,
    bid_strategy = excluded.bid_strategy,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    provider_data = excluded.provider_data,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true;

  update public.ads
  set is_current = false
  where user_id = p_user_id
    and platform_account_id = p_platform_account_id
    and is_current = true;

  insert into public.ads (
    user_id,
    platform_account_id,
    ad_group_id,
    platform_ad_id,
    name,
    status,
    effective_status,
    review_status,
    creative_type,
    target_url,
    provider_data,
    platform_created_time,
    platform_updated_time,
    last_seen_at,
    last_seen_sync_id,
    is_current
  )
  select
    p_user_id,
    p_platform_account_id,
    ad_group.id,
    item->>'id',
    item->>'name',
    item->>'status',
    item->>'status',
    item->>'review_status',
    item->>'creative_type',
    item->>'target_url',
    coalesce(item->'provider_data', '{}'::jsonb),
    to_timestamp((item->>'created_at')::double precision),
    to_timestamp((item->>'updated_at')::double precision),
    now_at,
    p_sync_run_id,
    true
  from jsonb_array_elements(p_ads) item
  join public.ad_groups ad_group
    on ad_group.platform_account_id = p_platform_account_id
   and ad_group.platform_ad_group_id = item->>'ad_group_id'
  where nullif(item->>'id', '') is not null
    and nullif(item->>'name', '') is not null
  on conflict (platform_account_id, platform_ad_id)
  do update set
    ad_group_id = excluded.ad_group_id,
    name = excluded.name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    review_status = excluded.review_status,
    creative_type = excluded.creative_type,
    target_url = excluded.target_url,
    provider_data = excluded.provider_data,
    platform_created_time = excluded.platform_created_time,
    platform_updated_time = excluded.platform_updated_time,
    last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id,
    is_current = true;

  -- Reconcile PAUSED and ACTIVE launches. Review approval never implies serving
  -- safety: READY requires an exact PAUSED v1 chain; retaining ACTIVE additionally
  -- requires an exact ACTIVE v1 chain with an approved ad review. Every mismatch
  -- is fail-closed and must be contained immediately after this RPC returns.
  with launch_chain as (
    select
      launch.id,
      launch.status as previous_status,
      launch.error_code as previous_error_code,
      launch.operation_token as previous_operation_token,
      (
        select ad_item->>'review_status'
        from jsonb_array_elements(p_ads) ad_item
        where ad_item->>'id' = launch.remote_ad_id
          and ad_item->>'ad_group_id' = launch.remote_ad_group_id
        limit 1
      ) as provider_review_status,
      coalesce((
        public.is_valid_openai_ads_paused_daily_contract(launch.request_payload)
        and launch.request_payload->>'remoteAccountId' = p_account->>'id'
        and launch.request_payload->>'currency' = p_account->>'currency_code'
        and launch.request_payload->>'accountTimezone' = p_account->>'timezone'
        and lower(coalesce(p_account->>'account_status', '')) = 'active'
        and lower(coalesce(p_account->>'review_status', '')) = 'approved'
        and (
          not (p_account ? 'account_integrity_review_observed')
          or p_account->>'account_integrity_review_observed' = 'false'
          or (
            p_account->>'account_integrity_review_observed' = 'true'
            and lower(coalesce(p_account->>'account_integrity_review_status', '')) = 'approved'
          )
        )
        and nullif(launch.remote_campaign_id, '') is not null
        and nullif(launch.remote_ad_group_id, '') is not null
        and nullif(launch.remote_ad_id, '') is not null
        and exists (
          select 1
          from jsonb_array_elements(p_campaigns) campaign_item
          where campaign_item->>'id' = launch.remote_campaign_id
            and campaign_item->>'name' = launch.request_payload->>'campaignName'
            and campaign_item->'provider_data'->'description'
              = launch.request_payload->'campaignDescription'
            and lower(coalesce(campaign_item->>'status', '')) = case
              when launch.status = 'active' then 'active' else 'paused'
            end
            and campaign_item->>'bidding_type'
              = launch.request_payload->>'biddingType'
            and campaign_item->>'daily_budget_amount_micros'
              = launch.request_payload->>'dailyBudgetMicros'
            and coalesce(
              campaign_item->'provider_data'->'budget'
                ->'lifetime_spend_limit_micros_present',
              'false'::jsonb
            ) = 'false'::jsonb
            and coalesce(
              campaign_item->'provider_data'->'budget'
                ->'lifetime_spend_limit_micros',
              'null'::jsonb
            ) = 'null'::jsonb
            and campaign_item->'start_time' = launch.request_payload->'startTime'
            and campaign_item->'end_time' = launch.request_payload->'endTime'
            and public.openai_ads_targeting_matches_locations(
              campaign_item->'provider_data'->'targeting',
              launch.request_payload->'locationIds'
            )
            and campaign_item->'provider_data'->'product_feed_id' = 'null'::jsonb
            and public.is_neutral_openai_ads_landing_configuration(
              campaign_item->'provider_data'->'landing_page_configuration'
            )
            and campaign_item->'provider_data'->>'serving_issues_observed' = 'true'
            and public.openai_ads_serving_issues_allowed(
              campaign_item->'provider_data'->'serving_issues',
              'campaign',
              case when launch.status = 'active' then 'active' else 'paused' end,
              coalesce((
                select candidate->>'review_status'
                from jsonb_array_elements(p_ads) candidate
                where candidate->>'id' = launch.remote_ad_id
                  and candidate->>'ad_group_id' = launch.remote_ad_group_id
                limit 1
              ), '')
            )
        )
        and exists (
          select 1
          from jsonb_array_elements(p_ad_groups) ad_group_item
          where ad_group_item->>'id' = launch.remote_ad_group_id
            and ad_group_item->>'campaign_id' = launch.remote_campaign_id
            and ad_group_item->>'name' = launch.request_payload->>'adGroupName'
            and ad_group_item->'provider_data'->'description'
              = launch.request_payload->'campaignDescription'
            and lower(coalesce(ad_group_item->>'status', '')) = case
              when launch.status = 'active' then 'active' else 'paused'
            end
            and ad_group_item->>'billing_event_type'
              = launch.request_payload->>'billingEventType'
            and ad_group_item->>'bid_strategy' = 'fixed_bid'
            and ad_group_item->>'max_bid_micros'
              = launch.request_payload->>'maxBidMicros'
            and coalesce(
              ad_group_item->'provider_data'->'bidding_config'
                ->'custom_audience_bid_multipliers',
              '[]'::jsonb
            ) = '[]'::jsonb
            and public.openai_ads_jsonb_text_sets_equal(
              ad_group_item->'provider_data'->'context_hints',
              launch.request_payload->'contextHints'
            )
            and ad_group_item->'provider_data'->'product_set' = 'null'::jsonb
            and public.is_neutral_openai_ads_landing_configuration(
              ad_group_item->'provider_data'->'landing_page_configuration'
            )
            and ad_group_item->'provider_data'->>'serving_issues_observed' = 'true'
            and public.openai_ads_serving_issues_allowed(
              ad_group_item->'provider_data'->'serving_issues',
              'ad_group',
              case when launch.status = 'active' then 'active' else 'paused' end,
              coalesce((
                select candidate->>'review_status'
                from jsonb_array_elements(p_ads) candidate
                where candidate->>'id' = launch.remote_ad_id
                  and candidate->>'ad_group_id' = launch.remote_ad_group_id
                limit 1
              ), '')
            )
        )
        and exists (
          select 1
          from jsonb_array_elements(p_ads) ad_item
          where ad_item->>'id' = launch.remote_ad_id
            and ad_item->>'ad_group_id' = launch.remote_ad_group_id
            and ad_item->>'name' = launch.request_payload->>'adName'
            and lower(coalesce(ad_item->>'status', '')) = case
              when launch.status = 'active' then 'active' else 'paused'
            end
            and (
              launch.status <> 'active'
              or lower(coalesce(ad_item->>'review_status', '')) = 'approved'
            )
            and ad_item->'provider_data'->'creative'->>'type' = 'chat_card'
            and ad_item->'provider_data'->'creative'->>'title'
              = launch.request_payload->>'title'
            and ad_item->'provider_data'->'creative'->>'body'
              = launch.request_payload->>'body'
            and ad_item->'provider_data'->'creative'->>'target_url'
              = launch.request_payload->>'targetUrl'
            and ad_item->'provider_data'->'creative'->>'file_id'
              = launch.remote_file_id
            and coalesce(
              ad_item->'provider_data'->'creative'->'price',
              'null'::jsonb
            ) = 'null'::jsonb
            and coalesce(
              ad_item->'provider_data'->'creative'->'image_crop',
              'null'::jsonb
            ) = 'null'::jsonb
            and public.is_neutral_openai_ads_landing_configuration(
              ad_item->'provider_data'->'landing_page_configuration'
            )
            and ad_item->'provider_data'->>'serving_issues_observed' = 'true'
            and public.openai_ads_serving_issues_allowed(
              ad_item->'provider_data'->'serving_issues',
              'ad',
              case when launch.status = 'active' then 'active' else 'paused' end,
              ad_item->>'review_status'
            )
        )
      ), false) as verified_contract_chain
    from public.ad_platform_launches launch
    where launch.user_id = p_user_id
      and launch.platform_account_id = p_platform_account_id
      and launch.platform = 'openai_ads'
      and launch.status in (
        'paused', 'in_review', 'ready_to_activate', 'blocked', 'failed',
        'active', 'activation_uncertain'
      )
  ), reconciled as (
    update public.ad_platform_launches launch
    set
      review_status = coalesce(chain.provider_review_status, launch.review_status),
      status = case
        when not chain.verified_contract_chain then 'activation_uncertain'
        when chain.previous_status = 'activation_uncertain'
          then 'activation_uncertain'
        when chain.previous_status = 'active' then 'active'
        when chain.previous_status = 'failed' then 'failed'
        when chain.provider_review_status = 'rejected' then 'blocked'
        when chain.provider_review_status = 'approved' then 'ready_to_activate'
        else 'in_review'
      end,
      error_code = case
        when not chain.verified_contract_chain
          then 'snapshot_launch_contract_not_verified'
        when chain.previous_status = 'activation_uncertain'
          then chain.previous_error_code
        when chain.previous_status = 'active' then chain.previous_error_code
        when chain.previous_status = 'failed' then chain.previous_error_code
        when chain.provider_review_status = 'rejected'
          then 'ad_review_rejected'
        when chain.provider_review_status = 'approved' then null
        else launch.error_code
      end,
      -- Snapshot reconciliation never infers or manufactures activation time.
      activated_at = launch.activated_at,
      updated_at = now_at
    from launch_chain chain
    where launch.id = chain.id
      and launch.status = chain.previous_status
      and launch.operation_token is not distinct from chain.previous_operation_token
    returning launch.status, launch.error_code
  )
  select count(*)
    into unsafe_launch_count
  from reconciled
  where status = 'activation_uncertain'
    and error_code = 'snapshot_launch_contract_not_verified';

  insert into public.performance_data (
    entity_id,
    entity_type,
    date,
    date_stop,
    impressions,
    clicks,
    conversions,
    spend,
    platform,
    user_id,
    platform_account_id,
    campaign_id,
    currency,
    data_status,
    provider_data,
    last_seen_sync_id,
    updated_at
  )
  select
    campaign.id,
    'campaign',
    (item->>'date')::date,
    coalesce(nullif(item->>'date_stop', '')::date, (item->>'date')::date),
    (item->>'impressions')::bigint,
    (item->>'clicks')::bigint,
    nullif(item->>'conversions', '')::bigint,
    (item->>'spend')::numeric,
    'openai_ads',
    p_user_id,
    p_platform_account_id,
    campaign.id,
    p_account->>'currency_code',
    item->>'data_status',
    coalesce(item->'provider_data', '{}'::jsonb),
    p_sync_run_id,
    now_at
  from jsonb_array_elements(p_insights) item
  join public.campaigns campaign
    on campaign.platform_account_id = p_platform_account_id
   and campaign.platform_campaign_id = item->>'campaign_id'
  where nullif(item->>'date', '') is not null
  on conflict (entity_id, date)
  do update set
    date_stop = excluded.date_stop,
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    conversions = excluded.conversions,
    spend = excluded.spend,
    currency = excluded.currency,
    data_status = excluded.data_status,
    provider_data = excluded.provider_data,
    last_seen_sync_id = excluded.last_seen_sync_id,
    updated_at = excluded.updated_at;

  select count(*) into campaign_count from jsonb_array_elements(p_campaigns);
  select count(*) into ad_group_count from jsonb_array_elements(p_ad_groups);
  select count(*) into ad_count from jsonb_array_elements(p_ads);
  select count(*) into insight_count from jsonb_array_elements(p_insights);

  update public.platform_accounts
  set
    account_id = p_account->>'id',
    account_name = p_account->>'name',
    provider_metadata = p_account,
    provider_sync_status = 'success',
    provider_sync_error_code = null,
    provider_last_success_at = now_at,
    provider_next_sync_at = now_at + interval '1 hour',
    provider_backoff_until = null,
    provider_consecutive_failures = 0,
    provider_sync_claim_token = null,
    provider_sync_claimed_at = null,
    provider_campaign_count = campaign_count,
    provider_ad_group_count = ad_group_count,
    provider_ad_count = ad_count,
    provider_insight_count = insight_count,
    updated_at = now_at
  where id = p_platform_account_id
    and user_id = p_user_id;

  update public.ad_platform_sync_runs
  set
    status = 'success',
    completed_at = now_at,
    counts = jsonb_build_object(
      'campaigns', campaign_count,
      'ad_groups', ad_group_count,
      'ads', ad_count,
      'insights', insight_count
    ),
    error_code = null
  where id = p_sync_run_id
    and user_id = p_user_id
    and platform_account_id = p_platform_account_id
    and status = 'running';

  return jsonb_build_object(
    'campaigns', campaign_count,
    'ad_groups', ad_group_count,
    'ads', ad_count,
    'insights', insight_count,
    'unsafe_launches', unsafe_launch_count
  );
end;
$$;


revoke all on function public.replace_openai_ads_snapshot(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_openai_ads_snapshot(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;

commit;

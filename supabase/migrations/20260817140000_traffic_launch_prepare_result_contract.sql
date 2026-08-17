-- ROOT CAUSE (Traffic "Kampagne vorbereiten"):
-- materialize_meta_launch_chain_plan returns CREATED/EXISTING without
-- brand_asset_ids / prepared_at. customer-control-service parseCustomerLaunchResult
-- requires both → opaque
--   "Die Aktiv-Launch-Vorbereitung konnte nicht sicher gespeichert werden…"
-- Also: audit gate checked outcome='QUEUED' but chain returns 'CREATED'.
--
-- App layer also enriches (launch-prepare-result.ts) so deploy works before SQL.

begin;

create or replace function public.enrich_meta_customer_launch_prepare_result(
  p_result jsonb,
  p_brand_asset_id uuid,
  p_budget_type text,
  p_prepared_at timestamptz default now()
)
returns jsonb
language sql
immutable
as $$
  select case
    when p_result is null or jsonb_typeof(p_result) is distinct from 'object'
      then p_result
    else p_result
      || jsonb_build_object(
        'brand_asset_ids',
        case
          when jsonb_typeof(p_result->'brand_asset_ids') = 'array'
            and jsonb_array_length(p_result->'brand_asset_ids') > 0
            then p_result->'brand_asset_ids'
          else jsonb_build_array(p_brand_asset_id)
        end,
        'prepared_at',
        coalesce(
          nullif(p_result->>'prepared_at', ''),
          p_prepared_at
        ),
        'budget_type',
        coalesce(
          nullif(p_result->>'budget_type', ''),
          p_budget_type
        )
      )
  end;
$$;

comment on function public.enrich_meta_customer_launch_prepare_result(
  jsonb, uuid, text, timestamptz
) is
  'Fill brand_asset_ids / prepared_at / budget_type for customer launch prepare RPC answers.';

revoke all on function public.enrich_meta_customer_launch_prepare_result(
  jsonb, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.enrich_meta_customer_launch_prepare_result(
  jsonb, uuid, text, timestamptz
) to service_role;

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
  v_timezone text;
  v_account_day date;
  v_snapshot_id uuid;
  v_result jsonb;
  v_plan_id uuid;
  v_planned_at timestamptz := coalesce(p_planned_at, now());
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_read_lease_token is null
    or p_blueprint_id is null
    or p_brand_profile_id is null
    or p_brand_asset_id is null
    or p_allowed_domain_id is null
    or v_planned_at is null
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
  for update;

  if not found then
    raise exception 'Customer launch Meta account was not found';
  end if;

  v_timezone := public.normalize_meta_account_timezone_name(
    v_account.marketing_timezone_name
  );
  if v_account.marketing_timezone_name is distinct from v_timezone then
    update public.platform_accounts account
    set
      marketing_timezone_name = v_timezone,
      updated_at = now()
    where account.id = v_account.id;
    v_account.marketing_timezone_name := v_timezone;
  end if;

  if v_account.marketing_currency is distinct from 'EUR' then
    raise exception 'Customer launch requires EUR marketing currency';
  end if;

  if v_account.marketing_sync_status is distinct from 'success'
    or v_account.marketing_sync_id is null then
    raise exception 'Customer launch requires current successful Meta marketing sync';
  end if;

  if v_account.marketing_last_success_at is null
    or v_account.marketing_last_success_at < v_planned_at - interval '2 hours' then
    raise exception 'Customer launch requires fresh Meta marketing sync within 2 hours';
  end if;

  if not ('ads_management' = any(v_account.meta_scopes)) then
    raise exception 'Customer launch requires ads_management scope';
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

  begin
    v_account_day := (v_planned_at at time zone v_timezone)::date;
  exception when others then
    v_timezone := 'Europe/Berlin';
    update public.platform_accounts account
    set
      marketing_timezone_name = v_timezone,
      updated_at = now()
    where account.id = v_account.id;
    v_account.marketing_timezone_name := v_timezone;
    v_account_day := (v_planned_at at time zone v_timezone)::date;
  end;

  select snapshot.*
  into v_snapshot
  from public.daily_budget_exposure_snapshots snapshot
  where snapshot.user_id = p_user_id
    and snapshot.platform_account_id = p_platform_account_id
    and snapshot.policy_id = v_policy.id
    and snapshot.source_marketing_sync_id = v_account.marketing_sync_id
    and snapshot.account_day = v_account_day
    and snapshot.status = 'COMPLETE'
    and snapshot.currency = 'EUR'
  order by snapshot.completed_at desc nulls last, snapshot.created_at desc
  limit 1
  for update;

  if not found then
    begin
      v_snapshot_id := public.ensure_meta_customer_launch_exposure_snapshot(
        p_platform_account_id,
        p_user_id,
        v_policy.id,
        v_account.marketing_sync_id,
        p_read_lease_token,
        v_planned_at
      );
    exception when undefined_function then
      v_snapshot_id := null;
    when others then
      raise exception 'Current complete customer exposure snapshot is required (%).',
        sqlerrm;
    end;

    if v_snapshot_id is not null then
      select snapshot.*
      into v_snapshot
      from public.daily_budget_exposure_snapshots snapshot
      where snapshot.id = v_snapshot_id
        and snapshot.status = 'COMPLETE'
      for update;
    end if;
  end if;

  if v_snapshot.id is null or v_snapshot.status is distinct from 'COMPLETE' then
    raise exception 'Current complete customer exposure snapshot is required';
  end if;

  v_result := public.materialize_meta_launch_chain_plan(
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
    p_daily_budget_minor,
    coalesce(p_launch_inputs, '{}'::jsonb),
    v_planned_at
  );

  -- Chain returns CREATED (new) or EXISTING (replay) — never QUEUED.
  if v_result->>'outcome' = 'CREATED' then
    v_plan_id := (v_result->>'plan_id')::uuid;
    perform public.append_meta_mutation_audit_event(
      p_user_id, p_platform_account_id, v_policy.id, v_plan_id,
      null, null, 'CUSTOMER', p_user_id::text, 'CUSTOMER_LAUNCH_PREPARED',
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
      null, null, null, null, null, v_planned_at
    );
  end if;

  return public.enrich_meta_customer_launch_prepare_result(
    v_result,
    p_brand_asset_id,
    'DAILY',
    v_planned_at
  );
end;
$$;

comment on function public.materialize_meta_customer_launch_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, jsonb, timestamptz
) is
  'Customer daily launch prepare; returns brand_asset_ids + prepared_at for HELD UI.';

commit;

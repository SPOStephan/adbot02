-- Deterministic Meta budget planner v1.
--
-- This migration only creates immutable mutation intent. It never contacts Meta.
-- A successful readonly marketing snapshot, the still-live READ_SYNC account
-- lease and one customer-confirmed active EUR policy are required. PostgreSQL is
-- authoritative for exposure, hard caps, rolling movement, cooldown and
-- idempotency. The executor must repeat every safety check before remote writes.

alter table public.platform_accounts
  add column if not exists automation_planner_status text not null default 'idle',
  add column if not exists automation_planner_error_code text,
  add column if not exists automation_planner_last_run_at timestamptz,
  add column if not exists automation_planner_last_success_at timestamptz,
  add column if not exists automation_planner_last_marketing_sync_id uuid;

alter table public.platform_accounts
  add constraint platform_accounts_automation_planner_status_check
    check (automation_planner_status in ('idle', 'success', 'error', 'not_run'));

alter table public.campaigns
  add column if not exists is_adset_budget_sharing_enabled boolean,
  add column if not exists budget_sharing_snapshot_sync_id uuid;

create index if not exists campaigns_planner_snapshot_idx
  on public.campaigns (
    platform_account_id,
    last_seen_sync_id,
    is_current,
    platform_campaign_id
  );

create index if not exists ad_groups_planner_snapshot_idx
  on public.ad_groups (
    platform_account_id,
    last_seen_sync_id,
    is_current,
    campaign_id,
    platform_ad_group_id
  );

create index if not exists ads_planner_snapshot_idx
  on public.ads (
    platform_account_id,
    last_seen_sync_id,
    is_current,
    ad_group_id,
    platform_ad_id
  );

create index if not exists budget_mutation_ledger_owner_window_idx
  on public.budget_mutation_ledger (
    platform_account_id,
    budget_owner_key,
    executed_at desc
  );

create or replace function public.record_meta_campaign_budget_sharing_snapshot(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_campaigns jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected integer;
  v_received integer;
  v_updated integer;
begin
  if jsonb_typeof(p_campaigns) <> 'array'
    or pg_catalog.pg_column_size(p_campaigns) > 4194304 then
    raise exception 'Invalid campaign budget-sharing snapshot';
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
    raise exception 'Active matching READ_SYNC lease is required';
  end if;

  select pa.marketing_campaign_count
    into v_expected
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
    and pa.marketing_sync_status = 'success'
    and pa.marketing_sync_id = p_source_marketing_sync_id
  for update;

  if not found then
    raise exception 'Current successful Meta snapshot is required';
  end if;

  select count(*)::integer
    into v_received
  from jsonb_to_recordset(p_campaigns) as item(
    platform_campaign_id text,
    is_adset_budget_sharing_enabled boolean
  );

  if v_received <> v_expected
    or exists (
      select 1
      from jsonb_to_recordset(p_campaigns) as item(
        platform_campaign_id text,
        is_adset_budget_sharing_enabled boolean
      )
      group by item.platform_campaign_id
      having item.platform_campaign_id !~ '^[0-9]{1,32}$'
        or count(*) <> 1
    )
    or exists (
      select 1
      from jsonb_to_recordset(p_campaigns) as item(
        platform_campaign_id text,
        is_adset_budget_sharing_enabled boolean
      )
      left join public.campaigns c
        on c.platform_account_id = p_platform_account_id
       and c.user_id = p_user_id
       and c.platform_campaign_id = item.platform_campaign_id
       and c.last_seen_sync_id = p_source_marketing_sync_id
       and c.is_current
      where c.id is null
    ) then
    raise exception 'Campaign budget-sharing snapshot is incomplete or invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_campaigns) as item(
      platform_campaign_id text,
      is_adset_budget_sharing_enabled boolean
    )
    join public.campaigns c
      on c.platform_account_id = p_platform_account_id
     and c.user_id = p_user_id
     and c.platform_campaign_id = item.platform_campaign_id
     and c.last_seen_sync_id = p_source_marketing_sync_id
     and c.is_current
    where c.budget_sharing_snapshot_sync_id = p_source_marketing_sync_id
      and c.is_adset_budget_sharing_enabled
        is distinct from item.is_adset_budget_sharing_enabled
  ) then
    raise exception 'Campaign budget-sharing snapshot replay drifted';
  end if;

  update public.campaigns c
  set
    is_adset_budget_sharing_enabled = item.is_adset_budget_sharing_enabled,
    budget_sharing_snapshot_sync_id = p_source_marketing_sync_id,
    updated_at = now()
  from jsonb_to_recordset(p_campaigns) as item(
    platform_campaign_id text,
    is_adset_budget_sharing_enabled boolean
  )
  where c.platform_account_id = p_platform_account_id
    and c.user_id = p_user_id
    and c.platform_campaign_id = item.platform_campaign_id
    and c.last_seen_sync_id = p_source_marketing_sync_id
    and c.is_current;

  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception 'Campaign budget-sharing snapshot update was incomplete';
  end if;

  return v_updated;
end;
$$;

create or replace function public.refresh_meta_budget_planner_snapshot_internal(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_observed_at timestamptz
)
returns table (
  planner_status text,
  snapshot_id uuid,
  account_day date,
  observed_budget_owner_count integer,
  reserved_exposure_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_account_day date;
  v_snapshot_was_complete boolean := false;
  v_current_owner_count integer;
begin
  if p_observed_at < now() - interval '5 minutes'
    or p_observed_at > now() + interval '1 minute' then
    return query select
      'INVALID_PLANNER_TIME'::text, null::uuid, null::date, 0, 0::bigint;
    return;
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
    return query select
      'READ_LEASE_REQUIRED'::text, null::uuid, null::date, 0, 0::bigint;
    return;
  end if;

  select pa.*
    into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
  for update;

  if not found then
    return query select
      'ACCOUNT_UNAVAILABLE'::text, null::uuid, null::date, 0, 0::bigint;
    return;
  end if;

  select ap.*
    into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found then
    return query select
      'NO_ACTIVE_POLICY'::text, null::uuid, null::date, 0, 0::bigint;
    return;
  end if;

  if v_account.marketing_sync_status <> 'success'
    or v_account.marketing_sync_id is distinct from p_source_marketing_sync_id
    or v_account.marketing_last_success_at is null
    or v_account.marketing_last_success_at < p_observed_at - interval '2 hours'
    or v_account.marketing_currency is distinct from 'EUR'
    or v_policy.currency <> 'EUR'
    or v_account.marketing_timezone_name is null
    or exists (
      select 1
      from public.campaigns c
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and c.last_seen_sync_id = p_source_marketing_sync_id
        and c.budget_sharing_snapshot_sync_id
          is distinct from p_source_marketing_sync_id
    )
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names tz
      where tz.name = v_account.marketing_timezone_name
    ) then
    return query select
      'STALE_OR_INVALID_SNAPSHOT'::text, null::uuid, null::date, 0, 0::bigint;
    return;
  end if;

  v_account_day := (p_observed_at at time zone v_account.marketing_timezone_name)::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':planner:' || v_account_day::text,
      0
    )
  );

  -- Campaign targets always exist for safety pauses. They own a budget only
  -- when Meta reports a positive campaign daily budget.
  insert into public.automation_targets (
    user_id,
    platform_account_id,
    target_type,
    target_key,
    platform_object_id,
    campaign_scope_key,
    budget_owner_type,
    budget_owner_key,
    campaign_id,
    ad_group_id,
    ad_id,
    status,
    last_reconciled_at,
    updated_at
  )
  select
    c.user_id,
    c.platform_account_id,
    'CAMPAIGN',
    'campaign:' || c.platform_campaign_id,
    c.platform_campaign_id,
    'campaign:' || c.platform_campaign_id,
    case when coalesce(c.daily_budget_minor, 0) > 0 then 'CAMPAIGN' else null end,
    case when coalesce(c.daily_budget_minor, 0) > 0
      then 'campaign:' || c.platform_campaign_id else null end,
    c.id,
    null,
    null,
    'MANAGED',
    c.last_seen_at,
    now()
  from public.campaigns c
  where c.platform_account_id = p_platform_account_id
    and c.user_id = p_user_id
    and c.last_seen_sync_id = p_source_marketing_sync_id
    and c.is_current
  on conflict (platform_account_id, target_type, platform_object_id)
  do update set
    target_key = excluded.target_key,
    campaign_scope_key = excluded.campaign_scope_key,
    budget_owner_type = excluded.budget_owner_type,
    budget_owner_key = excluded.budget_owner_key,
    campaign_id = excluded.campaign_id,
    ad_group_id = null,
    ad_id = null,
    status = case
      when public.automation_targets.status = 'RETIRED' then 'MANAGED'
      else public.automation_targets.status
    end,
    last_reconciled_at = excluded.last_reconciled_at,
    updated_at = now();

  -- Ad-set budgets are authoritative only for campaigns without a positive
  -- campaign daily budget. The target still exists when it does not own budget.
  insert into public.automation_targets (
    user_id,
    platform_account_id,
    target_type,
    target_key,
    platform_object_id,
    campaign_scope_key,
    budget_owner_type,
    budget_owner_key,
    campaign_id,
    ad_group_id,
    ad_id,
    status,
    last_reconciled_at,
    updated_at
  )
  select
    ag.user_id,
    ag.platform_account_id,
    'AD_SET',
    'adset:' || ag.platform_ad_group_id,
    ag.platform_ad_group_id,
    'campaign:' || c.platform_campaign_id,
    case
      when coalesce(c.daily_budget_minor, 0) = 0
        and coalesce(ag.daily_budget_minor, 0) > 0 then 'AD_SET'
      else null
    end,
    case
      when coalesce(c.daily_budget_minor, 0) = 0
        and coalesce(ag.daily_budget_minor, 0) > 0
        then 'adset:' || ag.platform_ad_group_id
      else null
    end,
    c.id,
    ag.id,
    null,
    'MANAGED',
    ag.last_seen_at,
    now()
  from public.ad_groups ag
  join public.campaigns c on c.id = ag.campaign_id
  where ag.platform_account_id = p_platform_account_id
    and ag.user_id = p_user_id
    and ag.last_seen_sync_id = p_source_marketing_sync_id
    and ag.is_current
    and c.last_seen_sync_id = p_source_marketing_sync_id
    and c.is_current
  on conflict (platform_account_id, target_type, platform_object_id)
  do update set
    target_key = excluded.target_key,
    campaign_scope_key = excluded.campaign_scope_key,
    budget_owner_type = excluded.budget_owner_type,
    budget_owner_key = excluded.budget_owner_key,
    campaign_id = excluded.campaign_id,
    ad_group_id = excluded.ad_group_id,
    ad_id = null,
    status = case
      when public.automation_targets.status = 'RETIRED' then 'MANAGED'
      else public.automation_targets.status
    end,
    last_reconciled_at = excluded.last_reconciled_at,
    updated_at = now();

  insert into public.automation_targets (
    user_id,
    platform_account_id,
    target_type,
    target_key,
    platform_object_id,
    campaign_scope_key,
    budget_owner_type,
    budget_owner_key,
    campaign_id,
    ad_group_id,
    ad_id,
    status,
    last_reconciled_at,
    updated_at
  )
  select
    a.user_id,
    a.platform_account_id,
    'AD',
    'ad:' || a.platform_ad_id,
    a.platform_ad_id,
    'campaign:' || c.platform_campaign_id,
    null,
    null,
    c.id,
    ag.id,
    a.id,
    'MANAGED',
    a.last_seen_at,
    now()
  from public.ads a
  join public.ad_groups ag on ag.id = a.ad_group_id
  join public.campaigns c on c.id = ag.campaign_id
  where a.platform_account_id = p_platform_account_id
    and a.user_id = p_user_id
    and a.last_seen_sync_id = p_source_marketing_sync_id
    and a.is_current
    and ag.last_seen_sync_id = p_source_marketing_sync_id
    and ag.is_current
    and c.last_seen_sync_id = p_source_marketing_sync_id
    and c.is_current
  on conflict (platform_account_id, target_type, platform_object_id)
  do update set
    target_key = excluded.target_key,
    campaign_scope_key = excluded.campaign_scope_key,
    budget_owner_type = null,
    budget_owner_key = null,
    campaign_id = excluded.campaign_id,
    ad_group_id = excluded.ad_group_id,
    ad_id = excluded.ad_id,
    status = case
      when public.automation_targets.status = 'RETIRED' then 'MANAGED'
      else public.automation_targets.status
    end,
    last_reconciled_at = excluded.last_reconciled_at,
    updated_at = now();

  update public.automation_targets target
  set
    status = 'RETIRED',
    last_reconciled_at = p_observed_at,
    updated_at = now()
  where target.platform_account_id = p_platform_account_id
    and target.user_id = p_user_id
    and target.status <> 'RETIRED'
    and (
      (target.target_type = 'CAMPAIGN' and not exists (
        select 1
        from public.campaigns c
        where c.id = target.campaign_id
          and c.is_current
          and c.last_seen_sync_id = p_source_marketing_sync_id
      ))
      or (target.target_type = 'AD_SET' and not exists (
        select 1
        from public.ad_groups ag
        where ag.id = target.ad_group_id
          and ag.is_current
          and ag.last_seen_sync_id = p_source_marketing_sync_id
      ))
      or (target.target_type = 'AD' and not exists (
        select 1
        from public.ads a
        where a.id = target.ad_id
          and a.is_current
          and a.last_seen_sync_id = p_source_marketing_sync_id
      ))
    );

  insert into public.daily_budget_exposure_snapshots (
    user_id,
    platform_account_id,
    policy_id,
    account_day,
    account_timezone_name,
    source_marketing_sync_id,
    currency,
    status
  ) values (
    p_user_id,
    p_platform_account_id,
    v_policy.id,
    v_account_day,
    v_account.marketing_timezone_name,
    p_source_marketing_sync_id,
    'EUR',
    'BUILDING'
  )
  on conflict on constraint daily_exposure_snapshots_account_day_sync_key
  do nothing;

  select s.*
    into v_snapshot
  from public.daily_budget_exposure_snapshots s
  where s.platform_account_id = p_platform_account_id
    and s.account_day = v_account_day
    and s.source_marketing_sync_id = p_source_marketing_sync_id
  for update;

  if v_snapshot.policy_id <> v_policy.id
    or v_snapshot.user_id <> p_user_id
    or v_snapshot.currency <> 'EUR'
    or v_snapshot.account_timezone_name <> v_account.marketing_timezone_name then
    raise exception 'Existing planner snapshot identity does not match active policy';
  end if;

  v_snapshot_was_complete := v_snapshot.status = 'COMPLETE';

  insert into public.daily_budget_exposures (
    user_id,
    platform_account_id,
    policy_id,
    snapshot_id,
    automation_target_id,
    account_day,
    campaign_scope_key,
    budget_owner_key,
    budget_owner_type,
    shared_budget_enabled,
    currency,
    max_daily_budget_minor,
    flex_spend_multiplier_bps,
    source,
    last_observed_at,
    updated_at
  )
  select
    c.user_id,
    c.platform_account_id,
    v_policy.id,
    v_snapshot.id,
    target.id,
    v_account_day,
    target.campaign_scope_key,
    target.budget_owner_key,
    'CAMPAIGN',
    coalesce(c.is_adset_budget_sharing_enabled, true),
    'EUR',
    c.daily_budget_minor,
    case
      when coalesce(c.is_adset_budget_sharing_enabled, true)
        then v_policy.shared_budget_flex_spend_multiplier_bps
      else v_policy.standard_flex_spend_multiplier_bps
    end,
    'SNAPSHOT',
    p_observed_at,
    now()
  from public.campaigns c
  join public.automation_targets target
    on target.platform_account_id = c.platform_account_id
   and target.target_type = 'CAMPAIGN'
   and target.platform_object_id = c.platform_campaign_id
   and target.budget_owner_type = 'CAMPAIGN'
  where c.platform_account_id = p_platform_account_id
    and c.user_id = p_user_id
    and c.last_seen_sync_id = p_source_marketing_sync_id
    and c.is_current
    and coalesce(c.daily_budget_minor, 0) > 0
  on conflict on constraint daily_budget_exposures_account_day_owner_key
  do update set
    automation_target_id = excluded.automation_target_id,
    shared_budget_enabled = (
      public.daily_budget_exposures.shared_budget_enabled
      or excluded.shared_budget_enabled
    ),
    max_daily_budget_minor = greatest(
      public.daily_budget_exposures.max_daily_budget_minor,
      excluded.max_daily_budget_minor
    ),
    flex_spend_multiplier_bps = greatest(
      public.daily_budget_exposures.flex_spend_multiplier_bps,
      excluded.flex_spend_multiplier_bps
    ),
    source = case
      when public.daily_budget_exposures.source = 'RECONCILIATION'
        then 'RECONCILIATION'
      when public.daily_budget_exposures.source = 'PLAN' then 'PLAN'
      else 'SNAPSHOT'
    end,
    last_observed_at = greatest(
      public.daily_budget_exposures.last_observed_at,
      excluded.last_observed_at
    ),
    updated_at = now();

  insert into public.daily_budget_exposures (
    user_id,
    platform_account_id,
    policy_id,
    snapshot_id,
    automation_target_id,
    account_day,
    campaign_scope_key,
    budget_owner_key,
    budget_owner_type,
    shared_budget_enabled,
    currency,
    max_daily_budget_minor,
    flex_spend_multiplier_bps,
    source,
    last_observed_at,
    updated_at
  )
  select
    ag.user_id,
    ag.platform_account_id,
    v_policy.id,
    v_snapshot.id,
    target.id,
    v_account_day,
    target.campaign_scope_key,
    target.budget_owner_key,
    'AD_SET',
    false,
    'EUR',
    ag.daily_budget_minor,
    v_policy.standard_flex_spend_multiplier_bps,
    'SNAPSHOT',
    p_observed_at,
    now()
  from public.ad_groups ag
  join public.campaigns c on c.id = ag.campaign_id
  join public.automation_targets target
    on target.platform_account_id = ag.platform_account_id
   and target.target_type = 'AD_SET'
   and target.platform_object_id = ag.platform_ad_group_id
   and target.budget_owner_type = 'AD_SET'
  where ag.platform_account_id = p_platform_account_id
    and ag.user_id = p_user_id
    and ag.last_seen_sync_id = p_source_marketing_sync_id
    and ag.is_current
    and c.last_seen_sync_id = p_source_marketing_sync_id
    and c.is_current
    and coalesce(c.daily_budget_minor, 0) = 0
    and coalesce(ag.daily_budget_minor, 0) > 0
  on conflict on constraint daily_budget_exposures_account_day_owner_key
  do update set
    automation_target_id = excluded.automation_target_id,
    max_daily_budget_minor = greatest(
      public.daily_budget_exposures.max_daily_budget_minor,
      excluded.max_daily_budget_minor
    ),
    flex_spend_multiplier_bps = greatest(
      public.daily_budget_exposures.flex_spend_multiplier_bps,
      excluded.flex_spend_multiplier_bps
    ),
    source = case
      when public.daily_budget_exposures.source = 'RECONCILIATION'
        then 'RECONCILIATION'
      when public.daily_budget_exposures.source = 'PLAN' then 'PLAN'
      else 'SNAPSHOT'
    end,
    last_observed_at = greatest(
      public.daily_budget_exposures.last_observed_at,
      excluded.last_observed_at
    ),
    updated_at = now();

  select count(*)::integer
    into v_current_owner_count
  from public.automation_targets target
  where target.platform_account_id = p_platform_account_id
    and target.user_id = p_user_id
    and target.status = 'MANAGED'
    and target.budget_owner_key is not null;

  update public.daily_budget_exposure_snapshots s
  set
    observed_budget_owner_count = v_current_owner_count,
    reserved_exposure_minor = totals.reserved_exposure_minor,
    status = 'COMPLETE',
    completed_at = coalesce(s.completed_at, p_observed_at),
    updated_at = now()
  from (
    select coalesce(sum(dbe.reserved_exposure_minor), 0)::bigint
      as reserved_exposure_minor
    from public.daily_budget_exposures dbe
    where dbe.platform_account_id = p_platform_account_id
      and dbe.account_day = v_account_day
  ) totals
  where s.id = v_snapshot.id
  returning s.* into v_snapshot;

  if not v_snapshot_was_complete then
    perform public.append_meta_mutation_audit_event(
      p_user_id,
      p_platform_account_id,
      v_policy.id,
      null,
      null,
      null,
      'SYSTEM',
      'meta-budget-planner',
      'BUDGET_EXPOSURE_SNAPSHOT_COMPLETED',
      '{}'::jsonb,
      jsonb_build_object(
        'source_marketing_sync_id', p_source_marketing_sync_id,
        'account_day', v_account_day
      ),
      '{}'::jsonb,
      jsonb_build_object(
        'observed_budget_owner_count', v_snapshot.observed_budget_owner_count,
        'reserved_exposure_minor', v_snapshot.reserved_exposure_minor
      ),
      jsonb_build_object('snapshot_id', v_snapshot.id),
      null, null, null, null, null, p_observed_at
    );
  end if;

  return query select
    'READY'::text,
    v_snapshot.id,
    v_account_day,
    v_snapshot.observed_budget_owner_count,
    v_snapshot.reserved_exposure_minor;
end;
$$;

create or replace function public.queue_meta_budget_plan_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_source_recommendation_id uuid,
  p_source_rule_key text,
  p_source_rule_version integer,
  p_automation_target_id uuid,
  p_direction text,
  p_change_bps integer,
  p_evidence jsonb,
  p_planned_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
  v_recommendation public.campaign_recommendations%rowtype;
  v_campaign_id uuid;
  v_campaign_scope_key text;
  v_current_budget bigint;
  v_remote_status text;
  v_object_sync_id uuid;
  v_intended_budget bigint;
  v_latest_change timestamptz;
  v_baseline_budget bigint;
  v_movement_used bigint;
  v_movement_limit bigint;
  v_candidate_delta bigint;
  v_predicted_exposure bigint;
  v_campaign_total bigint;
  v_account_total bigint;
  v_campaign_cap bigint;
  v_kill_mode text;
  v_payload jsonb;
  v_payload_hash text;
  v_idempotency_key text;
  v_plan_id uuid := gen_random_uuid();
  v_existing_plan_id uuid;
  v_step_validate uuid := gen_random_uuid();
  v_step_mutate uuid := gen_random_uuid();
  v_step_read uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_validate_request jsonb;
  v_mutate_request jsonb;
  v_read_request jsonb;
  v_reconcile_request jsonb;
  v_priority integer;
begin
  if jsonb_typeof(p_evidence) <> 'object'
    or pg_catalog.pg_column_size(p_evidence) > 65536 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_evidence');
  end if;

  if (p_source_rule_key = 'spend_without_results_14d'
      and (p_direction <> 'DECREASE' or p_change_bps <> 2000
        or p_source_recommendation_id is null))
    or (p_source_rule_key = 'cost_per_result_up_30pct'
      and (p_direction <> 'DECREASE' or p_change_bps <> 1000
        or p_source_recommendation_id is null))
    or (p_source_rule_key = 'cost_per_result_down_15pct'
      and (p_direction <> 'INCREASE' or p_change_bps <> 1000
        or p_source_recommendation_id is not null))
    or p_source_rule_key not in (
      'spend_without_results_14d',
      'cost_per_result_up_30pct',
      'cost_per_result_down_15pct'
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'unsupported_rule');
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = p_policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found or not v_policy.allow_budget_changes then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'budget_changes_not_allowed'
    );
  end if;

  select target.* into v_target
  from public.automation_targets target
  where target.id = p_automation_target_id
    and target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type in ('CAMPAIGN', 'AD_SET')
    and target.budget_owner_type = target.target_type
    and target.budget_owner_key = target.target_key
    and target.status = 'MANAGED'
  for update;

  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_target');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':budget-owner:' || v_target.budget_owner_key,
      0
    )
  );

  if v_target.target_type = 'CAMPAIGN' then
    select
      c.id,
      'campaign:' || c.platform_campaign_id,
      c.daily_budget_minor,
      coalesce(c.effective_status, c.status, 'UNKNOWN'),
      c.last_seen_sync_id
    into
      v_campaign_id,
      v_campaign_scope_key,
      v_current_budget,
      v_remote_status,
      v_object_sync_id
    from public.campaigns c
    where c.id = v_target.campaign_id
      and c.user_id = p_user_id
      and c.platform_account_id = p_platform_account_id
      and c.is_current;
  else
    select
      c.id,
      'campaign:' || c.platform_campaign_id,
      ag.daily_budget_minor,
      coalesce(ag.effective_status, ag.status, 'UNKNOWN'),
      ag.last_seen_sync_id
    into
      v_campaign_id,
      v_campaign_scope_key,
      v_current_budget,
      v_remote_status,
      v_object_sync_id
    from public.ad_groups ag
    join public.campaigns c on c.id = ag.campaign_id
    where ag.id = v_target.ad_group_id
      and ag.user_id = p_user_id
      and ag.platform_account_id = p_platform_account_id
      and ag.is_current
      and c.is_current;
  end if;

  if v_current_budget is null
    or v_current_budget <= 0
    or v_object_sync_id is distinct from p_source_marketing_sync_id
    or v_remote_status <> 'ACTIVE' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'stale_or_inactive_target'
    );
  end if;

  if p_source_recommendation_id is not null then
    select r.* into v_recommendation
    from public.campaign_recommendations r
    where r.id = p_source_recommendation_id
      and r.user_id = p_user_id
      and r.platform_account_id = p_platform_account_id
      and r.campaign_id = v_campaign_id
      and r.rule_key = p_source_rule_key
      and r.rule_version = p_source_rule_version
      and r.status = 'active'
      and r.expires_at > p_planned_at
      and r.evidence = p_evidence;

    if not found then
      return jsonb_build_object(
        'outcome', 'BLOCKED', 'reason', 'stale_recommendation'
      );
    end if;
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  if coalesce(v_kill_mode, 'ALLOW') <> 'ALLOW' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'kill_switch');
  end if;

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.platform_account_id = p_platform_account_id
    and mp.budget_owner_key = v_target.budget_owner_key
    and mp.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by mp.created_at desc
  limit 1;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'pending_owner_plan',
      'plan_id', v_existing_plan_id
    );
  end if;

  select
    max(bml.executed_at),
    coalesce(sum(bml.absolute_delta_minor), 0)
  into v_latest_change, v_movement_used
  from public.budget_mutation_ledger bml
  where bml.platform_account_id = p_platform_account_id
    and bml.budget_owner_key = v_target.budget_owner_key
    and bml.executed_at > p_planned_at - interval '24 hours'
    and bml.executed_at <= p_planned_at;

  if v_target.last_successful_mutation_at is not null
    and (
      v_latest_change is null
      or v_target.last_successful_mutation_at > v_latest_change
    ) then
    v_latest_change := v_target.last_successful_mutation_at;
  end if;

  if v_latest_change is not null
    and v_latest_change + make_interval(secs => v_policy.cooldown_seconds)
      > p_planned_at then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'cooldown');
  end if;

  select bml.before_budget_minor
    into v_baseline_budget
  from public.budget_mutation_ledger bml
  where bml.platform_account_id = p_platform_account_id
    and bml.budget_owner_key = v_target.budget_owner_key
    and bml.executed_at > p_planned_at - interval '24 hours'
    and bml.executed_at <= p_planned_at
  order by bml.executed_at asc, bml.created_at asc
  limit 1;

  v_baseline_budget := coalesce(v_baseline_budget, v_current_budget);
  v_movement_limit :=
    (v_baseline_budget * v_policy.budget_change_limit_bps) / 10000;

  if p_direction = 'INCREASE' then
    v_intended_budget :=
      (v_current_budget * (10000 + p_change_bps)) / 10000;
    if v_intended_budget <= v_current_budget then
      v_intended_budget := v_current_budget + 1;
    end if;
  else
    v_intended_budget :=
      (v_current_budget * (10000 - p_change_bps) + 9999) / 10000;
    if v_intended_budget >= v_current_budget then
      v_intended_budget := v_current_budget - 1;
    end if;
  end if;

  if v_intended_budget <= 0 then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'non_positive_budget'
    );
  end if;

  v_candidate_delta := abs(v_intended_budget - v_current_budget);

  if v_movement_limit <= 0
    or v_movement_used + v_candidate_delta > v_movement_limit then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'rolling_24h_limit'
    );
  end if;

  select dbe.* into v_exposure
  from public.daily_budget_exposures dbe
  join public.daily_budget_exposure_snapshots s
    on s.id = p_snapshot_id
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = s.account_day
    and dbe.budget_owner_key = v_target.budget_owner_key
    and s.user_id = p_user_id
    and s.platform_account_id = p_platform_account_id
    and s.policy_id = p_policy_id
    and s.source_marketing_sync_id = p_source_marketing_sync_id
    and s.status = 'COMPLETE';

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'missing_exposure'
    );
  end if;

  if p_direction = 'INCREASE' then
    v_predicted_exposure := greatest(
      v_exposure.reserved_exposure_minor,
      public.meta_calculate_exposure_minor(
        v_intended_budget,
        greatest(
          v_exposure.flex_spend_multiplier_bps,
          case
            when v_exposure.shared_budget_enabled
              then v_policy.shared_budget_flex_spend_multiplier_bps
            else v_policy.standard_flex_spend_multiplier_bps
          end
        )
      )
    );

    select coalesce(sum(dbe.reserved_exposure_minor), 0)
      into v_campaign_total
    from public.daily_budget_exposures dbe
    where dbe.platform_account_id = p_platform_account_id
      and dbe.account_day = v_exposure.account_day
      and dbe.campaign_scope_key = v_campaign_scope_key;

    select coalesce(sum(dbe.reserved_exposure_minor), 0)
      into v_account_total
    from public.daily_budget_exposures dbe
    where dbe.platform_account_id = p_platform_account_id
      and dbe.account_day = v_exposure.account_day;

    select coalesce(
      cbl.daily_hard_cap_minor,
      v_policy.default_campaign_daily_hard_cap_minor
    ) into v_campaign_cap
    from (select 1) seed
    left join public.campaign_budget_limits cbl
      on cbl.policy_id = p_policy_id
     and cbl.user_id = p_user_id
     and cbl.platform_account_id = p_platform_account_id
     and cbl.campaign_scope_key = v_campaign_scope_key;

    if v_campaign_total - v_exposure.reserved_exposure_minor
         + v_predicted_exposure > v_campaign_cap
      or v_account_total - v_exposure.reserved_exposure_minor
         + v_predicted_exposure > v_policy.account_daily_hard_cap_minor then
      return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'hard_cap');
    end if;
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'operation', 'UPDATE_BUDGET',
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'target_key', v_target.target_key,
    'budget_type', 'daily_budget',
    'amount_minor', v_intended_budget,
    'direction', p_direction,
    'change_bps', p_change_bps,
    'rule_key', p_source_rule_key,
    'rule_version', p_source_rule_version,
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'exposure_snapshot_id', p_snapshot_id,
    'evidence', p_evidence
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || p_policy_id::text || '|' || v_policy.policy_hash || '|'
    || p_source_marketing_sync_id::text || '|'
    || coalesce(p_source_recommendation_id::text, '') || '|'
    || p_source_rule_key || '|' || p_source_rule_version::text || '|'
    || v_target.target_type || '|' || v_target.target_key || '|'
    || v_current_budget::text || '|' || v_intended_budget::text || '|'
    || v_payload_hash
  );

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.idempotency_key = v_idempotency_key;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'idempotent_replay',
      'plan_id', v_existing_plan_id
    );
  end if;

  v_priority := case
    when p_source_rule_key = 'spend_without_results_14d' then 80
    when p_source_rule_key = 'cost_per_result_up_30pct' then 75
    else 60
  end;

  insert into public.mutation_plans (
    id,
    user_id,
    platform_account_id,
    policy_id,
    source_marketing_sync_id,
    source_recommendation_id,
    source_rule_key,
    source_rule_version,
    action_type,
    target_type,
    target_key,
    campaign_scope_key,
    budget_owner_key,
    automation_target_id,
    idempotency_key,
    expected_before,
    intended_after,
    planned_payload,
    payload_hash,
    status,
    priority,
    safety_action,
    not_before,
    max_attempts,
    created_at,
    updated_at
  ) values (
    v_plan_id,
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    p_source_marketing_sync_id,
    p_source_recommendation_id,
    p_source_rule_key,
    p_source_rule_version,
    'UPDATE_BUDGET',
    v_target.target_type,
    v_target.target_key,
    v_campaign_scope_key,
    v_target.budget_owner_key,
    v_target.id,
    v_idempotency_key,
    jsonb_build_object(
      'daily_budget_minor', v_current_budget,
      'status', v_remote_status,
      'source_marketing_sync_id', p_source_marketing_sync_id
    ),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    v_payload,
    v_payload_hash,
    'PENDING',
    v_priority,
    false,
    p_planned_at,
    5,
    p_planned_at,
    p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_BUDGET',
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'budget_type', 'daily_budget',
    'amount_minor', v_intended_budget,
    'mode', 'validate_only'
  );
  v_mutate_request :=
    v_validate_request || jsonb_build_object('mode', 'execute');
  v_read_request := jsonb_build_object(
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'fields', jsonb_build_array(
      'id', 'status', 'effective_status', 'daily_budget', 'updated_time'
    )
  );
  v_reconcile_request := jsonb_build_object(
    'expected_daily_budget_minor', v_intended_budget,
    'budget_owner_key', v_target.budget_owner_key,
    'exposure_snapshot_id', p_snapshot_id
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-budget-update', 'VALIDATE', v_target.target_type, null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-budget-update', 'UPDATE', v_target.target_type,
    v_step_validate, v_mutate_request,
    public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    'PAUSE', 'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-budget-update', 'READ', v_target.target_type,
    v_step_mutate, v_read_request,
    public.meta_sha256(v_read_request::text),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-budget-update', 'RECONCILE', v_target.target_type,
    v_step_read, v_reconcile_request,
    public.meta_sha256(v_reconcile_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'),
    'NONE', 'PENDING'
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    v_plan_id,
    null,
    null,
    'SYSTEM',
    'meta-budget-planner',
    'MUTATION_PLAN_QUEUED',
    jsonb_build_object(
      'daily_budget_minor', v_current_budget,
      'status', v_remote_status
    ),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object(
      'daily_budget_minor', v_intended_budget,
      'plan_status', 'PENDING'
    ),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'eligible',
    'plan_id', v_plan_id,
    'before_budget_minor', v_current_budget,
    'after_budget_minor', v_intended_budget
  );
end;
$$;

create or replace function public.queue_meta_hard_cap_pause_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_automation_target_id uuid,
  p_breach_scope text,
  p_evidence jsonb,
  p_planned_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_campaign public.campaigns%rowtype;
  v_kill_mode text;
  v_plan_id uuid := gen_random_uuid();
  v_existing_plan_id uuid;
  v_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_step_validate uuid := gen_random_uuid();
  v_step_mutate uuid := gen_random_uuid();
  v_step_read uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_validate_request jsonb;
  v_mutate_request jsonb;
  v_read_request jsonb;
  v_reconcile_request jsonb;
begin
  if p_breach_scope not in ('ACCOUNT', 'CAMPAIGN')
    or jsonb_typeof(p_evidence) <> 'object'
    or pg_catalog.pg_column_size(p_evidence) > 65536 then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'invalid_safety_evidence'
    );
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = p_policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found or not v_policy.allow_status_changes then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'status_changes_not_allowed'
    );
  end if;

  select target.* into v_target
  from public.automation_targets target
  where target.id = p_automation_target_id
    and target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'CAMPAIGN'
    and target.status = 'MANAGED'
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'invalid_campaign_target'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':status-target:' || v_target.target_key,
      0
    )
  );

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_target.campaign_id
    and c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
    and c.last_seen_sync_id = p_source_marketing_sync_id
  for update;

  if not found
    or coalesce(v_campaign.effective_status, v_campaign.status) <> 'ACTIVE' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'campaign_not_active'
    );
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  if coalesce(v_kill_mode, 'ALLOW') not in ('ALLOW', 'PAUSE_MANAGED') then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'kill_switch_freeze'
    );
  end if;

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.platform_account_id = p_platform_account_id
    and mp.target_type = 'CAMPAIGN'
    and mp.target_key = v_target.target_key
    and mp.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by mp.created_at desc
  limit 1;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'pending_campaign_plan',
      'plan_id', v_existing_plan_id
    );
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'operation', 'UPDATE_STATUS',
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'target_key', v_target.target_key,
    'status', 'PAUSED',
    'safety_reason', 'hard_cap_exposure_breach',
    'breach_scope', p_breach_scope,
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'exposure_snapshot_id', p_snapshot_id,
    'evidence', p_evidence
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || p_policy_id::text || '|' || v_policy.policy_hash || '|'
    || p_source_marketing_sync_id::text || '|hard-cap-pause|'
    || v_target.target_key || '|' || p_breach_scope || '|'
    || v_payload_hash
  );

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.idempotency_key = v_idempotency_key;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'idempotent_replay',
      'plan_id', v_existing_plan_id
    );
  end if;

  insert into public.mutation_plans (
    id,
    user_id,
    platform_account_id,
    policy_id,
    source_marketing_sync_id,
    source_rule_key,
    source_rule_version,
    action_type,
    target_type,
    target_key,
    campaign_scope_key,
    budget_owner_key,
    automation_target_id,
    idempotency_key,
    expected_before,
    intended_after,
    planned_payload,
    payload_hash,
    status,
    priority,
    safety_action,
    not_before,
    max_attempts,
    created_at,
    updated_at
  ) values (
    v_plan_id,
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    p_source_marketing_sync_id,
    'hard_cap_exposure_breach',
    1,
    'SAFETY_PAUSE',
    'CAMPAIGN',
    v_target.target_key,
    v_target.campaign_scope_key,
    v_target.budget_owner_key,
    v_target.id,
    v_idempotency_key,
    jsonb_build_object(
      'status', coalesce(v_campaign.effective_status, v_campaign.status),
      'source_marketing_sync_id', p_source_marketing_sync_id
    ),
    jsonb_build_object('status', 'PAUSED'),
    v_payload,
    v_payload_hash,
    'PENDING',
    100,
    true,
    p_planned_at,
    10,
    p_planned_at,
    p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS',
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'status', 'PAUSED',
    'mode', 'validate_only'
  );
  v_mutate_request :=
    v_validate_request || jsonb_build_object('mode', 'execute');
  v_read_request := jsonb_build_object(
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'fields', jsonb_build_array(
      'id', 'status', 'effective_status', 'updated_time'
    )
  );
  v_reconcile_request := jsonb_build_object(
    'expected_status', 'PAUSED',
    'exposure_snapshot_id', p_snapshot_id,
    'safety_action', true
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-safety-pause', 'VALIDATE', 'CAMPAIGN', null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-safety-pause', 'UPDATE', 'CAMPAIGN', v_step_validate,
    v_mutate_request, public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-safety-pause', 'READ', 'CAMPAIGN', v_step_mutate,
    v_read_request, public.meta_sha256(v_read_request::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-safety-pause', 'RECONCILE', 'CAMPAIGN', v_step_read,
    v_reconcile_request, public.meta_sha256(v_reconcile_request::text),
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
    'meta-budget-planner',
    'HARD_CAP_SAFETY_PAUSE_QUEUED',
    jsonb_build_object(
      'status', coalesce(v_campaign.effective_status, v_campaign.status)
    ),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object('status', 'PAUSED', 'plan_status', 'PENDING'),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'hard_cap_safety',
    'plan_id', v_plan_id
  );
end;
$$;

create or replace function public.run_meta_budget_planner(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_planned_at timestamptz default now()
)
returns table (
  planner_status text,
  snapshot_id uuid,
  account_day date,
  observed_budget_owner_count integer,
  reserved_exposure_minor bigint,
  plans_created integer,
  plans_existing integer,
  candidates_blocked integer,
  hard_cap_breach boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refresh record;
  v_policy public.automation_policies%rowtype;
  v_account public.platform_accounts%rowtype;
  v_candidate record;
  v_cancelled record;
  v_result jsonb;
  v_created integer := 0;
  v_existing integer := 0;
  v_blocked integer := 0;
  v_account_breach boolean := false;
  v_campaign_breach boolean := false;
  v_breach_campaigns text[] := array[]::text[];
  v_current_results numeric;
  v_previous_results numeric;
  v_current_spend numeric;
  v_previous_spend numeric;
  v_kill_mode text;
begin
  select * into v_refresh
  from public.refresh_meta_budget_planner_snapshot_internal(
    p_platform_account_id,
    p_user_id,
    p_source_marketing_sync_id,
    p_read_lease_token,
    p_planned_at
  );

  if v_refresh.planner_status <> 'READY' then
    return query select
      v_refresh.planner_status,
      v_refresh.snapshot_id,
      v_refresh.account_day,
      v_refresh.observed_budget_owner_count,
      v_refresh.reserved_exposure_minor,
      0,
      0,
      0,
      false;
    return;
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE';

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id;

  -- A fresh Meta snapshot invalidates intent that has never been claimed. Plans
  -- with any execution history are deliberately left to Phase-9 reconciliation;
  -- their remote outcome cannot safely be inferred by the planner.
  for v_cancelled in
    update public.mutation_plans mp
    set
      status = 'STALE',
      blocked_reason = 'superseded_by_marketing_snapshot',
      terminal_at = p_planned_at,
      updated_at = p_planned_at
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_marketing_sync_id <> p_source_marketing_sync_id
      and mp.status = 'PENDING'
      and mp.attempt_count = 0
      and not exists (
        select 1
        from public.mutation_executions execution
        where execution.plan_id = mp.id
      )
    returning mp.id, mp.policy_id
  loop
    perform public.append_meta_mutation_audit_event(
      p_user_id,
      p_platform_account_id,
      v_cancelled.policy_id,
      v_cancelled.id,
      null,
      null,
      'SYSTEM',
      'meta-budget-planner',
      'MUTATION_PLAN_STALE_AFTER_SNAPSHOT',
      jsonb_build_object('plan_status', 'PENDING'),
      jsonb_build_object('source_marketing_sync_id', p_source_marketing_sync_id),
      '{}'::jsonb,
      jsonb_build_object('plan_status', 'STALE'),
      jsonb_build_object('reason', 'superseded_by_marketing_snapshot'),
      null, null, null, null, null, p_planned_at
    );
  end loop;

  v_account_breach :=
    v_refresh.reserved_exposure_minor > v_policy.account_daily_hard_cap_minor;

  select coalesce(
    array_agg(breach.campaign_scope_key order by breach.campaign_scope_key),
    array[]::text[]
  ) into v_breach_campaigns
  from (
    select
      dbe.campaign_scope_key,
      sum(dbe.reserved_exposure_minor) as campaign_exposure,
      coalesce(
        cbl.daily_hard_cap_minor,
        v_policy.default_campaign_daily_hard_cap_minor
      ) as campaign_cap
    from public.daily_budget_exposures dbe
    left join public.campaign_budget_limits cbl
      on cbl.policy_id = v_policy.id
     and cbl.user_id = p_user_id
     and cbl.platform_account_id = p_platform_account_id
     and cbl.campaign_scope_key = dbe.campaign_scope_key
    where dbe.platform_account_id = p_platform_account_id
      and dbe.account_day = v_refresh.account_day
    group by
      dbe.campaign_scope_key,
      cbl.daily_hard_cap_minor,
      v_policy.default_campaign_daily_hard_cap_minor
    having sum(dbe.reserved_exposure_minor) > coalesce(
      cbl.daily_hard_cap_minor,
      v_policy.default_campaign_daily_hard_cap_minor
    )
  ) breach;

  v_campaign_breach := cardinality(v_breach_campaigns) > 0;

  if v_account_breach or v_campaign_breach then
    -- Only undispatched plans can be cancelled by the planner. Claimed or
    -- executing plans remain visible and block conflicting safety work until
    -- the Phase-9 reconciler resolves their remote state.
    for v_cancelled in
      update public.mutation_plans mp
      set
        status = 'CANCELLED',
        blocked_reason = 'hard_cap_exposure_breach',
        terminal_at = p_planned_at,
        updated_at = p_planned_at
      where mp.user_id = p_user_id
        and mp.platform_account_id = p_platform_account_id
        and mp.action_type = 'UPDATE_BUDGET'
        and mp.status in ('PENDING', 'RETRYABLE')
      returning mp.id, mp.policy_id
    loop
      perform public.append_meta_mutation_audit_event(
        p_user_id,
        p_platform_account_id,
        v_cancelled.policy_id,
        v_cancelled.id,
        null,
        null,
        'SYSTEM',
        'meta-budget-planner',
        'MUTATION_PLAN_CANCELLED_FOR_HARD_CAP',
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        jsonb_build_object('plan_status', 'CANCELLED'),
        jsonb_build_object('snapshot_id', v_refresh.snapshot_id),
        null, null, null, null, null, p_planned_at
      );
    end loop;

    perform public.append_meta_mutation_audit_event(
      p_user_id,
      p_platform_account_id,
      v_policy.id,
      null,
      null,
      null,
      'SYSTEM',
      'meta-budget-planner',
      'HARD_CAP_EXPOSURE_BREACH_DETECTED',
      '{}'::jsonb,
      jsonb_build_object(
        'snapshot_id', v_refresh.snapshot_id,
        'account_day', v_refresh.account_day
      ),
      '{}'::jsonb,
      jsonb_build_object(
        'account_breach', v_account_breach,
        'campaign_breach', v_campaign_breach
      ),
      jsonb_build_object(
        'reserved_exposure_minor', v_refresh.reserved_exposure_minor,
        'account_hard_cap_minor', v_policy.account_daily_hard_cap_minor,
        'campaign_scope_keys', to_jsonb(v_breach_campaigns)
      ),
      null, null, null, null, null, p_planned_at
    );

    for v_candidate in
      select
        target.id as automation_target_id,
        target.campaign_scope_key,
        coalesce(c.is_adset_budget_sharing_enabled, true)
          as shared_budget_enabled
      from public.campaigns c
      join public.automation_targets target
        on target.platform_account_id = c.platform_account_id
       and target.target_type = 'CAMPAIGN'
       and target.platform_object_id = c.platform_campaign_id
       and target.status = 'MANAGED'
      where c.user_id = p_user_id
        and c.platform_account_id = p_platform_account_id
        and c.is_current
        and c.last_seen_sync_id = p_source_marketing_sync_id
        and coalesce(c.effective_status, c.status) = 'ACTIVE'
        and (
          v_account_breach
          or target.campaign_scope_key = any(v_breach_campaigns)
        )
      order by target.campaign_scope_key
    loop
      v_result := public.queue_meta_hard_cap_pause_internal(
        p_user_id,
        p_platform_account_id,
        v_policy.id,
        v_refresh.snapshot_id,
        p_source_marketing_sync_id,
        v_candidate.automation_target_id,
        case when v_account_breach then 'ACCOUNT' else 'CAMPAIGN' end,
        jsonb_build_object(
          'account_day', v_refresh.account_day,
          'account_reserved_exposure_minor', v_refresh.reserved_exposure_minor,
          'account_hard_cap_minor', v_policy.account_daily_hard_cap_minor,
          'campaign_scope_key', v_candidate.campaign_scope_key,
          'campaign_scope_breached',
            v_candidate.campaign_scope_key = any(v_breach_campaigns),
          'unknown_or_shared_campaign_budget',
            v_candidate.shared_budget_enabled
        ),
        p_planned_at
      );

      if v_result->>'outcome' = 'CREATED' then
        v_created := v_created + 1;
      elsif v_result->>'outcome' = 'EXISTING' then
        v_existing := v_existing + 1;
      else
        v_blocked := v_blocked + 1;
      end if;
    end loop;

    return query select
      'HARD_CAP_SAFETY'::text,
      v_refresh.snapshot_id,
      v_refresh.account_day,
      v_refresh.observed_budget_owner_count,
      v_refresh.reserved_exposure_minor,
      v_created,
      v_existing,
      v_blocked,
      true;
    return;
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  if coalesce(v_kill_mode, 'ALLOW') <> 'ALLOW' then
    return query select
      'KILL_SWITCH_BLOCKED'::text,
      v_refresh.snapshot_id,
      v_refresh.account_day,
      v_refresh.observed_budget_owner_count,
      v_refresh.reserved_exposure_minor,
      0,
      0,
      0,
      false;
    return;
  end if;

  -- Negative campaign-level recommendations are mapped to the actual budget
  -- owners: one campaign owner for CBO, or every active ad-set owner for ABO.
  for v_candidate in
    select
      r.id as recommendation_id,
      r.rule_key,
      r.rule_version,
      r.evidence,
      target.id as automation_target_id,
      case when r.rule_key = 'spend_without_results_14d' then 2000 else 1000 end
        as change_bps
    from public.campaign_recommendations r
    join public.campaigns c
      on c.id = r.campaign_id
     and c.is_current
     and c.last_seen_sync_id = p_source_marketing_sync_id
     and coalesce(c.effective_status, c.status) = 'ACTIVE'
    join public.automation_targets target
      on target.platform_account_id = c.platform_account_id
     and target.target_type = 'CAMPAIGN'
     and target.platform_object_id = c.platform_campaign_id
     and target.budget_owner_type = 'CAMPAIGN'
     and target.status = 'MANAGED'
    where r.user_id = p_user_id
      and r.platform_account_id = p_platform_account_id
      and r.status = 'active'
      and r.expires_at > p_planned_at
      and r.rule_key in (
        'spend_without_results_14d', 'cost_per_result_up_30pct'
      )
      and coalesce(c.daily_budget_minor, 0) > 0
    order by change_bps desc, r.priority desc, r.id
  loop
    v_result := public.queue_meta_budget_plan_internal(
      p_user_id,
      p_platform_account_id,
      v_policy.id,
      v_refresh.snapshot_id,
      p_source_marketing_sync_id,
      v_candidate.recommendation_id,
      v_candidate.rule_key,
      v_candidate.rule_version,
      v_candidate.automation_target_id,
      'DECREASE',
      v_candidate.change_bps,
      v_candidate.evidence,
      p_planned_at
    );

    if v_result->>'outcome' = 'CREATED' then
      v_created := v_created + 1;
    elsif v_result->>'outcome' = 'EXISTING' then
      v_existing := v_existing + 1;
    else
      v_blocked := v_blocked + 1;
    end if;
  end loop;

  for v_candidate in
    select
      r.id as recommendation_id,
      r.rule_key,
      r.rule_version,
      r.evidence,
      target.id as automation_target_id,
      case when r.rule_key = 'spend_without_results_14d' then 2000 else 1000 end
        as change_bps
    from public.campaign_recommendations r
    join public.campaigns c
      on c.id = r.campaign_id
     and c.is_current
     and c.last_seen_sync_id = p_source_marketing_sync_id
     and coalesce(c.effective_status, c.status) = 'ACTIVE'
     and coalesce(c.daily_budget_minor, 0) = 0
    join public.ad_groups ag
      on ag.campaign_id = c.id
     and ag.is_current
     and ag.last_seen_sync_id = p_source_marketing_sync_id
     and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
     and coalesce(ag.daily_budget_minor, 0) > 0
    join public.automation_targets target
      on target.platform_account_id = ag.platform_account_id
     and target.target_type = 'AD_SET'
     and target.platform_object_id = ag.platform_ad_group_id
     and target.budget_owner_type = 'AD_SET'
     and target.status = 'MANAGED'
    where r.user_id = p_user_id
      and r.platform_account_id = p_platform_account_id
      and r.status = 'active'
      and r.expires_at > p_planned_at
      and r.rule_key in (
        'spend_without_results_14d', 'cost_per_result_up_30pct'
      )
    order by change_bps desc, r.priority desc, r.id, ag.platform_ad_group_id
  loop
    v_result := public.queue_meta_budget_plan_internal(
      p_user_id,
      p_platform_account_id,
      v_policy.id,
      v_refresh.snapshot_id,
      p_source_marketing_sync_id,
      v_candidate.recommendation_id,
      v_candidate.rule_key,
      v_candidate.rule_version,
      v_candidate.automation_target_id,
      'DECREASE',
      v_candidate.change_bps,
      v_candidate.evidence,
      p_planned_at
    );

    if v_result->>'outcome' = 'CREATED' then
      v_created := v_created + 1;
    elsif v_result->>'outcome' = 'EXISTING' then
      v_existing := v_existing + 1;
    else
      v_blocked := v_blocked + 1;
    end if;
  end loop;

  -- Positive rule: both complete seven-day windows need at least five tracked
  -- results and current cost per result must improve by at least 15%. Only lead
  -- and sales objectives have an unambiguous result definition in this model.
  for v_candidate in
    with owner_metrics as (
      select
        target.id as automation_target_id,
        c.id as campaign_id,
        target.campaign_scope_key,
        c.objective,
        case when c.objective = 'OUTCOME_SALES' then 'purchases' else 'leads' end
          as result_type,
        coalesce(sum(pd.spend) filter (
          where pd.date between v_account.marketing_insights_until - 6
            and v_account.marketing_insights_until
        ), 0) as current_spend,
        coalesce(sum(pd.spend) filter (
          where pd.date between v_account.marketing_insights_until - 13
            and v_account.marketing_insights_until - 7
        ), 0) as previous_spend,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) filter (
          where pd.date between v_account.marketing_insights_until - 6
            and v_account.marketing_insights_until
        ), 0)::numeric as current_results,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) filter (
          where pd.date between v_account.marketing_insights_until - 13
            and v_account.marketing_insights_until - 7
        ), 0)::numeric as previous_results
      from public.campaigns c
      join public.automation_targets target
        on target.platform_account_id = c.platform_account_id
       and target.target_type = 'CAMPAIGN'
       and target.platform_object_id = c.platform_campaign_id
       and target.budget_owner_type = 'CAMPAIGN'
       and target.status = 'MANAGED'
      join public.performance_data pd
        on pd.platform_account_id = c.platform_account_id
       and pd.campaign_id = c.id
       and pd.platform = 'meta'
       and pd.last_seen_sync_id = p_source_marketing_sync_id
       and pd.date between v_account.marketing_insights_until - 13
         and v_account.marketing_insights_until
      where c.user_id = p_user_id
        and c.platform_account_id = p_platform_account_id
        and c.is_current
        and c.last_seen_sync_id = p_source_marketing_sync_id
        and coalesce(c.effective_status, c.status) = 'ACTIVE'
        and coalesce(c.daily_budget_minor, 0) > 0
        and c.objective in ('OUTCOME_LEADS', 'OUTCOME_SALES')
        and not exists (
          select 1
          from public.campaign_recommendations negative
          where negative.user_id = p_user_id
            and negative.platform_account_id = p_platform_account_id
            and negative.campaign_id = c.id
            and negative.status = 'active'
            and negative.expires_at > p_planned_at
            and negative.rule_key in (
              'spend_without_results_14d', 'cost_per_result_up_30pct'
            )
        )
      group by target.id, c.id, target.campaign_scope_key, c.objective

      union all

      select
        target.id as automation_target_id,
        c.id as campaign_id,
        target.campaign_scope_key,
        c.objective,
        case when c.objective = 'OUTCOME_SALES' then 'purchases' else 'leads' end
          as result_type,
        coalesce(sum(pd.spend) filter (
          where pd.date between v_account.marketing_insights_until - 6
            and v_account.marketing_insights_until
        ), 0) as current_spend,
        coalesce(sum(pd.spend) filter (
          where pd.date between v_account.marketing_insights_until - 13
            and v_account.marketing_insights_until - 7
        ), 0) as previous_spend,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) filter (
          where pd.date between v_account.marketing_insights_until - 6
            and v_account.marketing_insights_until
        ), 0)::numeric as current_results,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) filter (
          where pd.date between v_account.marketing_insights_until - 13
            and v_account.marketing_insights_until - 7
        ), 0)::numeric as previous_results
      from public.ad_groups ag
      join public.campaigns c on c.id = ag.campaign_id
      join public.automation_targets target
        on target.platform_account_id = ag.platform_account_id
       and target.target_type = 'AD_SET'
       and target.platform_object_id = ag.platform_ad_group_id
       and target.budget_owner_type = 'AD_SET'
       and target.status = 'MANAGED'
      join public.performance_data pd
        on pd.platform_account_id = ag.platform_account_id
       and pd.ad_group_id = ag.id
       and pd.platform = 'meta'
       and pd.last_seen_sync_id = p_source_marketing_sync_id
       and pd.date between v_account.marketing_insights_until - 13
         and v_account.marketing_insights_until
      where ag.user_id = p_user_id
        and ag.platform_account_id = p_platform_account_id
        and ag.is_current
        and ag.last_seen_sync_id = p_source_marketing_sync_id
        and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
        and coalesce(ag.daily_budget_minor, 0) > 0
        and c.is_current
        and c.last_seen_sync_id = p_source_marketing_sync_id
        and coalesce(c.effective_status, c.status) = 'ACTIVE'
        and coalesce(c.daily_budget_minor, 0) = 0
        and c.objective in ('OUTCOME_LEADS', 'OUTCOME_SALES')
        and not exists (
          select 1
          from public.campaign_recommendations negative
          where negative.user_id = p_user_id
            and negative.platform_account_id = p_platform_account_id
            and negative.campaign_id = c.id
            and negative.status = 'active'
            and negative.expires_at > p_planned_at
            and negative.rule_key in (
              'spend_without_results_14d', 'cost_per_result_up_30pct'
            )
        )
      group by target.id, c.id, target.campaign_scope_key, c.objective
    )
    select
      metrics.automation_target_id,
      metrics.campaign_id,
      metrics.campaign_scope_key,
      metrics.result_type,
      metrics.current_spend,
      metrics.previous_spend,
      metrics.current_results,
      metrics.previous_results
    from owner_metrics metrics
    where v_account.marketing_insights_since is not null
      and v_account.marketing_insights_until is not null
      and v_account.marketing_insights_since
        <= v_account.marketing_insights_until - 13
      and metrics.current_results >= 5
      and metrics.previous_results >= 5
      and metrics.current_spend > 0
      and metrics.previous_spend > 0
      and (metrics.current_spend / metrics.current_results)
        <= (metrics.previous_spend / metrics.previous_results) * 0.85
    order by metrics.campaign_scope_key, metrics.automation_target_id
  loop
    v_current_results := v_candidate.current_results;
    v_previous_results := v_candidate.previous_results;
    v_current_spend := v_candidate.current_spend;
    v_previous_spend := v_candidate.previous_spend;

    v_result := public.queue_meta_budget_plan_internal(
      p_user_id,
      p_platform_account_id,
      v_policy.id,
      v_refresh.snapshot_id,
      p_source_marketing_sync_id,
      null,
      'cost_per_result_down_15pct',
      1,
      v_candidate.automation_target_id,
      'INCREASE',
      1000,
      jsonb_build_object(
        'rule', 'cost_per_result_down_15pct',
        'result_type', v_candidate.result_type,
        'current_cost_per_result',
          round(v_current_spend / v_current_results, 4),
        'previous_cost_per_result',
          round(v_previous_spend / v_previous_results, 4),
        'improvement_percent', round(
          (1 - (v_current_spend / v_current_results)
            / (v_previous_spend / v_previous_results)) * 100,
          2
        ),
        'current_results', v_current_results,
        'previous_results', v_previous_results,
        'threshold_percent', 15,
        'minimum_results_per_window', 5,
        'window_start', v_account.marketing_insights_until - 13,
        'window_end', v_account.marketing_insights_until,
        'currency', 'EUR'
      ),
      p_planned_at
    );

    if v_result->>'outcome' = 'CREATED' then
      v_created := v_created + 1;
    elsif v_result->>'outcome' = 'EXISTING' then
      v_existing := v_existing + 1;
    else
      v_blocked := v_blocked + 1;
    end if;
  end loop;

  return query select
    'PLANNED'::text,
    v_refresh.snapshot_id,
    v_refresh.account_day,
    v_refresh.observed_budget_owner_count,
    v_refresh.reserved_exposure_minor,
    v_created,
    v_existing,
    v_blocked,
    false;
end;
$$;

revoke all on function public.record_meta_campaign_budget_sharing_snapshot(
  uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.run_meta_budget_planner(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;

-- Internal helpers have no API-role grants. SECURITY DEFINER owner-to-owner calls
-- from run_meta_budget_planner remain possible without exposing partial writes.
revoke all on function public.refresh_meta_budget_planner_snapshot_internal(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.queue_meta_budget_plan_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, text, integer, uuid,
  text, integer, jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.queue_meta_hard_cap_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.record_meta_campaign_budget_sharing_snapshot(
  uuid, uuid, uuid, uuid, jsonb
) to service_role;
grant execute on function public.run_meta_budget_planner(
  uuid, uuid, uuid, uuid, timestamptz
) to service_role;

grant select (
  automation_planner_status,
  automation_planner_error_code,
  automation_planner_last_run_at,
  automation_planner_last_success_at,
  automation_planner_last_marketing_sync_id
) on table public.platform_accounts to authenticated;

comment on function public.run_meta_budget_planner(
  uuid, uuid, uuid, uuid, timestamptz
) is
  'Builds one conservative Meta daily exposure snapshot and queues deterministic immutable budget or hard-cap safety plans while the matching READ_SYNC lease is active. It performs no remote mutation.';

comment on column public.platform_accounts.automation_planner_status is
  'Non-sensitive status of the latest server-side deterministic planner attempt.';

comment on column public.platform_accounts.automation_planner_last_marketing_sync_id is
  'Marketing snapshot UUID consumed by the latest successful deterministic planner run.';

comment on column public.campaigns.is_adset_budget_sharing_enabled is
  'Meta campaign budget-sharing flag from the exact marketing sync. NULL is treated conservatively as shared and uses at least the 2.10 exposure multiplier.';

comment on column public.campaigns.budget_sharing_snapshot_sync_id is
  'Proves the sharing field was captured for the exact marketing snapshot, including an explicit unknown NULL value; same-sync replay drift is rejected.';

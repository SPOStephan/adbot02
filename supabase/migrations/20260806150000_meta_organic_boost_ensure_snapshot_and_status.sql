-- Beitrag-Push must start during the Abruf that recognizes posts.
-- 1) Ensure a COMPLETE exposure snapshot exists (refresh, else bootstrap).
-- 2) Persist planner outcome on platform_accounts for honest dashboard copy.
-- 3) Distinguish empty candidate sets / materialize failures from success.

begin;

alter table public.platform_accounts
  add column if not exists organic_boost_planner_status text,
  add column if not exists organic_boost_planner_detail jsonb,
  add column if not exists organic_boost_planner_last_run_at timestamptz;

comment on column public.platform_accounts.organic_boost_planner_status is
  'Last run_meta_organic_boost_planner status for this connector.';
comment on column public.platform_accounts.organic_boost_planner_detail is
  'Last organic boost planner result payload (counts, snapshot, last_error).';

create or replace function public.ensure_meta_organic_boost_exposure_snapshot(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_policy_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_planned_at timestamptz
)
returns public.daily_budget_exposure_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_refresh record;
  v_timezone text;
  v_account_day date;
begin
  select account.* into v_account
  from public.platform_accounts account
  where account.id = p_platform_account_id
    and account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null
    and account.marketing_currency = 'EUR';

  if not found then
    return null;
  end if;

  select policy.* into v_policy
  from public.automation_policies policy
  where policy.id = p_policy_id
    and policy.platform_account_id = p_platform_account_id
    and policy.user_id = p_user_id
    and policy.is_current
    and policy.status = 'ACTIVE';

  if not found then
    return null;
  end if;

  -- Prefer the normal budget-planner snapshot build when gates allow it.
  begin
    select * into v_refresh
    from public.refresh_meta_budget_planner_snapshot_internal(
      p_platform_account_id,
      p_user_id,
      p_source_marketing_sync_id,
      p_read_lease_token,
      p_planned_at
    );

    if v_refresh.planner_status = 'READY' and v_refresh.snapshot_id is not null then
      select snapshot.* into v_snapshot
      from public.daily_budget_exposure_snapshots snapshot
      where snapshot.id = v_refresh.snapshot_id
        and snapshot.status = 'COMPLETE';
      if found then
        return v_snapshot;
      end if;
    end if;
  exception when others then
    -- Fall through to bootstrap; Beitrag-Push must not hard-depend on budget planner.
    null;
  end;

  v_timezone := coalesce(nullif(v_account.marketing_timezone_name, ''), 'Europe/Berlin');
  begin
    v_account_day := (p_planned_at at time zone v_timezone)::date;
  exception when others then
    v_timezone := 'Europe/Berlin';
    v_account_day := (p_planned_at at time zone v_timezone)::date;
  end;

  insert into public.daily_budget_exposure_snapshots (
    user_id,
    platform_account_id,
    policy_id,
    account_day,
    account_timezone_name,
    source_marketing_sync_id,
    currency,
    status,
    observed_budget_owner_count,
    reserved_exposure_minor,
    completed_at
  ) values (
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    v_account_day,
    v_timezone,
    p_source_marketing_sync_id,
    'EUR',
    'COMPLETE',
    0,
    0,
    p_planned_at
  )
  on conflict on constraint daily_exposure_snapshots_account_day_sync_key
  do update set
    policy_id = excluded.policy_id,
    account_timezone_name = excluded.account_timezone_name,
    currency = 'EUR',
    status = 'COMPLETE',
    completed_at = coalesce(
      public.daily_budget_exposure_snapshots.completed_at,
      excluded.completed_at
    ),
    updated_at = now()
  returning * into v_snapshot;

  if v_snapshot.status <> 'COMPLETE' then
    update public.daily_budget_exposure_snapshots snapshot
    set
      status = 'COMPLETE',
      completed_at = coalesce(snapshot.completed_at, p_planned_at),
      updated_at = now()
    where snapshot.id = v_snapshot.id
    returning * into v_snapshot;
  end if;

  return v_snapshot;
end;
$$;

revoke all on function public.ensure_meta_organic_boost_exposure_snapshot(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.ensure_meta_organic_boost_exposure_snapshot(
  uuid, uuid, uuid, uuid, uuid, timestamptz
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
  v_considered integer := 0;
  v_snapshot_sync_id uuid;
  v_last_error text := null;
  v_status text;
  v_detail jsonb;
begin
  if p_platform_account_id is null
    or p_user_id is null
    or p_source_marketing_sync_id is null
    or p_read_lease_token is null
    or p_planned_at is null then
    v_status := 'INVALID_INPUT';
    v_detail := jsonb_build_object('status', v_status);
    update public.platform_accounts
    set
      organic_boost_planner_status = v_status,
      organic_boost_planner_detail = v_detail,
      organic_boost_planner_last_run_at = p_planned_at,
      updated_at = now()
    where id = p_platform_account_id and user_id = p_user_id;
    return v_detail;
  end if;

  select settings.* into v_settings
  from public.meta_boost_settings settings
  where settings.platform_account_id = p_platform_account_id
    and settings.user_id = p_user_id
    and settings.is_current
    and settings.enabled
    and settings.auto_boost_new_candidates;

  if not found then
    v_status := 'DISABLED';
    v_detail := jsonb_build_object(
      'status', v_status,
      'plans_created', 0,
      'plans_existing', 0,
      'candidates_skipped', 0,
      'candidates_failed', 0,
      'candidates_considered', 0
    );
    update public.platform_accounts
    set
      organic_boost_planner_status = v_status,
      organic_boost_planner_detail = v_detail,
      organic_boost_planner_last_run_at = p_planned_at,
      updated_at = now()
    where id = p_platform_account_id and user_id = p_user_id;
    return v_detail;
  end if;

  select account.* into v_account
  from public.platform_accounts account
  where account.id = p_platform_account_id
    and account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null
    and account.marketing_currency = 'EUR'
    and account.marketing_sync_status = 'success'
    and 'ads_management' = any(account.meta_scopes);

  if not found then
    v_status := 'ACCOUNT_UNAVAILABLE';
    v_detail := jsonb_build_object('status', v_status);
    update public.platform_accounts
    set
      organic_boost_planner_status = v_status,
      organic_boost_planner_detail = v_detail,
      organic_boost_planner_last_run_at = p_planned_at,
      updated_at = now()
    where id = p_platform_account_id and user_id = p_user_id;
    return v_detail;
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
    v_status := 'LEASE_REQUIRED';
    v_detail := jsonb_build_object('status', v_status);
    update public.platform_accounts
    set
      organic_boost_planner_status = v_status,
      organic_boost_planner_detail = v_detail,
      organic_boost_planner_last_run_at = p_planned_at,
      updated_at = now()
    where id = p_platform_account_id and user_id = p_user_id;
    return v_detail;
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
    v_status := 'NO_ACTIVE_POLICY';
    v_detail := jsonb_build_object('status', v_status);
    update public.platform_accounts
    set
      organic_boost_planner_status = v_status,
      organic_boost_planner_detail = v_detail,
      organic_boost_planner_last_run_at = p_planned_at,
      updated_at = now()
    where id = p_platform_account_id and user_id = p_user_id;
    return v_detail;
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
    select snapshot.* into v_snapshot
    from public.daily_budget_exposure_snapshots snapshot
    where snapshot.user_id = p_user_id
      and snapshot.platform_account_id = p_platform_account_id
      and snapshot.policy_id = v_policy.id
      and snapshot.status = 'COMPLETE'
      and snapshot.currency = 'EUR'
    order by snapshot.completed_at desc nulls last, snapshot.created_at desc
    limit 1;
  end if;

  if not found then
    select snapshot.* into v_snapshot
    from public.daily_budget_exposure_snapshots snapshot
    where snapshot.user_id = p_user_id
      and snapshot.platform_account_id = p_platform_account_id
      and snapshot.status = 'COMPLETE'
      and snapshot.currency = 'EUR'
    order by snapshot.completed_at desc nulls last, snapshot.created_at desc
    limit 1;
  end if;

  if not found then
    v_snapshot := public.ensure_meta_organic_boost_exposure_snapshot(
      p_platform_account_id,
      p_user_id,
      v_policy.id,
      p_source_marketing_sync_id,
      p_read_lease_token,
      p_planned_at
    );
  end if;

  if v_snapshot.id is null then
    v_status := 'STALE_OR_INVALID_SNAPSHOT';
    v_detail := jsonb_build_object('status', v_status);
    update public.platform_accounts
    set
      organic_boost_planner_status = v_status,
      organic_boost_planner_detail = v_detail,
      organic_boost_planner_last_run_at = p_planned_at,
      updated_at = now()
    where id = p_platform_account_id and user_id = p_user_id;
    return v_detail;
  end if;

  v_snapshot_sync_id := v_snapshot.source_marketing_sync_id;

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
    v_considered := v_considered + 1;
    begin
      v_result := public.materialize_meta_organic_boost_plan(
        p_platform_account_id,
        p_user_id,
        v_policy.id,
        v_snapshot.id,
        v_snapshot_sync_id,
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
        v_last_error := coalesce(v_result->>'reason', v_last_error);
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_last_error := SQLERRM;
    end;
  end loop;

  if v_considered = 0 then
    v_status := 'NO_ELIGIBLE_CANDIDATES';
  elsif v_created + v_existing = 0 and v_failed > 0 then
    v_status := 'MATERIALIZE_FAILED';
  else
    v_status := 'PLANNED';
  end if;

  v_detail := jsonb_build_object(
    'status', v_status,
    'plans_created', v_created,
    'plans_existing', v_existing,
    'candidates_skipped', v_skipped,
    'candidates_failed', v_failed,
    'candidates_considered', v_considered,
    'settings_id', v_settings.id,
    'snapshot_id', v_snapshot.id,
    'snapshot_marketing_sync_id', v_snapshot_sync_id,
    'last_error', to_jsonb(v_last_error)
  );

  update public.platform_accounts
  set
    organic_boost_planner_status = v_status,
    organic_boost_planner_detail = v_detail,
    organic_boost_planner_last_run_at = p_planned_at,
    updated_at = now()
  where id = p_platform_account_id and user_id = p_user_id;

  return v_detail;
end;
$$;

revoke all on function public.run_meta_organic_boost_planner(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.run_meta_organic_boost_planner(
  uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.run_meta_organic_boost_planner(uuid, uuid, uuid, uuid, timestamptz) is
  'Materialize organic boost plans during Abruf. Ensures a COMPLETE exposure snapshot (refresh or bootstrap) and persists planner status on the connector.';

commit;

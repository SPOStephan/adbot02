-- Beitrag-Push planning is DB-only and must not compete with Abruf READ_SYNC
-- or Meta-Executor WRITE_EXECUTION for the shared account operation lease.
-- Serialize organic planners with a transaction advisory lock instead.

begin;

-- Drop the READ_SYNC hard-require from materialize (intent body otherwise unchanged).
do $patch$
declare
  v_def text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.materialize_meta_organic_boost_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'materialize_meta_organic_boost_plan not found';
  end if;

  if position('Valid READ_SYNC lease is required for organic boost' in v_def) = 0 then
    return;
  end if;

  -- Keep the exists-check shape, but never abort: Autonomie planning must not
  -- depend on the shared Abruf/Executor account lease.
  v_updated := replace(
    v_def,
    'raise exception ''Valid READ_SYNC lease is required for organic boost'';',
    'null; -- READ_SYNC optional; planner serializes via advisory lock'
  );

  if position('Valid READ_SYNC lease is required for organic boost' in v_updated) > 0 then
    raise exception 'Failed to remove READ_SYNC lease gate from materialize_meta_organic_boost_plan';
  end if;

  execute v_updated;
end;
$patch$;

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
  v_lease_token uuid := p_read_lease_token;
begin
  if p_platform_account_id is null
    or p_user_id is null
    or p_source_marketing_sync_id is null
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

  -- Serialize Beitrag-Push planning per account without the Abruf/Executor lease.
  perform pg_advisory_xact_lock(
    87201401,
    hashtext(p_platform_account_id::text || ':' || p_user_id::text)
  );

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

  -- Optional: reuse a live READ_SYNC token from Abruf when present. Never block
  -- Autonomie planning when Abruf/Executor holds the shared account lease.
  if v_lease_token is null
    or not exists (
      select 1
      from public.meta_account_operation_leases lease
      where lease.platform_account_id = p_platform_account_id
        and lease.user_id = p_user_id
        and lease.lease_kind = 'READ_SYNC'
        and lease.lease_token = v_lease_token
        and lease.expires_at > now()
    ) then
    v_lease_token := null;
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
      v_lease_token,
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
        coalesce(v_lease_token, '00000000-0000-4000-8000-0000000000b1'::uuid),
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
  'Materialize organic boost plans without requiring the shared Abruf/Executor account lease. Serializes via pg_advisory_xact_lock.';

commit;

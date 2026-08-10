-- Dedicated launch exposure snapshot ensure: never returns null when account +
-- policy exist; uses DB now() for account_day to avoid Vercel clock skew.

begin;

create or replace function public.ensure_meta_customer_launch_exposure_snapshot(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_policy_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid default null,
  p_planned_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_timezone text;
  v_account_day date;
  v_planned_at timestamptz := coalesce(p_planned_at, now());
begin
  if p_platform_account_id is null
    or p_user_id is null
    or p_policy_id is null
    or p_source_marketing_sync_id is null then
    raise exception 'Launch exposure snapshot identity is incomplete';
  end if;

  select account.* into v_account
  from public.platform_accounts account
  where account.id = p_platform_account_id
    and account.user_id = p_user_id
    and account.platform = 'meta'
    and account.revoked_at is null
    and account.marketing_currency = 'EUR';

  if not found then
    raise exception 'EUR Meta account is required for launch exposure snapshot';
  end if;

  select policy.* into v_policy
  from public.automation_policies policy
  where policy.id = p_policy_id
    and policy.platform_account_id = p_platform_account_id
    and policy.user_id = p_user_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.currency = 'EUR';

  if not found then
    raise exception 'Active EUR launch policy is required for exposure snapshot';
  end if;

  v_timezone := coalesce(nullif(v_account.marketing_timezone_name, ''), 'Europe/Berlin');
  if not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = v_timezone
  ) then
    v_timezone := 'Europe/Berlin';
  end if;

  begin
    v_account_day := (v_planned_at at time zone v_timezone)::date;
  exception when others then
    v_timezone := 'Europe/Berlin';
    v_account_day := (v_planned_at at time zone v_timezone)::date;
  end;

  -- Prefer an already-complete snapshot for this sync/day.
  select snapshot.*
  into v_snapshot
  from public.daily_budget_exposure_snapshots snapshot
  where snapshot.user_id = p_user_id
    and snapshot.platform_account_id = p_platform_account_id
    and snapshot.policy_id = p_policy_id
    and snapshot.source_marketing_sync_id = p_source_marketing_sync_id
    and snapshot.account_day = v_account_day
    and snapshot.status = 'COMPLETE'
    and snapshot.currency = 'EUR'
  order by snapshot.completed_at desc nulls last, snapshot.created_at desc
  limit 1;

  if found then
    return v_snapshot.id;
  end if;

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
    v_planned_at
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

  if v_snapshot.id is null or v_snapshot.status <> 'COMPLETE' then
    update public.daily_budget_exposure_snapshots snapshot
    set
      status = 'COMPLETE',
      policy_id = p_policy_id,
      account_timezone_name = v_timezone,
      currency = 'EUR',
      completed_at = coalesce(snapshot.completed_at, v_planned_at),
      updated_at = now()
    where snapshot.platform_account_id = p_platform_account_id
      and snapshot.account_day = v_account_day
      and snapshot.source_marketing_sync_id = p_source_marketing_sync_id
    returning * into v_snapshot;
  end if;

  if v_snapshot.id is null then
    raise exception 'Launch exposure snapshot could not be created';
  end if;

  return v_snapshot.id;
end;
$$;

revoke all on function public.ensure_meta_customer_launch_exposure_snapshot(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.ensure_meta_customer_launch_exposure_snapshot(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.ensure_meta_customer_launch_exposure_snapshot(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) is
  'Ensures a COMPLETE daily exposure snapshot for customer launch prepare.';

commit;

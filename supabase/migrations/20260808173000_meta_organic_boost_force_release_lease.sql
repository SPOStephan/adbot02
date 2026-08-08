-- Owner "Manuell erneut prüfen" saw:
--   due=9 preflight_ok=9 lease_idle=false → claim_idle_with_due_plans
-- Preflight was green; the Meta WRITE lease was still held (stale drain/diagnose/
-- cron). Force-release the account lease in prepare, and unlock CLAIMED organic
-- plans so activate can continue for remaining PAUSED objects.

begin;

create or replace function public.force_release_meta_account_operation_lease(
  p_platform_account_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released boolean := false;
begin
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta account operation scope is invalid';
  end if;

  insert into public.meta_account_operation_leases (
    platform_account_id, user_id
  ) values (
    p_platform_account_id, p_user_id
  ) on conflict (platform_account_id) do nothing;

  update public.meta_account_operation_leases
  set
    user_id = p_user_id,
    lease_kind = null,
    lease_token = null,
    owner_id = null,
    acquired_at = null,
    expires_at = null,
    updated_at = now()
  where platform_account_id = p_platform_account_id
    and (
      lease_token is not null
      or expires_at is not null
      or user_id is distinct from p_user_id
    );

  v_released := found;
  return v_released;
end;
$$;

revoke all on function public.force_release_meta_account_operation_lease(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.force_release_meta_account_operation_lease(uuid, uuid)
  to service_role;

comment on function public.force_release_meta_account_operation_lease(uuid, uuid) is
  'Owner-scoped force clear of Meta account WRITE/READ lease for Beitrag-Push drain.';

-- prepare: force-release lease before counting; also unlock stuck CLAIMED plans.
drop function if exists public.diagnose_meta_organic_boost_write_now(uuid, uuid);
drop function if exists public.prepare_meta_organic_boost_write_now(uuid, uuid);

create or replace function public.prepare_meta_organic_boost_write_now(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns table (
  due_plans integer,
  lease_user_id uuid,
  account_user_id uuid,
  lease_idle boolean,
  lease_user_matches boolean,
  kill_switch_mode text,
  preflight_ok_count integer,
  rebound_plans integer,
  preflight_blocker text,
  rebind_detail text,
  lease_forced boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kill text;
  v_due integer := 0;
  v_preflight_ok integer := 0;
  v_rebound integer := 0;
  v_rebind_detail text := null;
  v_blocker text := null;
  v_lease_user uuid;
  v_account_user uuid;
  v_expires timestamptz;
  v_plan_id uuid;
  v_rebind record;
  v_lease_forced boolean := false;
begin
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta account operation scope is invalid';
  end if;

  begin
    v_lease_forced := public.force_release_meta_account_operation_lease(
      p_platform_account_id, p_user_id
    );
  exception
    when others then
      perform public.heal_meta_account_operation_lease(
        p_platform_account_id, p_user_id
      );
      v_lease_forced := false;
      v_rebind_detail := 'lease_force_failed:' || SQLERRM;
  end;

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  begin
    select * into v_rebind
    from public.rebind_meta_organic_boost_plans_to_current_policy(
      p_user_id, p_platform_account_id
    );
    v_rebound := coalesce(v_rebind.rebound_count, 0);
    v_rebind_detail := case
      when v_rebind_detail is null then v_rebind.detail
      else v_rebind_detail || ';' || coalesce(v_rebind.detail, '')
    end;
  exception
    when others then
      v_rebound := 0;
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'prepare_rebind_call:' || SQLERRM;
  end;

  begin
    perform public.revive_meta_organic_boost_superseded_plans(
      p_user_id, p_platform_account_id
    );
  exception
    when others then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'revive:' || SQLERRM;
  end;

  if coalesce(v_kill, 'FREEZE_WRITES') = 'ALLOW' then
    -- Unlock soft-blocked and mid-flight organic plans for immediate reclaim.
    update public.mutation_plans mp
    set
      status = 'PENDING',
      not_before = least(coalesce(mp.not_before, now()), now()),
      blocked_reason = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive'
        ) then null
        else mp.blocked_reason
      end,
      error_class = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive'
        ) then null
        else mp.error_class
      end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = null,
      updated_at = now()
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE',
        'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING'
      );
  end if;

  select count(*)::integer into v_due
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and mp.attempt_count < mp.max_attempts;

  select count(*)::integer into v_preflight_ok
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and public.meta_launch_canary_preflight_ok(mp.id);

  if v_due > 0 and v_preflight_ok < 1 then
    select mp.id into v_plan_id
    from public.mutation_plans mp
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in ('PENDING', 'RETRYABLE')
      and mp.not_before <= now()
    order by mp.created_at asc
    limit 1;

    if v_plan_id is not null then
      select string_agg(d.check_name, ',' order by d.check_name)
        into v_blocker
      from public.diagnose_meta_organic_boost_plan_preflight(v_plan_id) d
      where d.ok is not true
        and d.check_name <> 'preflight_ok';
    end if;
  end if;

  select lease.user_id, lease.expires_at, account.user_id
    into v_lease_user, v_expires, v_account_user
  from public.platform_accounts account
  left join public.meta_account_operation_leases lease
    on lease.platform_account_id = account.id
  where account.id = p_platform_account_id
    and account.user_id = p_user_id;

  return query select
    v_due,
    v_lease_user,
    v_account_user,
    (v_expires is null or v_expires <= now()),
    (v_lease_user is not distinct from v_account_user),
    coalesce(v_kill, 'FREEZE_WRITES'),
    v_preflight_ok,
    v_rebound,
    v_blocker,
    v_rebind_detail,
    v_lease_forced;
end;
$$;

revoke all on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  to service_role;

comment on function public.prepare_meta_organic_boost_write_now(uuid, uuid) is
  'Force-releases Meta WRITE lease, rebinds/revives organic plans, reports preflight + lease_forced.';

-- Diagnose after prepare must NOT hold a probe lease across the RPC boundary
-- before drain. Keep status checks only (no claim_meta_account_operation).
create or replace function public.diagnose_meta_organic_boost_write_now(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns table (
  check_name text,
  ok boolean,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prep record;
  v_plan_id uuid;
begin
  select * into v_prep
  from public.prepare_meta_organic_boost_write_now(
    p_user_id, p_platform_account_id
  );

  return query select
    'kill_switch'::text,
    v_prep.kill_switch_mode = 'ALLOW',
    v_prep.kill_switch_mode;

  return query select
    'due_plans'::text,
    v_prep.due_plans > 0,
    v_prep.due_plans::text;

  return query select
    'preflight_ok_plans'::text,
    v_prep.preflight_ok_count > 0,
    format('%s of %s due plans pass preflight', v_prep.preflight_ok_count, v_prep.due_plans);

  return query select
    'rebound_plans'::text,
    true,
    coalesce(v_prep.rebind_detail, v_prep.rebound_plans::text);

  return query select
    'lease_forced'::text,
    coalesce(v_prep.lease_forced, false),
    case
      when coalesce(v_prep.lease_forced, false) then 'WRITE lease force-released'
      else 'lease already idle or force no-op'
    end;

  return query select
    'lease_idle'::text,
    coalesce(v_prep.lease_idle, false),
    case
      when v_prep.lease_idle then 'lease idle'
      else 'lease still held after force-release — unexpected'
    end;

  return query select
    'lease_user_matches'::text,
    coalesce(v_prep.lease_user_matches, false),
    format('lease=%s account=%s', v_prep.lease_user_id, v_prep.account_user_id);

  if coalesce(v_prep.preflight_blocker, '') <> '' then
    return query select
      'preflight_blocker'::text,
      false,
      v_prep.preflight_blocker;
  end if;

  select mp.id into v_plan_id
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and not public.meta_launch_canary_preflight_ok(mp.id)
  order by mp.created_at asc
  limit 1;

  if v_plan_id is not null then
    return query
    select
      ('plan:' || d.check_name)::text,
      d.ok,
      d.detail
    from public.diagnose_meta_organic_boost_plan_preflight(v_plan_id) d;
  end if;

  return query select
    'next_step'::text,
    v_prep.due_plans > 0
      and v_prep.preflight_ok_count > 0
      and coalesce(v_prep.lease_idle, false)
      and v_prep.kill_switch_mode = 'ALLOW',
    case
      when v_prep.preflight_ok_count < 1 then
        format(
          'Kein Plan besteht Preflight (%s) rebind=%s',
          coalesce(v_prep.preflight_blocker, 'unknown'),
          coalesce(v_prep.rebind_detail, 'n/a')
        )
      when not coalesce(v_prep.lease_idle, false) then
        'Lease nach Force-Release noch busy'
      when v_prep.kill_switch_mode <> 'ALLOW' then
        'Kill-Switch blockiert'
      when v_prep.due_plans < 1 then
        'Keine fälligen Pläne'
      else
        'SQL-Seite bereit — Node Executor/Drain muss processNextMetaMutation laufen lassen'
    end;
end;
$$;

revoke all on function public.diagnose_meta_organic_boost_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.diagnose_meta_organic_boost_write_now(uuid, uuid)
  to service_role;

commit;

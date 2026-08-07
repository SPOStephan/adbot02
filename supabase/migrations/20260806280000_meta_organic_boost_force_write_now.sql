-- Force Beitrag-Push to become claimable and prove the write path can start.
-- 1) Re-assert idle lease reclaim (no-op if 06270000 already applied).
-- 2) prepare_meta_organic_boost_write_now: heal lease + make due organic plans claimable.
-- 3) diagnose_meta_organic_boost_write_now: one-shot status for the owner.

begin;

-- ---------------------------------------------------------------------------
-- 1) Idle lease reclaim (idempotent with 20260806270000)
-- ---------------------------------------------------------------------------
create or replace function public.claim_meta_account_operation(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_lease_kind text,
  p_owner_id text,
  p_lease_seconds integer default 300
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
  v_claimed uuid;
begin
  if p_lease_kind not in ('READ_SYNC', 'WRITE_EXECUTION')
    or nullif(p_owner_id, '') is null then
    raise exception 'Invalid Meta operation lease request';
  end if;

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
    lease_kind = p_lease_kind,
    lease_token = v_token,
    owner_id = p_owner_id,
    acquired_at = now(),
    expires_at = now() + make_interval(
      secs => greatest(30, least(900, p_lease_seconds))
    ),
    updated_at = now()
  where platform_account_id = p_platform_account_id
    and (expires_at is null or expires_at <= now())
  returning lease_token into v_claimed;

  return v_claimed;
end;
$$;

revoke all on function public.claim_meta_account_operation(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_meta_account_operation(uuid, uuid, text, text, integer)
  to service_role;

create or replace function public.heal_meta_account_operation_lease(
  p_platform_account_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
    updated_at = now()
  where platform_account_id = p_platform_account_id
    and (expires_at is null or expires_at <= now())
    and user_id is distinct from p_user_id;

  return found;
end;
$$;

revoke all on function public.heal_meta_account_operation_lease(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.heal_meta_account_operation_lease(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2) Prepare organic plans for immediate claim (clear soft delays)
-- ---------------------------------------------------------------------------
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
  preflight_ok_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kill text;
  v_due integer := 0;
  v_preflight_ok integer := 0;
  v_lease_user uuid;
  v_account_user uuid;
  v_expires timestamptz;
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

  perform public.heal_meta_account_operation_lease(
    p_platform_account_id, p_user_id
  );

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  -- Pull soft-delayed organic plans back to now when writes are allowed.
  if coalesce(v_kill, 'FREEZE_WRITES') = 'ALLOW' then
    update public.mutation_plans mp
    set
      status = 'PENDING',
      not_before = least(coalesce(mp.not_before, now()), now()),
      blocked_reason = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen'
        ) then null
        else mp.blocked_reason
      end,
      error_class = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen'
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
      and mp.status in ('PENDING', 'RETRYABLE');
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
    v_preflight_ok;
end;
$$;

revoke all on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  to service_role;

comment on function public.prepare_meta_organic_boost_write_now(uuid, uuid) is
  'Heals idle Meta lease and pulls organic-boost plans to immediate claimability when ALLOW.';

-- ---------------------------------------------------------------------------
-- 3) Owner-facing diagnose: prepare + probe lease claim + report
-- ---------------------------------------------------------------------------
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
  v_lease_token uuid;
  v_idle_reclaim boolean;
begin
  select position(
    'and (expires_at is null or expires_at <= now())'
    in pg_get_functiondef(
      'public.claim_meta_account_operation(uuid,uuid,text,text,integer)'::regprocedure
    )
  ) > 0
  and position(
    'and user_id = p_user_id'
    in pg_get_functiondef(
      'public.claim_meta_account_operation(uuid,uuid,text,text,integer)'::regprocedure
    )
  ) = 0
  into v_idle_reclaim;

  return query select
    'idle_lease_reclaim_applied'::text,
    coalesce(v_idle_reclaim, false),
    case
      when coalesce(v_idle_reclaim, false) then 'claim_meta_account_operation reclaimt idle leases'
      else 'ALTE claim_meta_account_operation — Migration nicht angewendet'
    end;

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
    'lease_idle'::text,
    coalesce(v_prep.lease_idle, false),
    case
      when v_prep.lease_idle then 'lease idle'
      else 'lease held — WRITE blocked until release/expiry'
    end;

  return query select
    'lease_user_matches'::text,
    coalesce(v_prep.lease_user_matches, false),
    format('lease=%s account=%s', v_prep.lease_user_id, v_prep.account_user_id);

  -- Probe ONLY the account lease (release immediately). Do not call
  -- claim_next here — that would hold a plan without the Node executor.
  v_lease_token := public.claim_meta_account_operation(
    p_platform_account_id,
    p_user_id,
    'WRITE_EXECUTION',
    'diagnose-organic-boost-write-now',
    120
  );

  return query select
    'lease_claim'::text,
    v_lease_token is not null,
    case
      when v_lease_token is null then 'claim_meta_account_operation returned null — Meta-Write unmöglich'
      else 'WRITE lease ok (sofort wieder freigegeben)'
    end;

  if v_lease_token is not null then
    perform public.release_meta_account_operation(
      p_platform_account_id, p_user_id, v_lease_token
    );
  end if;

  return query select
    'next_step'::text,
    v_prep.due_plans > 0
      and v_prep.preflight_ok_count > 0
      and v_lease_token is not null
      and v_prep.kill_switch_mode = 'ALLOW',
    case
      when v_prep.preflight_ok_count < 1 then
        'Kein Plan besteht Preflight — Executor skippt soft (blocked_reason prüfen)'
      when v_lease_token is null then
        'Lease-Claim fehlgeschlagen — Migration/Lease prüfen'
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

comment on function public.diagnose_meta_organic_boost_write_now(uuid, uuid) is
  'Owner/service diagnose: heal lease, prepare organic plans, probe WRITE claim and claim_next.';

-- One-shot heal all idle drifted leases
update public.meta_account_operation_leases lease
set
  user_id = account.user_id,
  updated_at = now()
from public.platform_accounts account
where lease.platform_account_id = account.id
  and account.platform = 'meta'
  and account.revoked_at is null
  and lease.user_id is distinct from account.user_id
  and (lease.expires_at is null or lease.expires_at <= now());

commit;

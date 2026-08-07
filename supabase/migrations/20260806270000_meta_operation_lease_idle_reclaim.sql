-- Idle Meta operation leases with a stale/wrong user_id silently block every
-- WRITE_EXECUTION claim (claim returns null → claim_next continues without
-- touching the plan → organic-boost stays PENDING forever, no Meta HTTP).
--
-- Fix: idle leases are always reclaimable by the verified account owner.
-- Also surface null-lease skips so Ampel never stays blank again.

begin;

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

  -- Idle lease: always take it as the verified owner (realign user_id if needed).
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

comment on function public.claim_meta_account_operation(uuid, uuid, text, text, integer) is
  'Claims READ_SYNC/WRITE_EXECUTION lease. Idle leases are always reclaimable by the verified account owner.';

-- Explicit heal for app drain paths before claim_next.
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

comment on function public.heal_meta_account_operation_lease(uuid, uuid) is
  'Realigns idle Meta operation lease user_id to the verified account owner.';

-- Stop silent continue on null lease: soft-mark so Ampel/drain can see the block.
do $patch$
declare
  v_def text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.claim_next_meta_mutation_execution(text,integer)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'claim_next_meta_mutation_execution not found';
  end if;

  if position('account_operation_lease_busy' in v_def) > 0 then
    return;
  end if;

  v_updated := replace(
    v_def,
    $old$if v_lease_token is null then
      continue;
    end if;$old$,
    $new$if v_lease_token is null then
      update public.mutation_plans
      set
        blocked_reason = 'account_operation_lease_busy',
        error_class = coalesce(error_class, 'PREFLIGHT'),
        not_before = greatest(coalesce(not_before, now()), now() + interval '30 seconds'),
        updated_at = now()
      where id = v_plan.id
        and status in ('PENDING', 'RETRYABLE');
      continue;
    end if;$new$
  );

  if position('account_operation_lease_busy' in v_updated) = 0 then
    raise exception 'Failed to patch claim_next_meta_mutation_execution null-lease soft mark';
  end if;

  execute v_updated;
end;
$patch$;

-- One-shot heal: align idle lease tenants to platform_accounts.user_id
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

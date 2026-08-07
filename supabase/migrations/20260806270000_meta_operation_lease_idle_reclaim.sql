-- Idle Meta operation leases with a stale/wrong user_id silently block every
-- WRITE_EXECUTION claim (claim returns null, plans stay PENDING forever).
-- Reclaim idle leases and align user_id to the owning platform_accounts row.

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

  -- Idle leases must be reclaimable even if user_id drifted.
  update public.meta_account_operation_leases
  set
    user_id = p_user_id,
    updated_at = now()
  where platform_account_id = p_platform_account_id
    and user_id is distinct from p_user_id
    and (expires_at is null or expires_at <= now());

  update public.meta_account_operation_leases
  set
    lease_kind = p_lease_kind,
    lease_token = v_token,
    owner_id = p_owner_id,
    acquired_at = now(),
    expires_at = now() + make_interval(
      secs => greatest(30, least(900, p_lease_seconds))
    ),
    updated_at = now()
  where platform_account_id = p_platform_account_id
    and user_id = p_user_id
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
  'Claims READ_SYNC/WRITE_EXECUTION lease. Idle leases with drifted user_id are realigned and reclaimable.';

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

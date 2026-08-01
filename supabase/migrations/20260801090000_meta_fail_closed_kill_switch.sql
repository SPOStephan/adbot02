-- Meta write operations must never become enabled merely because no kill-switch
-- event exists. An explicit account-level ALLOW event is required before writes.

create or replace function public.get_effective_meta_kill_switch(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid default null
)
returns table (
  mode text,
  scope_type text,
  event_id uuid,
  reason text,
  created_at timestamptz
)
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
  ) then
    raise exception 'Kill-switch lookup scope is invalid';
  end if;

  return query
  with latest_system as (
    select kss.*
    from public.kill_switch_state kss
    where kss.scope_type = 'SYSTEM'
    order by kss.sequence desc
    limit 1
  ), latest_account as (
    select kss.*
    from public.kill_switch_state kss
    where kss.scope_type = 'ACCOUNT'
      and kss.user_id = p_user_id
      and kss.platform_account_id = p_platform_account_id
    order by kss.sequence desc
    limit 1
  ), latest_plan as (
    select kss.*
    from public.kill_switch_state kss
    where p_plan_id is not null
      and kss.scope_type = 'PLAN'
      and kss.user_id = p_user_id
      and kss.platform_account_id = p_platform_account_id
      and kss.plan_id = p_plan_id
    order by kss.sequence desc
    limit 1
  ), blocking as (
    select ls.*, 3 as precedence from latest_system ls where ls.mode <> 'ALLOW'
    union all
    select la.*, 2 as precedence from latest_account la where la.mode <> 'ALLOW'
    union all
    select lp.*, 1 as precedence from latest_plan lp where lp.mode <> 'ALLOW'
  )
  select b.mode, b.scope_type, b.id, b.reason, b.created_at
  from blocking b
  order by b.precedence desc
  limit 1;

  if found then
    return;
  end if;

  -- A plan-level ALLOW cannot implicitly enable an account. Only the latest
  -- explicit account event may open the write gate when no wider blocker exists.
  return query
  select kss.mode, kss.scope_type, kss.id, kss.reason, kss.created_at
  from public.kill_switch_state kss
  where kss.scope_type = 'ACCOUNT'
    and kss.user_id = p_user_id
    and kss.platform_account_id = p_platform_account_id
    and kss.mode = 'ALLOW'
  order by kss.sequence desc
  limit 1;

  if found then
    return;
  end if;

  return query select
    'FREEZE_WRITES'::text,
    'ACCOUNT'::text,
    null::uuid,
    'Explicit account-level ALLOW required'::text,
    null::timestamptz;
end;
$$;

comment on function public.get_effective_meta_kill_switch(uuid, uuid, uuid) is
  'Returns the highest-precedence Meta write blocker. Defaults to synthetic account FREEZE_WRITES until an explicit account-level ALLOW event exists.';

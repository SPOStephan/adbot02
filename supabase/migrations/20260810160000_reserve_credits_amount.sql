-- Allow reserving an explicit credit amount at or above the catalog floor.
-- Used for usage-priced AI actions (provider cost × markup → credits).

begin;

create or replace function public.reserve_credits_amount(
  p_user_id uuid,
  p_action_key text,
  p_idempotency_key text,
  p_amount integer,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_ttl_seconds integer default 900
)
returns table (
  reservation_id uuid,
  amount integer,
  balance_after integer,
  already_existed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_floor integer;
  v_cost integer;
  v_balance integer;
  v_existing public.credit_reservations%rowtype;
  v_reservation_id uuid;
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 900), 86400));
begin
  if p_user_id is null
    or p_action_key is null
    or p_idempotency_key is null
    or char_length(p_idempotency_key) < 8
    or p_amount is null
    or p_amount <= 0
    or p_amount > 1000000 then
    raise exception 'Credit reservation request is invalid';
  end if;

  select * into v_existing
  from public.credit_reservations
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    select w.balance into v_balance
    from public.credit_wallets w
    where w.user_id = p_user_id;
    return query select
      v_existing.id,
      v_existing.amount,
      coalesce(v_balance, 0),
      true;
    return;
  end if;

  select c.credit_cost into v_floor
  from public.credit_action_costs c
  where c.action_key = p_action_key
    and c.is_active;

  if v_floor is null then
    raise exception 'Credit action is unknown or inactive';
  end if;

  if v_floor <= 0 then
    raise exception 'Credit action cannot be reserved at zero cost';
  end if;

  v_cost := greatest(v_floor, p_amount);

  insert into public.credit_wallets (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.credit_wallets
  where user_id = p_user_id
  for update;

  if coalesce(v_balance, 0) < v_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_balance := v_balance - v_cost;

  update public.credit_wallets
  set balance = v_balance, updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_reservations (
    user_id, action_key, amount, status, idempotency_key,
    reference_type, reference_id, expires_at
  ) values (
    p_user_id, p_action_key, v_cost, 'PENDING', p_idempotency_key,
    p_reference_type, p_reference_id, now() + make_interval(secs => v_ttl)
  )
  returning id into v_reservation_id;

  insert into public.credit_ledger (
    user_id, entry_type, amount, balance_after, action_key,
    reservation_id, reference_type, reference_id, idempotency_key, metadata
  ) values (
    p_user_id,
    'RESERVE',
    -v_cost,
    v_balance,
    p_action_key,
    v_reservation_id,
    p_reference_type,
    p_reference_id,
    'reserve:' || p_idempotency_key,
    jsonb_build_object(
      'amount_mode', 'usage_floor',
      'requested_amount', p_amount,
      'floor_amount', v_floor
    )
  );

  return query select v_reservation_id, v_cost, v_balance, false;
end;
$$;

revoke all on function public.reserve_credits_amount(
  uuid, text, text, integer, text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.reserve_credits_amount(
  uuid, text, text, integer, text, uuid, integer
) to service_role;

comment on function public.reserve_credits_amount(
  uuid, text, text, integer, text, uuid, integer
) is
  'Reserves max(catalog floor, requested amount) for usage-priced AI actions.';

commit;

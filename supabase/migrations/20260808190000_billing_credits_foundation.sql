-- Billing / credits foundation for subscription tiers.
-- Costs are reserved then committed (or released) so failed Meta/AI work
-- does not silently burn credits. Stripe fields are nullable placeholders.
-- Feature gates are NOT wired into Meta paths yet — call reserve/commit from
-- product code when ready.

begin;

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique
    check (plan_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 80),
  monthly_credits integer not null
    check (monthly_credits >= 0 and monthly_credits <= 100000000),
  -- Max months of unused credits that may carry into the next period (product: 1).
  carryover_max_months integer not null default 1
    check (carryover_max_months >= 0 and carryover_max_months <= 12),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  plan_id uuid not null references public.billing_plans (id) on delete restrict,
  status text not null
    check (status in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text
    check (stripe_customer_id is null or stripe_customer_id ~ '^cus_'),
  stripe_subscription_id text
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create unique index if not exists billing_subscriptions_one_open_per_user_idx
  on public.billing_subscriptions (user_id)
  where status in ('TRIALING', 'ACTIVE', 'PAST_DUE');

create index if not exists billing_subscriptions_plan_idx
  on public.billing_subscriptions (plan_id);

create table if not exists public.credit_wallets (
  user_id uuid primary key references public.users (id) on delete restrict,
  balance integer not null default 0
    check (balance >= 0 and balance <= 100000000),
  period_start timestamptz,
  period_end timestamptz,
  period_granted integer not null default 0
    check (period_granted >= 0),
  carryover_applied integer not null default 0
    check (carryover_applied >= 0),
  updated_at timestamptz not null default now(),
  check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_end > period_start)
  )
);

create table if not exists public.credit_action_costs (
  action_key text primary key
    check (action_key ~ '^[a-z][a-z0-9_.]{1,80}$'),
  credit_cost integer not null
    check (credit_cost >= 0 and credit_cost <= 1000000),
  description text not null
    check (char_length(description) between 1 and 200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  action_key text not null references public.credit_action_costs (action_key),
  amount integer not null check (amount > 0 and amount <= 1000000),
  status text not null
    check (status in ('PENDING', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),
  reference_type text
    check (reference_type is null or reference_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  reference_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (user_id, idempotency_key)
);

create index if not exists credit_reservations_pending_expiry_idx
  on public.credit_reservations (expires_at)
  where status = 'PENDING';

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  entry_type text not null
    check (entry_type in (
      'PERIOD_GRANT',
      'CARRYOVER',
      'TOP_UP',
      'RESERVE',
      'COMMIT',
      'RELEASE',
      'EXPIRE',
      'ADJUST'
    )),
  -- 0 allowed for COMMIT audit rows (debit already applied at RESERVE).
  amount integer not null
    check (amount between -100000000 and 100000000),
  balance_after integer not null
    check (balance_after >= 0),
  action_key text references public.credit_action_costs (action_key),
  reservation_id uuid references public.credit_reservations (id),
  reference_type text
    check (reference_type is null or reference_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  reference_id uuid,
  idempotency_key text not null unique
    check (char_length(idempotency_key) between 8 and 160),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc);

alter table public.billing_plans enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_action_costs enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.credit_ledger enable row level security;

revoke all on table public.billing_plans from public, anon, authenticated;
revoke all on table public.billing_subscriptions from public, anon, authenticated;
revoke all on table public.credit_wallets from public, anon, authenticated;
revoke all on table public.credit_action_costs from public, anon, authenticated;
revoke all on table public.credit_reservations from public, anon, authenticated;
revoke all on table public.credit_ledger from public, anon, authenticated;

grant select on table public.billing_plans to authenticated;
grant select on table public.credit_action_costs to authenticated;
grant select on table public.billing_subscriptions to authenticated;
grant select on table public.credit_wallets to authenticated;
grant select on table public.credit_ledger to authenticated;
grant select on table public.credit_reservations to authenticated;

grant all on table public.billing_plans to service_role;
grant all on table public.billing_subscriptions to service_role;
grant all on table public.credit_wallets to service_role;
grant all on table public.credit_action_costs to service_role;
grant all on table public.credit_reservations to service_role;
grant all on table public.credit_ledger to service_role;

drop policy if exists billing_plans_select_active on public.billing_plans;
create policy billing_plans_select_active
on public.billing_plans
for select
to authenticated
using (is_active = true);

drop policy if exists credit_action_costs_select_active on public.credit_action_costs;
create policy credit_action_costs_select_active
on public.credit_action_costs
for select
to authenticated
using (is_active = true);

drop policy if exists billing_subscriptions_select_own on public.billing_subscriptions;
create policy billing_subscriptions_select_own
on public.billing_subscriptions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists credit_wallets_select_own on public.credit_wallets;
create policy credit_wallets_select_own
on public.credit_wallets
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own
on public.credit_ledger
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists credit_reservations_select_own on public.credit_reservations;
create policy credit_reservations_select_own
on public.credit_reservations
for select
to authenticated
using ((select auth.uid()) = user_id);

insert into public.billing_plans (
  plan_key, display_name, monthly_credits, carryover_max_months, sort_order, metadata
) values
  ('starter', 'Starter', 500, 1, 10, '{"role":"entry"}'::jsonb),
  ('growth', 'Growth', 2000, 1, 20, '{"role":"mid"}'::jsonb),
  ('scale', 'Scale', 8000, 1, 30, '{"role":"high"}'::jsonb)
on conflict (plan_key) do update
set
  display_name = excluded.display_name,
  monthly_credits = excluded.monthly_credits,
  carryover_max_months = excluded.carryover_max_months,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata,
  updated_at = now();

-- Placeholder costs — tune before enforcing gates in product paths.
insert into public.credit_action_costs (action_key, credit_cost, description) values
  ('creative.generate_copy_set', 5, 'KI-Textset (Headlines + Primary Texts)'),
  ('creative.generate_image_master', 20, 'KI-Mastergrafik'),
  ('creative.render_placement', 3, 'Format-Rendering eines Placements'),
  ('creative.inspire_from_upload', 8, 'Inspiration aus Upload analysieren'),
  ('organic_boost.plan_candidate', 2, 'Beitrag-Push Plan für einen Beitrag'),
  ('organic_boost.execute_plan', 10, 'Beitrag-Push Meta-Versand eines Plans'),
  ('campaign.launch_chain', 40, 'Neue Meta-Launch-Kette materialisieren/ausführen'),
  ('credits.top_up_pack', 0, 'Marker für Top-up-Buchungen (Kosten extern)')
on conflict (action_key) do update
set
  credit_cost = excluded.credit_cost,
  description = excluded.description,
  is_active = true,
  updated_at = now();

create or replace function public.get_my_credit_balance()
returns table (
  balance integer,
  period_start timestamptz,
  period_end timestamptz,
  period_granted integer,
  carryover_applied integer,
  plan_key text,
  plan_name text,
  subscription_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  return query
  select
    coalesce(w.balance, 0)::integer,
    w.period_start,
    w.period_end,
    coalesce(w.period_granted, 0)::integer,
    coalesce(w.carryover_applied, 0)::integer,
    p.plan_key,
    p.display_name,
    s.status
  from public.users u
  left join public.credit_wallets w on w.user_id = u.id
  left join public.billing_subscriptions s
    on s.user_id = u.id
   and s.status in ('TRIALING', 'ACTIVE', 'PAST_DUE')
  left join public.billing_plans p on p.id = s.plan_id
  where u.id = v_user;
end;
$$;

revoke all on function public.get_my_credit_balance() from public, anon;
grant execute on function public.get_my_credit_balance() to authenticated, service_role;

create or replace function public.admin_assign_billing_plan(
  p_user_id uuid,
  p_plan_key text,
  p_period_start timestamptz default date_trunc('month', now()),
  p_period_end timestamptz default (date_trunc('month', now()) + interval '1 month')
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.billing_plans%rowtype;
  v_sub_id uuid;
  v_carry integer := 0;
  v_grant integer;
  v_balance integer;
begin
  if p_user_id is null or p_plan_key is null then
    raise exception 'Billing plan assignment scope is invalid';
  end if;

  if p_period_end <= p_period_start then
    raise exception 'Billing period is invalid';
  end if;

  select * into v_plan
  from public.billing_plans
  where plan_key = p_plan_key
    and is_active
  limit 1;

  if v_plan.id is null then
    raise exception 'Billing plan not found';
  end if;

  update public.billing_subscriptions
  set
    status = 'CANCELED',
    cancel_at_period_end = false,
    updated_at = now()
  where user_id = p_user_id
    and status in ('TRIALING', 'ACTIVE', 'PAST_DUE');

  insert into public.billing_subscriptions (
    user_id, plan_id, status, current_period_start, current_period_end
  ) values (
    p_user_id, v_plan.id, 'ACTIVE', p_period_start, p_period_end
  )
  returning id into v_sub_id;

  insert into public.credit_wallets (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.credit_wallets
  where user_id = p_user_id
  for update;

  v_balance := coalesce(v_balance, 0);

  -- Carry at most one prior allotment (≤ monthly_credits); expire the rest.
  if v_plan.carryover_max_months > 0 then
    v_carry := least(v_balance, v_plan.monthly_credits);
  else
    v_carry := 0;
  end if;

  if v_balance > v_carry then
    insert into public.credit_ledger (
      user_id, entry_type, amount, balance_after, idempotency_key, metadata
    ) values (
      p_user_id,
      'EXPIRE',
      -(v_balance - v_carry),
      v_carry,
      'expire-period:' || v_sub_id::text,
      jsonb_build_object('subscription_id', v_sub_id, 'reason', 'period_rollover_cap')
    )
    on conflict (idempotency_key) do nothing;
  end if;

  v_grant := v_plan.monthly_credits;
  v_balance := v_carry + v_grant;

  update public.credit_wallets
  set
    balance = v_balance,
    period_start = p_period_start,
    period_end = p_period_end,
    period_granted = v_grant,
    carryover_applied = v_carry,
    updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_ledger (
    user_id, entry_type, amount, balance_after, idempotency_key, metadata
  ) values (
    p_user_id,
    'PERIOD_GRANT',
    v_grant,
    v_balance,
    'grant:' || v_sub_id::text,
    jsonb_build_object(
      'subscription_id', v_sub_id,
      'plan_key', v_plan.plan_key,
      'carryover_applied', v_carry
    )
  )
  on conflict (idempotency_key) do nothing;

  return v_sub_id;
end;
$$;

revoke all on function public.admin_assign_billing_plan(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_assign_billing_plan(uuid, text, timestamptz, timestamptz)
  to service_role;

create or replace function public.top_up_credits(
  p_user_id uuid,
  p_credits integer,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if p_user_id is null
    or p_credits is null
    or p_credits < 1
    or p_credits > 100000000
    or p_idempotency_key is null
    or char_length(p_idempotency_key) < 8 then
    raise exception 'Credit top-up request is invalid';
  end if;

  if exists (
    select 1 from public.credit_ledger where idempotency_key = p_idempotency_key
  ) then
    select balance into v_balance
    from public.credit_wallets
    where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  insert into public.credit_wallets (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.credit_wallets
  where user_id = p_user_id
  for update;

  v_balance := coalesce(v_balance, 0) + p_credits;

  update public.credit_wallets
  set balance = v_balance, updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_ledger (
    user_id, entry_type, amount, balance_after, action_key,
    idempotency_key, metadata
  ) values (
    p_user_id,
    'TOP_UP',
    p_credits,
    v_balance,
    'credits.top_up_pack',
    p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return v_balance;
end;
$$;

revoke all on function public.top_up_credits(uuid, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.top_up_credits(uuid, integer, text, jsonb)
  to service_role;

create or replace function public.reserve_credits(
  p_user_id uuid,
  p_action_key text,
  p_idempotency_key text,
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
  v_cost integer;
  v_balance integer;
  v_existing public.credit_reservations%rowtype;
  v_reservation_id uuid;
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 900), 86400));
begin
  if p_user_id is null
    or p_action_key is null
    or p_idempotency_key is null
    or char_length(p_idempotency_key) < 8 then
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

  select c.credit_cost into v_cost
  from public.credit_action_costs c
  where c.action_key = p_action_key
    and c.is_active;

  if v_cost is null then
    raise exception 'Credit action is unknown or inactive';
  end if;

  if v_cost = 0 then
    raise exception 'Credit action cannot be reserved at zero cost';
  end if;

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
    reservation_id, reference_type, reference_id, idempotency_key
  ) values (
    p_user_id,
    'RESERVE',
    -v_cost,
    v_balance,
    p_action_key,
    v_reservation_id,
    p_reference_type,
    p_reference_id,
    'reserve:' || p_idempotency_key
  );

  return query select v_reservation_id, v_cost, v_balance, false;
end;
$$;

revoke all on function public.reserve_credits(uuid, text, text, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, text, text, text, uuid, integer)
  to service_role;

create or replace function public.commit_credit_reservation(
  p_user_id uuid,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.credit_reservations%rowtype;
  v_balance integer;
begin
  select * into v_res
  from public.credit_reservations
  where id = p_reservation_id
    and user_id = p_user_id
  for update;

  if v_res.id is null then
    raise exception 'Credit reservation not found';
  end if;

  if v_res.status = 'COMMITTED' then
    return false;
  end if;

  if v_res.status <> 'PENDING' then
    raise exception 'Credit reservation is not pending';
  end if;

  update public.credit_reservations
  set status = 'COMMITTED', finalized_at = now()
  where id = v_res.id;

  select balance into v_balance
  from public.credit_wallets
  where user_id = p_user_id;

  -- Amount already deducted at RESERVE; COMMIT is a zero-impact audit marker.
  insert into public.credit_ledger (
    user_id, entry_type, amount, balance_after, action_key,
    reservation_id, reference_type, reference_id, idempotency_key, metadata
  ) values (
    p_user_id,
    'COMMIT',
    0,
    coalesce(v_balance, 0),
    v_res.action_key,
    v_res.id,
    v_res.reference_type,
    v_res.reference_id,
    'commit:' || v_res.id::text,
    jsonb_build_object('reserved_amount', v_res.amount)
  )
  on conflict (idempotency_key) do nothing;

  return true;
end;
$$;

revoke all on function public.commit_credit_reservation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_credit_reservation(uuid, uuid)
  to service_role;

create or replace function public.release_credit_reservation(
  p_user_id uuid,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.credit_reservations%rowtype;
  v_balance integer;
begin
  select * into v_res
  from public.credit_reservations
  where id = p_reservation_id
    and user_id = p_user_id
  for update;

  if v_res.id is null then
    raise exception 'Credit reservation not found';
  end if;

  if v_res.status = 'RELEASED' or v_res.status = 'EXPIRED' then
    return false;
  end if;

  if v_res.status = 'COMMITTED' then
    raise exception 'Committed credit reservation cannot be released';
  end if;

  if v_res.status <> 'PENDING' then
    raise exception 'Credit reservation is not pending';
  end if;

  select balance into v_balance
  from public.credit_wallets
  where user_id = p_user_id
  for update;

  v_balance := coalesce(v_balance, 0) + v_res.amount;

  update public.credit_wallets
  set balance = v_balance, updated_at = now()
  where user_id = p_user_id;

  update public.credit_reservations
  set status = 'RELEASED', finalized_at = now()
  where id = v_res.id;

  insert into public.credit_ledger (
    user_id, entry_type, amount, balance_after, action_key,
    reservation_id, reference_type, reference_id, idempotency_key
  ) values (
    p_user_id,
    'RELEASE',
    v_res.amount,
    v_balance,
    v_res.action_key,
    v_res.id,
    v_res.reference_type,
    v_res.reference_id,
    'release:' || v_res.id::text
  )
  on conflict (idempotency_key) do nothing;

  return true;
end;
$$;

revoke all on function public.release_credit_reservation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_credit_reservation(uuid, uuid)
  to service_role;

create or replace function public.expire_stale_credit_reservations(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
  v_balance integer;
begin
  for r in
    select id, user_id, amount, action_key, reference_type, reference_id
    from public.credit_reservations
    where status = 'PENDING'
      and expires_at <= now()
    order by expires_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    select balance into v_balance
    from public.credit_wallets
    where user_id = r.user_id
    for update;

    v_balance := coalesce(v_balance, 0) + r.amount;

    update public.credit_wallets
    set balance = v_balance, updated_at = now()
    where user_id = r.user_id;

    update public.credit_reservations
    set status = 'EXPIRED', finalized_at = now()
    where id = r.id;

    insert into public.credit_ledger (
      user_id, entry_type, amount, balance_after, action_key,
      reservation_id, reference_type, reference_id, idempotency_key
    ) values (
      r.user_id,
      'EXPIRE',
      r.amount,
      v_balance,
      r.action_key,
      r.id,
      r.reference_type,
      r.reference_id,
      'expire:' || r.id::text
    )
    on conflict (idempotency_key) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_credit_reservations(integer)
  from public, anon, authenticated;
grant execute on function public.expire_stale_credit_reservations(integer)
  to service_role;

comment on table public.billing_plans is
  'Subscription tiers and monthly credit allotments (carryover max months configurable).';
comment on table public.credit_wallets is
  'Per-user spendable credit balance for the current billing period.';
comment on table public.credit_ledger is
  'Append-only credit movements; RESERVE deducts, RELEASE/EXPIRE refund, COMMIT audits.';
comment on table public.credit_action_costs is
  'Catalog of billable product actions and their credit prices.';

commit;

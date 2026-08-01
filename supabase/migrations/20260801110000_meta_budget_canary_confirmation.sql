-- Operator-confirmed budget canary gate.
-- Non-safety budget plans are held outside the executor until the customer
-- confirms the exact immutable plan fingerprint and before/after amounts.

create table public.meta_account_write_modes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  mode text not null default 'CONFIRM_EACH_BUDGET'
    check (mode in ('CONFIRM_EACH_BUDGET', 'AUTONOMOUS')),
  customer_confirmed_at timestamptz,
  customer_confirmed_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_account_write_modes_account_key
    unique (platform_account_id),
  constraint meta_account_write_modes_confirmation_check
    check (
      mode <> 'AUTONOMOUS'
      or (customer_confirmed_at is not null and customer_confirmed_by = user_id)
    )
);

create table public.meta_budget_canary_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  payload_hash text not null,
  expected_before_minor bigint not null check (expected_before_minor > 0),
  intended_after_minor bigint not null check (intended_after_minor > 0),
  reason text not null check (char_length(reason) between 12 and 500),
  approved_by uuid not null references public.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint meta_budget_canary_approvals_plan_key unique (plan_id),
  constraint meta_budget_canary_approvals_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint meta_budget_canary_approvals_actor_check
    check (approved_by = user_id)
);

create index meta_budget_canary_approvals_account_time_idx
  on public.meta_budget_canary_approvals (
    platform_account_id, approved_at desc
  );

create trigger guard_meta_account_write_modes_tenant_scope
  before insert or update on public.meta_account_write_modes
  for each row execute function public.guard_meta_control_tenant_scope();

create trigger guard_meta_budget_canary_approvals_tenant_scope
  before insert or update on public.meta_budget_canary_approvals
  for each row execute function public.guard_meta_control_tenant_scope();

create trigger guard_meta_budget_canary_approvals_append_only
  before update or delete on public.meta_budget_canary_approvals
  for each row execute function public.guard_meta_append_only();

create or replace function public.hold_meta_budget_plan_for_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  if new.action_type <> 'UPDATE_BUDGET' or new.safety_action then
    return new;
  end if;

  select mwm.mode into v_mode
  from public.meta_account_write_modes mwm
  where mwm.user_id = new.user_id
    and mwm.platform_account_id = new.platform_account_id;

  if coalesce(v_mode, 'CONFIRM_EACH_BUDGET') = 'CONFIRM_EACH_BUDGET' then
    new.not_before := 'infinity'::timestamptz;
  end if;

  return new;
end;
$$;

create or replace function public.freeze_meta_budget_plan_for_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  if new.action_type <> 'UPDATE_BUDGET' or new.safety_action then
    return new;
  end if;

  select mwm.mode into v_mode
  from public.meta_account_write_modes mwm
  where mwm.user_id = new.user_id
    and mwm.platform_account_id = new.platform_account_id;

  if coalesce(v_mode, 'CONFIRM_EACH_BUDGET') = 'CONFIRM_EACH_BUDGET' then
    perform public.append_meta_kill_switch_state(
      'PLAN',
      new.user_id,
      new.platform_account_id,
      new.id,
      'FREEZE_WRITES',
      'Budget-Canary wartet auf exakte Kundenbestätigung',
      'SYSTEM',
      'meta-budget-canary-gate'
    );

    perform public.append_meta_mutation_audit_event(
      new.user_id,
      new.platform_account_id,
      new.policy_id,
      new.id,
      null,
      null,
      'SYSTEM',
      'meta-budget-canary-gate',
      'BUDGET_CANARY_CONFIRMATION_REQUIRED',
      '{}'::jsonb,
      jsonb_build_object(
        'payload_hash', new.payload_hash,
        'not_before', 'infinity'
      ),
      '{}'::jsonb,
      jsonb_build_object('plan_status', new.status),
      jsonb_build_object(
        'current_budget_minor', new.expected_before ->> 'daily_budget_minor',
        'intended_budget_minor', new.intended_after ->> 'daily_budget_minor'
      ),
      null, null, null, null, null, now()
    );
  end if;

  return new;
end;
$$;

create trigger hold_meta_budget_plan_for_confirmation
  before insert on public.mutation_plans
  for each row execute function public.hold_meta_budget_plan_for_confirmation();

create trigger freeze_meta_budget_plan_for_confirmation
  after insert on public.mutation_plans
  for each row execute function public.freeze_meta_budget_plan_for_confirmation();

-- Freeze any undispatched budget intent that predates this migration. Existing
-- execution history is never rewritten because its remote outcome may be unknown.
do $$
declare
  v_plan public.mutation_plans%rowtype;
begin
  for v_plan in
    update public.mutation_plans mp
    set not_before = 'infinity'::timestamptz, updated_at = now()
    where mp.action_type = 'UPDATE_BUDGET'
      and not mp.safety_action
      and mp.status = 'PENDING'
      and mp.attempt_count = 0
      and not exists (
        select 1 from public.mutation_executions me where me.plan_id = mp.id
      )
      and coalesce((
        select mwm.mode
        from public.meta_account_write_modes mwm
        where mwm.user_id = mp.user_id
          and mwm.platform_account_id = mp.platform_account_id
      ), 'CONFIRM_EACH_BUDGET') = 'CONFIRM_EACH_BUDGET'
    returning mp.*
  loop
    if not exists (
      select 1
      from public.kill_switch_state kss
      where kss.scope_type = 'PLAN'
        and kss.plan_id = v_plan.id
        and kss.mode = 'FREEZE_WRITES'
        and kss.actor_id = 'meta-budget-canary-gate'
    ) then
      perform public.append_meta_kill_switch_state(
        'PLAN',
        v_plan.user_id,
        v_plan.platform_account_id,
        v_plan.id,
        'FREEZE_WRITES',
        'Budget-Canary wartet auf exakte Kundenbestätigung',
        'SYSTEM',
        'meta-budget-canary-gate'
      );
    end if;
  end loop;
end;
$$;

create or replace function public.list_meta_budget_canary_plans(
  p_platform_account_id uuid
)
returns table (
  plan_id uuid,
  campaign_id uuid,
  campaign_name text,
  budget_owner_label text,
  target_type text,
  current_budget_minor bigint,
  intended_budget_minor bigint,
  currency text,
  change_bps integer,
  direction text,
  source_rule_key text,
  plan_status text,
  payload_hash text,
  source_marketing_sync_id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  is_expired boolean,
  fresh_sync boolean,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = v_user_id
      and pa.platform = 'meta'
  ) then
    raise exception 'Budget canary account is invalid';
  end if;

  return query
  select
    mp.id,
    at.campaign_id,
    coalesce(c.name, 'Meta-Kampagne'),
    case
      when mp.target_type = 'CAMPAIGN' then 'Kampagnenbudget'
      when mp.target_type = 'AD_SET' then 'Anzeigengruppenbudget'
      else 'Budgetowner'
    end,
    mp.target_type,
    (mp.expected_before ->> 'daily_budget_minor')::bigint,
    (mp.intended_after ->> 'daily_budget_minor')::bigint,
    ap.currency,
    coalesce((mp.planned_payload ->> 'change_bps')::integer, 0),
    coalesce(mp.planned_payload ->> 'direction', 'UNKNOWN'),
    coalesce(mp.source_rule_key, 'unknown'),
    mp.status,
    mp.payload_hash,
    mp.source_marketing_sync_id,
    mp.created_at,
    mp.created_at + interval '2 hours',
    mp.created_at + interval '2 hours' <= now(),
    pa.marketing_sync_status = 'success'
      and pa.marketing_sync_id = mp.source_marketing_sync_id
      and pa.marketing_last_success_at >= now() - interval '2 hours'
      and pa.marketing_last_success_at <= now() + interval '1 minute',
    approval.approved_at
  from public.mutation_plans mp
  join public.platform_accounts pa
    on pa.id = mp.platform_account_id
   and pa.user_id = mp.user_id
   and pa.platform = 'meta'
  join public.automation_policies ap
    on ap.id = mp.policy_id
   and ap.user_id = mp.user_id
   and ap.platform_account_id = mp.platform_account_id
  join public.automation_targets at
    on at.id = mp.automation_target_id
   and at.user_id = mp.user_id
   and at.platform_account_id = mp.platform_account_id
  left join public.campaigns c
    on c.id = at.campaign_id
   and c.user_id = mp.user_id
   and c.platform_account_id = mp.platform_account_id
  left join public.meta_budget_canary_approvals approval
    on approval.plan_id = mp.id
   and approval.user_id = mp.user_id
   and approval.platform_account_id = mp.platform_account_id
  where mp.user_id = v_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.action_type = 'UPDATE_BUDGET'
    and not mp.safety_action
    and mp.created_at >= now() - interval '7 days'
  order by mp.created_at desc
  limit 20;
end;
$$;

create or replace function public.approve_meta_budget_canary_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid,
  p_expected_payload_hash text,
  p_expected_before_minor bigint,
  p_intended_after_minor bigint,
  p_reason text
)
returns table (
  approval_id uuid,
  plan_id uuid,
  plan_status text,
  executable_at timestamptz,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_policy public.automation_policies%rowtype;
  v_account public.platform_accounts%rowtype;
  v_target public.automation_targets%rowtype;
  v_existing public.meta_budget_canary_approvals%rowtype;
  v_approval_id uuid := gen_random_uuid();
  v_approved_at timestamptz := now();
  v_kill_mode text;
  v_managed_budget_owner_count integer;
  v_current_budget bigint;
  v_intended_budget bigint;
begin
  if p_expected_payload_hash !~ '^[0-9a-f]{64}$'
    or p_expected_before_minor <= 0
    or p_intended_after_minor <= 0
    or nullif(trim(p_reason), '') is null
    or char_length(trim(p_reason)) not between 12 and 500 then
    raise exception 'Invalid budget canary confirmation';
  end if;

  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = p_plan_id
    and mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.action_type = 'UPDATE_BUDGET'
    and not mp.safety_action
  for update;

  if not found then
    raise exception 'Budget canary plan is invalid';
  end if;

  select approval.* into v_existing
  from public.meta_budget_canary_approvals approval
  where approval.plan_id = v_plan.id;

  if found then
    if v_existing.payload_hash <> p_expected_payload_hash
      or v_existing.expected_before_minor <> p_expected_before_minor
      or v_existing.intended_after_minor <> p_intended_after_minor then
      raise exception 'Budget canary confirmation fingerprint mismatch';
    end if;

    return query select
      v_existing.id,
      v_plan.id,
      v_plan.status,
      v_plan.not_before,
      v_existing.approved_at;
    return;
  end if;

  if v_plan.status <> 'PENDING'
    or v_plan.attempt_count <> 0
    or v_plan.not_before <> 'infinity'::timestamptz then
    raise exception 'Budget canary plan is not awaiting confirmation';
  end if;

  v_current_budget := (v_plan.expected_before ->> 'daily_budget_minor')::bigint;
  v_intended_budget := (v_plan.intended_after ->> 'daily_budget_minor')::bigint;

  if v_plan.payload_hash <> p_expected_payload_hash
    or v_current_budget <> p_expected_before_minor
    or v_intended_budget <> p_intended_after_minor
    or (v_plan.planned_payload ->> 'amount_minor')::bigint <> p_intended_after_minor then
    raise exception 'Budget canary confirmation fingerprint mismatch';
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
    and pa.marketing_currency = 'EUR'
    and pa.marketing_sync_id = v_plan.source_marketing_sync_id
    and pa.marketing_sync_status = 'success'
    and pa.marketing_last_success_at is not null
    and 'ads_management' = any(pa.meta_scopes)
  for share;

  if not found then
    raise exception 'Fresh write-ready EUR Meta account is required';
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = v_plan.policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
    and ap.currency = 'EUR'
    and ap.allow_budget_changes
    and not ap.allow_status_changes
    and not ap.allow_new_launches
  for share;

  if not found then
    raise exception 'Budget-only canary policy is required';
  end if;

  select at.* into v_target
  from public.automation_targets at
  where at.id = v_plan.automation_target_id
    and at.user_id = p_user_id
    and at.platform_account_id = p_platform_account_id
    and at.status = 'MANAGED'
    and at.budget_owner_key is not null
  for share;

  if not found
    or v_target.target_type <> v_plan.target_type
    or v_target.target_key <> v_plan.target_key then
    raise exception 'Managed canary budget owner is required';
  end if;

  select count(*)::integer into v_managed_budget_owner_count
  from public.automation_targets at
  where at.user_id = p_user_id
    and at.platform_account_id = p_platform_account_id
    and at.status = 'MANAGED'
    and at.budget_owner_key is not null;

  if v_managed_budget_owner_count <> 1 then
    raise exception 'Exactly one managed budget owner is required for the canary';
  end if;

  if exists (
    select 1
    from public.mutation_plans other
    where other.user_id = p_user_id
      and other.platform_account_id = p_platform_account_id
      and other.id <> v_plan.id
      and not other.safety_action
      and other.status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING')
      and other.not_before <= now()
  ) then
    raise exception 'Another non-safety Meta mutation is executable';
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'ALLOW' then
    raise exception 'Account writes must be explicitly allowed for the canary';
  end if;

  insert into public.meta_budget_canary_approvals (
    id, user_id, platform_account_id, plan_id, payload_hash,
    expected_before_minor, intended_after_minor, reason,
    approved_by, approved_at
  ) values (
    v_approval_id, p_user_id, p_platform_account_id, v_plan.id,
    p_expected_payload_hash, p_expected_before_minor, p_intended_after_minor,
    trim(p_reason), p_user_id, v_approved_at
  );

  perform public.append_meta_kill_switch_state(
    'PLAN',
    p_user_id,
    p_platform_account_id,
    v_plan.id,
    'ALLOW',
    'Exakter Budget-Canary kundenseitig bestätigt',
    'CUSTOMER',
    p_user_id::text
  );

  update public.mutation_plans
  set not_before = v_approved_at, updated_at = v_approved_at
  where id = v_plan.id;

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    v_plan.policy_id,
    v_plan.id,
    null,
    null,
    'CUSTOMER',
    p_user_id::text,
    'BUDGET_CANARY_PLAN_APPROVED',
    jsonb_build_object('not_before', 'infinity'),
    jsonb_build_object(
      'payload_hash', p_expected_payload_hash,
      'expected_before_minor', p_expected_before_minor,
      'intended_after_minor', p_intended_after_minor,
      'reason', trim(p_reason)
    ),
    '{}'::jsonb,
    jsonb_build_object('not_before', v_approved_at),
    jsonb_build_object('approval_id', v_approval_id),
    null, null, null, null, null, v_approved_at
  );

  return query select
    v_approval_id,
    v_plan.id,
    'PENDING'::text,
    v_approved_at,
    v_approved_at;
end;
$$;

alter table public.meta_account_write_modes enable row level security;
alter table public.meta_budget_canary_approvals enable row level security;

create policy meta_account_write_modes_select_own
  on public.meta_account_write_modes
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy meta_budget_canary_approvals_select_own
  on public.meta_budget_canary_approvals
  for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on table public.meta_account_write_modes to authenticated;
grant select on table public.meta_budget_canary_approvals to authenticated;

revoke all on function public.hold_meta_budget_plan_for_confirmation()
  from public, anon, authenticated, service_role;
revoke all on function public.freeze_meta_budget_plan_for_confirmation()
  from public, anon, authenticated, service_role;
revoke all on function public.list_meta_budget_canary_plans(uuid)
  from public, anon, service_role;
revoke all on function public.approve_meta_budget_canary_plan(
  uuid, uuid, uuid, text, bigint, bigint, text
) from public, anon, authenticated;

grant execute on function public.list_meta_budget_canary_plans(uuid)
  to authenticated;
grant execute on function public.approve_meta_budget_canary_plan(
  uuid, uuid, uuid, text, bigint, bigint, text
) to service_role;

comment on table public.meta_account_write_modes is
  'Per-account write rollout mode. Missing rows fail closed to per-budget-plan confirmation.';
comment on table public.meta_budget_canary_approvals is
  'Append-only customer approvals bound to an immutable budget plan hash and exact before/after amounts.';
comment on function public.approve_meta_budget_canary_plan(
  uuid, uuid, uuid, text, bigint, bigint, text
) is
  'Atomically verifies a single managed budget owner, current EUR snapshot, budget-only policy, account ALLOW and exact plan fingerprint before making one budget plan executable.';

-- Make a customer-confirmed active budget policy the default management scope.
-- Explicit campaign/target suspensions still win, and the kill switch remains a
-- separate runtime gate. Policy activation and gate synchronization are exposed
-- through one service-role-only transaction.

create or replace function public.resolve_meta_automation_scope_status(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_automation_target_id uuid,
  p_campaign_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.automation_scope_selections selection
      where selection.user_id = p_user_id
        and selection.platform_account_id = p_platform_account_id
        and selection.selection_type = 'CAMPAIGN'
        and selection.campaign_id = p_campaign_id
        and selection.status = 'SUSPENDED'
    ) then 'SUSPENDED'
    when exists (
      select 1
      from public.automation_scope_selections selection
      where selection.user_id = p_user_id
        and selection.platform_account_id = p_platform_account_id
        and selection.selection_type = 'TARGET'
        and selection.automation_target_id = p_automation_target_id
        and selection.status = 'SUSPENDED'
    ) then 'SUSPENDED'
    when exists (
      select 1
      from public.automation_policies policy
      join public.platform_accounts account
        on account.id = policy.platform_account_id
       and account.user_id = policy.user_id
      where policy.user_id = p_user_id
        and policy.platform_account_id = p_platform_account_id
        and policy.is_current
        and policy.status = 'ACTIVE'
        and policy.currency = 'EUR'
        and policy.allow_budget_changes
        and account.platform = 'meta'
        and account.revoked_at is null
        and account.marketing_currency = 'EUR'
        and 'ads_management' = any(account.meta_scopes)
    ) then 'MANAGED'
    else 'SUSPENDED'
  end;
$$;

create or replace function public.set_meta_customer_budget_autonomy(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_enable boolean
)
returns table (
  kill_switch_event_id uuid,
  affected_target_count bigint,
  managed_budget_owner_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest_mode text;
  v_kill_switch_event_id uuid;
  v_affected_target_count bigint := 0;
  v_managed_budget_owner_count bigint := 0;
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_enable is null then
    raise exception 'Customer budget autonomy input is incomplete';
  end if;

  if not exists (
    select 1
    from public.platform_accounts account
    where account.id = p_platform_account_id
      and account.user_id = p_user_id
      and account.platform = 'meta'
      and account.revoked_at is null
      and account.marketing_currency = 'EUR'
      and 'ads_management' = any(account.meta_scopes)
  ) then
    raise exception 'Customer budget autonomy requires EUR and ads_management';
  end if;

  if p_enable and not exists (
    select 1
    from public.automation_policies policy
    where policy.user_id = p_user_id
      and policy.platform_account_id = p_platform_account_id
      and policy.is_current
      and policy.status = 'ACTIVE'
      and policy.currency = 'EUR'
      and policy.allow_budget_changes
      and policy.budget_change_limit_bps = 2000
      and policy.cooldown_seconds = 43200
  ) then
    raise exception 'Customer budget autonomy requires an active bounded policy';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'customer-budget-autonomy:' || p_platform_account_id::text,
      0
    )
  );

  select state.mode
  into v_latest_mode
  from public.kill_switch_state state
  where state.scope_type = 'ACCOUNT'
    and state.user_id = p_user_id
    and state.platform_account_id = p_platform_account_id
  order by state.sequence desc
  limit 1;

  if p_enable and v_latest_mode is distinct from 'ALLOW' then
    v_kill_switch_event_id := public.append_meta_kill_switch_state(
      'ACCOUNT',
      p_user_id,
      p_platform_account_id,
      null,
      'ALLOW',
      'Customer activated bounded autonomous budget management',
      'CUSTOMER',
      p_user_id::text
    );
  elsif not p_enable and v_latest_mode is distinct from 'FREEZE_WRITES' then
    v_kill_switch_event_id := public.append_meta_kill_switch_state(
      'ACCOUNT',
      p_user_id,
      p_platform_account_id,
      null,
      'FREEZE_WRITES',
      'Customer disabled autonomous budget management',
      'CUSTOMER',
      p_user_id::text
    );
  end if;

  update public.automation_targets target
  set
    status = public.resolve_meta_automation_scope_status(
      target.user_id,
      target.platform_account_id,
      target.id,
      target.campaign_id
    ),
    row_version = target.row_version + 1,
    updated_at = now()
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.status <> 'RETIRED'
    and target.status is distinct from public.resolve_meta_automation_scope_status(
      target.user_id,
      target.platform_account_id,
      target.id,
      target.campaign_id
    );

  get diagnostics v_affected_target_count = row_count;

  select count(*)
  into v_managed_budget_owner_count
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.status = 'MANAGED'
    and target.budget_owner_key is not null;

  return query select
    v_kill_switch_event_id,
    v_affected_target_count,
    v_managed_budget_owner_count;
end;
$$;

create or replace function public.put_meta_customer_budget_autonomy_policy(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_account_daily_hard_cap_minor bigint,
  p_default_campaign_daily_hard_cap_minor bigint,
  p_allow_budget_changes boolean,
  p_allow_status_changes boolean,
  p_allow_new_launches boolean,
  p_enable_automation boolean
)
returns table (
  policy_id uuid,
  kill_switch_event_id uuid,
  affected_target_count bigint,
  managed_budget_owner_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy_id uuid;
begin
  v_policy_id := public.put_meta_customer_policy_version(
    p_user_id,
    p_platform_account_id,
    p_account_daily_hard_cap_minor,
    p_default_campaign_daily_hard_cap_minor,
    p_allow_budget_changes,
    p_allow_status_changes,
    p_allow_new_launches,
    p_enable_automation
  );

  return query
  select
    v_policy_id,
    autonomy.kill_switch_event_id,
    autonomy.affected_target_count,
    autonomy.managed_budget_owner_count
  from public.set_meta_customer_budget_autonomy(
    p_user_id,
    p_platform_account_id,
    p_enable_automation and p_allow_budget_changes
  ) autonomy;
end;
$$;

comment on function public.resolve_meta_automation_scope_status(uuid, uuid, uuid, uuid) is
  'Resolves customer budget scope: explicit suspensions win; otherwise an active bounded customer policy manages all current and future budget owners.';
comment on function public.set_meta_customer_budget_autonomy(uuid, uuid, boolean) is
  'Synchronizes account ALLOW/FREEZE_WRITES and all current target statuses with the customer-confirmed bounded budget policy.';
comment on function public.put_meta_customer_budget_autonomy_policy(uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean) is
  'Atomically versions the customer policy and activates or disables bounded autonomous budget management.';

revoke all on function public.set_meta_customer_budget_autonomy(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.put_meta_customer_budget_autonomy_policy(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.set_meta_customer_budget_autonomy(uuid, uuid, boolean)
  to service_role;
grant execute on function public.put_meta_customer_budget_autonomy_policy(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) to service_role;

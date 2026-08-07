-- Customer workflow: saving Autonomie with launches must not require a second
-- Freigeben click, and must never revoke an existing Freigeben via FREEZE.

begin;

-- Hard-replace (no fragile regexp): never auto-FREEZE from budget autonomy.
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

  -- Elevate to ALLOW when enabling budget autonomy. Never auto-FREEZE:
  -- Freigeben / Sicherheitsschranke is the only write gate customers toggle.
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

comment on function public.set_meta_customer_budget_autonomy(uuid, uuid, boolean) is
  'Syncs managed targets with bounded budget policy. Elevates to ALLOW when enabling; never auto-FREEZE_WRITES.';

-- When Autonomie enables launches, ensure ACCOUNT ALLOW in the same transaction
-- so Beitrag-Push does not need a second Freigeben click.
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
  v_kill_switch_event_id uuid;
  v_affected_target_count bigint;
  v_managed_budget_owner_count bigint;
  v_latest_mode text;
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

  select
    autonomy.kill_switch_event_id,
    autonomy.affected_target_count,
    autonomy.managed_budget_owner_count
  into
    v_kill_switch_event_id,
    v_affected_target_count,
    v_managed_budget_owner_count
  from public.set_meta_customer_budget_autonomy(
    p_user_id,
    p_platform_account_id,
    p_enable_automation and p_allow_budget_changes
  ) autonomy;

  -- Launches (Beitrag-Push) need ALLOW even when budget-changes are off.
  if p_enable_automation
    and p_allow_new_launches
    and exists (
      select 1
      from public.platform_accounts pa
      where pa.id = p_platform_account_id
        and pa.user_id = p_user_id
        and pa.platform = 'meta'
        and pa.revoked_at is null
        and 'ads_management' = any(pa.meta_scopes)
    ) then
    select state.mode
    into v_latest_mode
    from public.kill_switch_state state
    where state.scope_type = 'ACCOUNT'
      and state.user_id = p_user_id
      and state.platform_account_id = p_platform_account_id
    order by state.sequence desc
    limit 1;

    if v_latest_mode is distinct from 'ALLOW' then
      v_kill_switch_event_id := public.append_meta_kill_switch_state(
        'ACCOUNT',
        p_user_id,
        p_platform_account_id,
        null,
        'ALLOW',
        'Autonomie mit Launches aktiv — Meta-Schreiben freigegeben',
        'CUSTOMER',
        p_user_id::text
      );
    end if;

    perform public.revive_meta_organic_boost_superseded_plans(
      p_user_id,
      p_platform_account_id
    );
  end if;

  return query select
    v_policy_id,
    v_kill_switch_event_id,
    v_affected_target_count,
    v_managed_budget_owner_count;
end;
$$;

comment on function public.put_meta_customer_budget_autonomy_policy(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) is
  'Versions customer policy, syncs budget autonomy, ensures ALLOW for launches, revives organic boost plans.';

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

commit;

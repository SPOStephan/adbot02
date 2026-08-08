-- Policy save must not roll back when organic-boost revive fails.
-- Customers need to raise hard caps even while older boost plans are messy.

begin;

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

    begin
      perform public.revive_meta_organic_boost_superseded_plans(
        p_user_id,
        p_platform_account_id
      );
    exception
      when others then
        -- Soft-fail: hard-cap / policy changes must still persist.
        null;
    end;
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
  'Versions customer policy, syncs budget autonomy, ensures ALLOW for launches; revive is best-effort.';

revoke all on function public.put_meta_customer_budget_autonomy_policy(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.put_meta_customer_budget_autonomy_policy(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) to service_role;

commit;

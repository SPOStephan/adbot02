\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values
  ('13000000-0000-4000-8000-000000000001', 'scope-owner@example.test'),
  ('13000000-0000-4000-8000-000000000002', 'scope-other@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_name, access_token,
  ad_account_ids, meta_scopes, marketing_meta_ad_account_id,
  marketing_currency, marketing_timezone_name, marketing_sync_status,
  marketing_sync_id, marketing_last_success_at, marketing_campaign_count,
  marketing_ad_set_count, marketing_ad_count, marketing_creative_count,
  marketing_insight_count, marketing_recommendation_count,
  marketing_insights_since, marketing_insights_until
) values
  (
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    'meta', 'scope-owner', 'Scope Owner Meta', null,
    '["act_333333333333"]'::jsonb,
    array['ads_read','ads_management']::text[],
    '333333333333', 'EUR', 'Europe/Berlin', 'success',
    '33000000-0000-4000-8000-000000000001', now(),
    1, 0, 1, 0, 0, 0, current_date - 13, current_date
  ),
  (
    '23000000-0000-4000-8000-000000000002',
    '13000000-0000-4000-8000-000000000002',
    'meta', 'scope-other', 'Scope Other Meta', null,
    '["act_444444444444"]'::jsonb,
    array['ads_read','ads_management']::text[],
    '444444444444', 'EUR', 'Europe/Berlin', 'success',
    '33000000-0000-4000-8000-000000000002', now(),
    1, 0, 0, 0, 0, 0, current_date - 13, current_date
  );

insert into public.campaigns (
  id, user_id, platform_account_id, platform_campaign_id, name, status,
  effective_status, objective, daily_budget_minor, last_seen_sync_id,
  last_seen_at, is_current
) values
  (
    '43000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    '333333333333', 'Scope Owner Campaign', 'ACTIVE', 'ACTIVE',
    'OUTCOME_SALES', 2000,
    '33000000-0000-4000-8000-000000000001', now(), true
  ),
  (
    '43000000-0000-4000-8000-000000000002',
    '13000000-0000-4000-8000-000000000002',
    '23000000-0000-4000-8000-000000000002',
    '444444444444', 'Scope Other Campaign', 'ACTIVE', 'ACTIVE',
    'OUTCOME_TRAFFIC', 2000,
    '33000000-0000-4000-8000-000000000002', now(), true
  );

insert into public.automation_policies (
  id, user_id, platform_account_id, version, status, currency,
  account_daily_hard_cap_minor, default_campaign_daily_hard_cap_minor,
  budget_change_limit_bps, cooldown_seconds,
  standard_flex_spend_multiplier_bps,
  shared_budget_flex_spend_multiplier_bps,
  allow_budget_changes, allow_status_changes, allow_new_launches,
  require_verified_domain, policy_payload, policy_hash, is_current,
  customer_confirmed_at, customer_confirmed_by, activated_at
) values
  (
    '83000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    1, 'ACTIVE', 'EUR', 10000, 5000, 2000, 43200, 17500, 21000,
    true, false, false, true,
    '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
    repeat('c', 64), true, now(),
    '13000000-0000-4000-8000-000000000001', now()
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '13000000-0000-4000-8000-000000000002',
    '23000000-0000-4000-8000-000000000002',
    1, 'ACTIVE', 'EUR', 10000, 5000, 2000, 43200, 17500, 21000,
    true, false, false, true,
    '{"campaign_objectives":"ALL","regions":"ALL","domains":"ALL"}'::jsonb,
    repeat('d', 64), true, now(),
    '13000000-0000-4000-8000-000000000002', now()
  );

insert into public.automation_targets (
  id, user_id, platform_account_id, target_type, target_key,
  platform_object_id, campaign_scope_key, budget_owner_type,
  budget_owner_key, campaign_id, status, last_reconciled_at
) values
  (
    '53000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'CAMPAIGN', 'campaign:333333333333', '333333333333',
    'campaign:333333333333', 'CAMPAIGN', 'campaign:333333333333',
    '43000000-0000-4000-8000-000000000001', 'MANAGED', now()
  ),
  (
    '53000000-0000-4000-8000-000000000003',
    '13000000-0000-4000-8000-000000000002',
    '23000000-0000-4000-8000-000000000002',
    'CAMPAIGN', 'campaign:444444444444', '444444444444',
    'campaign:444444444444', 'CAMPAIGN', 'campaign:444444444444',
    '43000000-0000-4000-8000-000000000002', 'MANAGED', now()
  );

do $$
begin
  if exists (
    select 1 from public.automation_targets
    where id in (
      '53000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000003'
    )
      and status <> 'SUSPENDED'
  ) then
    raise exception 'Targets were not fail-closed without an explicit selection';
  end if;
end;
$$;

do $$
declare
  v_result record;
begin
  select * into v_result
  from public.set_meta_customer_automation_scope(
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'CAMPAIGN',
    '43000000-0000-4000-8000-000000000001',
    'MANAGED',
    'Scope regression campaign selection'
  );

  if v_result.affected_target_count <> 1
    or v_result.managed_budget_owner_count <> 1
    or (select count(*) from public.automation_targets
        where campaign_id = '43000000-0000-4000-8000-000000000001'
          and status = 'MANAGED') <> 1
    or (select status from public.automation_targets
        where id = '53000000-0000-4000-8000-000000000003') <> 'SUSPENDED' then
    raise exception 'Campaign selection or tenant isolation is incorrect';
  end if;
end;
$$;

do $$
declare
  v_result record;
begin
  select * into v_result
  from public.set_meta_customer_automation_scope(
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'TARGET',
    '53000000-0000-4000-8000-000000000001',
    'SUSPENDED',
    'Scope regression target suspension'
  );

  if v_result.managed_budget_owner_count <> 0
    or (select status from public.automation_targets
        where id = '53000000-0000-4000-8000-000000000001') <> 'SUSPENDED' then
    raise exception 'Target suspension did not override campaign management';
  end if;
end;
$$;

do $$
declare
  v_result record;
begin
  select * into v_result
  from public.set_meta_customer_automation_scope(
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'TARGET',
    '53000000-0000-4000-8000-000000000001',
    'MANAGED',
    'Scope regression target reactivation'
  );

  if v_result.managed_budget_owner_count <> 1
    or (select status from public.automation_targets
        where id = '53000000-0000-4000-8000-000000000001') <> 'MANAGED' then
    raise exception 'Target management selection was not applied';
  end if;
end;
$$;

do $$
begin
  perform public.set_meta_customer_automation_scope(
    '13000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'CAMPAIGN',
    '43000000-0000-4000-8000-000000000001',
    'SUSPENDED',
    'Scope regression campaign suspension'
  );

  if exists (
    select 1 from public.automation_targets
    where campaign_id = '43000000-0000-4000-8000-000000000001'
      and status <> 'SUSPENDED'
  ) then
    raise exception 'Campaign suspension did not dominate target selection';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.set_meta_customer_automation_scope(
      '13000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000001',
      'CAMPAIGN',
      '43000000-0000-4000-8000-000000000002',
      'MANAGED',
      'Cross-tenant selection must be rejected'
    );
    raise exception 'Cross-tenant campaign selection was accepted';
  exception
    when others then
      if sqlerrm = 'Cross-tenant campaign selection was accepted' then
        raise;
      end if;
      if sqlerrm <> 'Customer automation campaign is invalid' then
        raise;
      end if;
  end;

  if (select count(*) from public.mutation_audit_events
      where user_id = '13000000-0000-4000-8000-000000000001'
        and platform_account_id = '23000000-0000-4000-8000-000000000001'
        and event_type = 'AUTOMATION_SCOPE_CHANGED') <> 4 then
    raise exception 'Automation scope audit event count is incorrect';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.set_meta_customer_automation_scope(uuid,uuid,text,uuid,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.set_meta_customer_automation_scope(uuid,uuid,text,uuid,text,text)',
      'EXECUTE'
    ) then
    raise exception 'Automation scope RPC privileges are incorrect';
  end if;
end;
$$;

rollback;

select 'Meta customer campaign scope checks passed' as result;

begin;

-- Customer-facing control commands remain service-role only. Browser sessions may
-- read their own state through RLS, but every mutation is authenticated by the
-- application server and reaches this narrow, validated command surface.
create or replace function public.put_meta_customer_policy_version(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_account_daily_hard_cap_minor bigint,
  p_default_campaign_daily_hard_cap_minor bigint,
  p_allow_budget_changes boolean,
  p_allow_status_changes boolean,
  p_allow_new_launches boolean,
  p_enable_automation boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy_id uuid := gen_random_uuid();
  v_version integer;
  v_current public.automation_policies%rowtype;
  v_payload jsonb;
  v_policy_hash text;
  v_before_state jsonb := '{}'::jsonb;
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_account_daily_hard_cap_minor is null
    or p_default_campaign_daily_hard_cap_minor is null
    or p_allow_budget_changes is null
    or p_allow_status_changes is null
    or p_allow_new_launches is null
    or p_enable_automation is null then
    raise exception 'Customer policy input is incomplete';
  end if;

  if p_account_daily_hard_cap_minor <= 0
    or p_default_campaign_daily_hard_cap_minor <= 0
    or p_default_campaign_daily_hard_cap_minor > p_account_daily_hard_cap_minor then
    raise exception 'Customer policy budget caps are invalid';
  end if;

  if p_allow_new_launches and not p_allow_status_changes then
    raise exception 'Active launches require customer-approved status changes';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and pa.marketing_currency = 'EUR'
  ) then
    raise exception 'Customer policy requires an active EUR Meta account';
  end if;

  if p_enable_automation and not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and 'ads_management' = any(pa.meta_scopes)
  ) then
    raise exception 'Active customer policy requires ads_management';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('customer-policy:' || p_platform_account_id::text, 0)
  );

  select ap.*
  into v_current
  from public.automation_policies ap
  where ap.platform_account_id = p_platform_account_id
    and ap.user_id = p_user_id
    and ap.is_current
  for update;

  -- A browser retry after a lost response must not create a second policy
  -- version or duplicate confirmation event.
  if v_current.id is not null
    and v_current.currency = 'EUR'
    and v_current.account_daily_hard_cap_minor = p_account_daily_hard_cap_minor
    and v_current.default_campaign_daily_hard_cap_minor = p_default_campaign_daily_hard_cap_minor
    and v_current.budget_change_limit_bps = 2000
    and v_current.cooldown_seconds = 43200
    and v_current.standard_flex_spend_multiplier_bps = 17500
    and v_current.shared_budget_flex_spend_multiplier_bps = 21000
    and v_current.allow_budget_changes = p_allow_budget_changes
    and v_current.allow_status_changes = p_allow_status_changes
    and v_current.allow_new_launches = p_allow_new_launches
    and v_current.require_verified_domain
    and (
      (p_enable_automation and v_current.status = 'ACTIVE')
      or (not p_enable_automation and v_current.status = 'OFF')
    ) then
    return v_current.id;
  end if;

  select coalesce(max(ap.version), 0) + 1
  into v_version
  from public.automation_policies ap
  where ap.platform_account_id = p_platform_account_id
    and ap.user_id = p_user_id;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'campaign_objectives', 'ALL',
    'regions', 'ALL',
    'landing_pages', 'CUSTOMER_VERIFIED_DOMAINS',
    'new_launch_behavior', 'PAUSED_SHADOW_THEN_ACTIVE',
    'brand_assets', jsonb_build_object(
      'reuse_existing', true,
      'allow_generation', true
    ),
    'customer_controls', jsonb_build_object(
      'account_daily_hard_cap_minor', p_account_daily_hard_cap_minor,
      'default_campaign_daily_hard_cap_minor', p_default_campaign_daily_hard_cap_minor,
      'allow_budget_changes', p_allow_budget_changes,
      'allow_status_changes', p_allow_status_changes,
      'allow_new_launches', p_allow_new_launches,
      'enable_automation', p_enable_automation
    ),
    'safety_contract', jsonb_build_object(
      'budget_change_limit_bps', 2000,
      'cooldown_seconds', 43200,
      'standard_flex_spend_multiplier_bps', 17500,
      'shared_budget_flex_spend_multiplier_bps', 21000,
      'require_verified_domain', true
    )
  );

  if pg_catalog.octet_length(v_payload::text) > 65536
    or public.meta_jsonb_has_sensitive_key(v_payload) then
    raise exception 'Sensitive or oversized customer policy rejected';
  end if;

  v_policy_hash := public.meta_sha256(v_payload::text);

  if v_current.id is not null then
    v_before_state := jsonb_build_object(
      'policy_id', v_current.id,
      'version', v_current.version,
      'status', v_current.status,
      'account_daily_hard_cap_minor', v_current.account_daily_hard_cap_minor,
      'default_campaign_daily_hard_cap_minor', v_current.default_campaign_daily_hard_cap_minor,
      'allow_budget_changes', v_current.allow_budget_changes,
      'allow_status_changes', v_current.allow_status_changes,
      'allow_new_launches', v_current.allow_new_launches
    );

    update public.automation_policies
    set
      status = 'OFF',
      is_current = false,
      updated_at = now()
    where id = v_current.id;
  end if;

  insert into public.automation_policies (
    id,
    user_id,
    platform_account_id,
    previous_policy_id,
    version,
    status,
    currency,
    account_daily_hard_cap_minor,
    default_campaign_daily_hard_cap_minor,
    budget_change_limit_bps,
    cooldown_seconds,
    standard_flex_spend_multiplier_bps,
    shared_budget_flex_spend_multiplier_bps,
    allow_budget_changes,
    allow_status_changes,
    allow_new_launches,
    require_verified_domain,
    policy_payload,
    policy_hash,
    is_current,
    customer_confirmed_at,
    customer_confirmed_by,
    activated_at
  ) values (
    v_policy_id,
    p_user_id,
    p_platform_account_id,
    v_current.id,
    v_version,
    case when p_enable_automation then 'ACTIVE' else 'OFF' end,
    'EUR',
    p_account_daily_hard_cap_minor,
    p_default_campaign_daily_hard_cap_minor,
    2000,
    43200,
    17500,
    21000,
    p_allow_budget_changes,
    p_allow_status_changes,
    p_allow_new_launches,
    true,
    v_payload,
    v_policy_hash,
    true,
    now(),
    p_user_id,
    case when p_enable_automation then now() else null end
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    v_policy_id,
    null,
    null,
    null,
    'CUSTOMER',
    p_user_id::text,
    case when p_enable_automation then 'POLICY_ACTIVATED' else 'POLICY_DISABLED' end,
    v_before_state,
    jsonb_build_object(
      'account_daily_hard_cap_minor', p_account_daily_hard_cap_minor,
      'default_campaign_daily_hard_cap_minor', p_default_campaign_daily_hard_cap_minor,
      'allow_budget_changes', p_allow_budget_changes,
      'allow_status_changes', p_allow_status_changes,
      'allow_new_launches', p_allow_new_launches,
      'enable_automation', p_enable_automation
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'policy_id', v_policy_id,
      'version', v_version,
      'status', case when p_enable_automation then 'ACTIVE' else 'OFF' end,
      'budget_change_limit_bps', 2000,
      'cooldown_seconds', 43200,
      'require_verified_domain', true
    ),
    jsonb_build_object('policy_hash', v_policy_hash),
    null,
    null,
    null,
    null,
    null,
    now()
  );

  return v_policy_id;
end;
$$;

create or replace function public.set_meta_customer_kill_switch(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_mode text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_mode not in ('ALLOW', 'FREEZE_WRITES', 'PAUSE_MANAGED')
    or char_length(v_reason) < 8
    or char_length(v_reason) > 500 then
    raise exception 'Customer kill-switch input is invalid';
  end if;

  if p_mode = 'ALLOW' and not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and 'ads_management' = any(pa.meta_scopes)
  ) then
    raise exception 'ALLOW requires ads_management';
  end if;

  return public.append_meta_kill_switch_state(
    'ACCOUNT',
    p_user_id,
    p_platform_account_id,
    null,
    p_mode,
    v_reason,
    'CUSTOMER',
    p_user_id::text
  );
end;
$$;

revoke all on function public.put_meta_customer_policy_version(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.set_meta_customer_kill_switch(
  uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.put_meta_customer_policy_version(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) to service_role;
grant execute on function public.set_meta_customer_kill_switch(
  uuid, uuid, text, text
) to service_role;

commit;

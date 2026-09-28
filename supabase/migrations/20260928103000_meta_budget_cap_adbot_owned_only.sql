-- Adbot account hard caps protect budgets controlled by Adbot. Campaigns that
-- merely exist in the connected Meta ad account must remain visible for
-- reporting, but must not consume the Adbot-controlled account allowance.
--
-- A PLAN row is always an Adbot-controlled pending or executing mutation. A
-- SNAPSHOT / RECONCILIATION row is Adbot-controlled only when its campaign has
-- a CAMPAIGN remote binding created by an Adbot mutation plan.

begin;

create or replace function public.reserve_meta_daily_budget_exposure(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_plan_id uuid,
  p_automation_target_id uuid,
  p_account_day date,
  p_campaign_scope_key text,
  p_budget_owner_key text,
  p_budget_owner_type text,
  p_shared_budget_enabled boolean,
  p_currency text,
  p_daily_budget_minor bigint,
  p_flex_spend_multiplier_bps integer,
  p_source text
)
returns table (
  exposure_id uuid,
  owner_reserved_exposure_minor bigint,
  campaign_reserved_exposure_minor bigint,
  account_reserved_exposure_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
  v_campaign_cap bigint;
  v_campaign_total bigint;
  v_account_total bigint;
begin
  select * into v_policy
  from public.automation_policies ap
  where ap.id = p_policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;
  if not found then
    raise exception 'Active current automation policy is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':' || p_account_day::text,
      0
    )
  );

  if p_currency <> v_policy.currency or p_currency <> 'EUR' then
    raise exception 'Exposure currency does not match active EUR policy';
  end if;
  if p_flex_spend_multiplier_bps > 50000
    or (
      not p_shared_budget_enabled
      and p_flex_spend_multiplier_bps < v_policy.standard_flex_spend_multiplier_bps
    )
    or (
      p_shared_budget_enabled
      and p_flex_spend_multiplier_bps < v_policy.shared_budget_flex_spend_multiplier_bps
    ) then
    raise exception 'Exposure multiplier is below policy safety minimum';
  end if;
  if p_budget_owner_type not in ('CAMPAIGN', 'AD_SET')
    or p_source not in ('SNAPSHOT', 'PLAN', 'RECONCILIATION') then
    raise exception 'Invalid budget exposure classification';
  end if;
  if not exists (
    select 1
    from public.daily_budget_exposure_snapshots s
    where s.id = p_snapshot_id
      and s.user_id = p_user_id
      and s.platform_account_id = p_platform_account_id
      and s.policy_id = p_policy_id
      and s.account_day = p_account_day
      and s.currency = p_currency
      and s.status = 'COMPLETE'
  ) then
    raise exception 'Complete matching daily exposure snapshot is required';
  end if;

  perform 1
  from public.daily_budget_exposures dbe
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = p_account_day
  for update;

  insert into public.daily_budget_exposures (
    user_id, platform_account_id, policy_id, snapshot_id, plan_id,
    automation_target_id, account_day, campaign_scope_key, budget_owner_key,
    budget_owner_type, shared_budget_enabled, currency, max_daily_budget_minor,
    flex_spend_multiplier_bps, source, last_observed_at, updated_at
  ) values (
    p_user_id, p_platform_account_id, p_policy_id, p_snapshot_id, p_plan_id,
    p_automation_target_id, p_account_day, p_campaign_scope_key,
    p_budget_owner_key, p_budget_owner_type, p_shared_budget_enabled, p_currency,
    p_daily_budget_minor, p_flex_spend_multiplier_bps, p_source, now(), now()
  )
  on conflict (platform_account_id, account_day, budget_owner_key)
  do update set
    plan_id = coalesce(excluded.plan_id, public.daily_budget_exposures.plan_id),
    automation_target_id = coalesce(
      excluded.automation_target_id,
      public.daily_budget_exposures.automation_target_id
    ),
    shared_budget_enabled = (
      public.daily_budget_exposures.shared_budget_enabled
      or excluded.shared_budget_enabled
    ),
    max_daily_budget_minor = greatest(
      public.daily_budget_exposures.max_daily_budget_minor,
      excluded.max_daily_budget_minor
    ),
    flex_spend_multiplier_bps = greatest(
      public.daily_budget_exposures.flex_spend_multiplier_bps,
      excluded.flex_spend_multiplier_bps
    ),
    source = excluded.source,
    last_observed_at = now(),
    updated_at = now()
  returning * into v_exposure;

  select coalesce(
      cbl.daily_hard_cap_minor,
      v_policy.default_campaign_daily_hard_cap_minor
    )
    into v_campaign_cap
  from (select 1) seed
  left join public.campaign_budget_limits cbl
    on cbl.policy_id = p_policy_id
   and cbl.user_id = p_user_id
   and cbl.platform_account_id = p_platform_account_id
   and cbl.campaign_scope_key = p_campaign_scope_key;

  select coalesce(sum(dbe.reserved_exposure_minor), 0)
    into v_campaign_total
  from public.daily_budget_exposures dbe
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = p_account_day
    and dbe.campaign_scope_key = p_campaign_scope_key
    and (
      (
        dbe.source = 'PLAN'
        and exists (
          select 1
          from public.mutation_plans plan
          where plan.id = dbe.plan_id
            and plan.user_id = p_user_id
            and plan.platform_account_id = p_platform_account_id
            and plan.status in (
              'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
              'RETRYABLE', 'COMPENSATION_REQUIRED'
            )
        )
      )
      or exists (
        select 1
        from public.remote_object_bindings binding
        where binding.user_id = p_user_id
          and binding.platform_account_id = p_platform_account_id
          and binding.object_type = 'CAMPAIGN'
          and dbe.campaign_scope_key = 'campaign:' || binding.remote_object_id
      )
    );

  select coalesce(sum(dbe.reserved_exposure_minor), 0)
    into v_account_total
  from public.daily_budget_exposures dbe
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = p_account_day
    and (
      (
        dbe.source = 'PLAN'
        and exists (
          select 1
          from public.mutation_plans plan
          where plan.id = dbe.plan_id
            and plan.user_id = p_user_id
            and plan.platform_account_id = p_platform_account_id
            and plan.status in (
              'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
              'RETRYABLE', 'COMPENSATION_REQUIRED'
            )
        )
      )
      or exists (
        select 1
        from public.remote_object_bindings binding
        where binding.user_id = p_user_id
          and binding.platform_account_id = p_platform_account_id
          and binding.object_type = 'CAMPAIGN'
          and dbe.campaign_scope_key = 'campaign:' || binding.remote_object_id
      )
    );

  if v_campaign_total > v_campaign_cap then
    raise exception 'Campaign daily hard cap would be exceeded (reserved % / cap % minor units)',
      v_campaign_total, v_campaign_cap;
  end if;
  if v_account_total > v_policy.account_daily_hard_cap_minor then
    raise exception 'Account daily hard cap would be exceeded (reserved % / cap % minor units)',
      v_account_total, v_policy.account_daily_hard_cap_minor;
  end if;

  return query select
    v_exposure.id,
    v_exposure.reserved_exposure_minor,
    v_campaign_total,
    v_account_total;
end;
$$;

revoke all on function public.reserve_meta_daily_budget_exposure(
  uuid, uuid, uuid, uuid, uuid, uuid, date, text, text, text, boolean, text, bigint, integer, text
) from public, anon, authenticated;
grant execute on function public.reserve_meta_daily_budget_exposure(
  uuid, uuid, uuid, uuid, uuid, uuid, date, text, text, text, boolean, text, bigint, integer, text
) to service_role;

comment on function public.reserve_meta_daily_budget_exposure(
  uuid, uuid, uuid, uuid, uuid, uuid, date, text, text, text, boolean, text, bigint, integer, text
) is
  'Reserves Meta daily budget for Adbot-controlled plans and enforces campaign/account caps against Adbot-managed exposure only; externally managed Meta campaigns remain outside the Adbot allowance.';

commit;

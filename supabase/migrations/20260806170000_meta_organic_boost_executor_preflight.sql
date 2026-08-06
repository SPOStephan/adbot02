-- Organic Beitrag-Push AUTO plans never insert into meta_launch_canary_approvals.
-- claim_next_meta_mutation_execution still required that join via
-- meta_launch_canary_preflight_ok, so every organic LAUNCH_CHAIN was marked
-- STALE (launch_canary_preflight_drift) and never reached Meta.
--
-- This migration:
-- 1) Adds an organic-specific executor preflight (AUTO without launch approvals;
--    REVIEW via meta_organic_boost_canary_approvals).
-- 2) Routes organic-boost plans through that path.
-- 3) Revives AUTO organic plans stuck as STALE for that false preflight.

begin;

create or replace function public.meta_organic_boost_executor_preflight_ok(
  p_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mutation_plans plan
    join public.platform_accounts account
      on account.id = plan.platform_account_id
     and account.user_id = plan.user_id
     and account.platform = 'meta'
     and account.revoked_at is null
     and account.marketing_currency = 'EUR'
     and account.marketing_sync_status = 'success'
     and account.marketing_last_success_at >= now() - interval '24 hours'
     and account.marketing_last_success_at <= now() + interval '1 minute'
     and 'ads_management' = any(account.meta_scopes)
     and account.marketing_meta_ad_account_id is not null
    join public.automation_policies policy
      on policy.id = plan.policy_id
     and policy.user_id = plan.user_id
     and policy.platform_account_id = plan.platform_account_id
     and policy.is_current
     and policy.status = 'ACTIVE'
     and policy.currency = 'EUR'
     and policy.allow_new_launches
     and policy.allow_status_changes
     and policy.policy_hash = plan.expected_before->>'policy_hash'
    join public.meta_organic_boost_links link_row
      on link_row.plan_id = plan.id
     and link_row.user_id = plan.user_id
     and link_row.platform_account_id = plan.platform_account_id
    join public.daily_budget_exposure_snapshots snapshot
      on snapshot.id = (plan.expected_before->>'exposure_snapshot_id')::uuid
     and snapshot.user_id = plan.user_id
     and snapshot.platform_account_id = plan.platform_account_id
     and snapshot.policy_id = plan.policy_id
     and snapshot.status = 'COMPLETE'
     and snapshot.currency = 'EUR'
    where plan.id = p_plan_id
      and plan.source_rule_key = 'organic-boost'
      and plan.action_type = 'LAUNCH_CHAIN'
      and not plan.safety_action
      and plan.max_attempts >= 1
      -- After claim, attempt_count is already incremented; allow in-flight runs.
      and plan.attempt_count <= plan.max_attempts
      and plan.payload_hash ~ '^[0-9a-f]{64}$'
      and public.meta_sha256(plan.planned_payload::text) = plan.payload_hash
      and plan.planned_payload->>'launch_kind' = 'ORGANIC_BOOST'
      and (plan.planned_payload->>'contract_version')::integer in (2, 3)
      and plan.planned_payload#>>'{campaign,status}' = 'PAUSED'
      and plan.planned_payload#>>'{ad_set,status}' = 'PAUSED'
      and plan.planned_payload#>>'{ad,status}' = 'PAUSED'
      and plan.intended_after->>'status' = 'ACTIVE'
      and plan.not_before <= now()
      and (
        -- AUTO: no canary approval row; kill-switch ALLOW is enough.
        (
          coalesce((plan.planned_payload->>'require_manual_approval')::boolean, true) = false
          and (select ks.mode
               from public.get_effective_meta_kill_switch(
                 plan.user_id, plan.platform_account_id, plan.id
               ) ks) = 'ALLOW'
        )
        or (
          -- REVIEW: exact organic canary approval fingerprint.
          coalesce((plan.planned_payload->>'require_manual_approval')::boolean, true) = true
          and exists (
            select 1
            from public.meta_organic_boost_canary_approvals approval
            where approval.plan_id = plan.id
              and approval.user_id = plan.user_id
              and approval.platform_account_id = plan.platform_account_id
              and approval.payload_hash = plan.payload_hash
              and approval.object_story_id = plan.planned_payload->>'object_story_id'
              and approval.budget_mode = plan.planned_payload->>'budget_mode'
              and approval.duration_days
                    = (plan.planned_payload->>'duration_days')::integer
              and coalesce(approval.destination_url, '')
                    = coalesce(plan.planned_payload->>'destination_url', '')
              and (
                (
                  approval.budget_mode = 'DAILY'
                  and approval.daily_budget_minor
                        = (plan.planned_payload->>'daily_budget_minor')::bigint
                  and approval.lifetime_budget_minor is null
                )
                or (
                  approval.budget_mode = 'LIFETIME'
                  and approval.lifetime_budget_minor
                        = (plan.planned_payload->>'lifetime_budget_minor')::bigint
                  and approval.daily_budget_minor is null
                )
              )
          )
          and (select ks.mode
               from public.get_effective_meta_kill_switch(
                 plan.user_id, plan.platform_account_id, plan.id
               ) ks) = 'ALLOW'
        )
      )
      and exists (
        select 1
        from public.daily_budget_exposures exposure
        where exposure.plan_id = plan.id
          and exposure.user_id = plan.user_id
          and exposure.platform_account_id = plan.platform_account_id
          and exposure.policy_id = plan.policy_id
          and exposure.snapshot_id = snapshot.id
          and exposure.source in ('PLAN', 'RECONCILIATION')
          and exposure.budget_owner_type
                = plan.planned_payload->>'budget_owner_type'
          and exposure.max_daily_budget_minor = case
            when (plan.planned_payload->>'contract_version')::integer = 2
              then (plan.planned_payload->>'daily_budget_minor')::bigint
            else (plan.planned_payload->>'lifetime_budget_minor')::bigint
          end
          and exposure.flex_spend_multiplier_bps = case
            when (plan.planned_payload->>'contract_version')::integer = 2
              then policy.standard_flex_spend_multiplier_bps
            else 10000
          end
      )
      and not exists (
        select 1
        from public.mutation_plan_steps step
        where step.plan_id = plan.id
          and (
            public.meta_sha256(step.planned_request::text) <> step.request_hash
            or step.dispatch_state = 'REMOTE_UNKNOWN'
            or step.status in ('COMPENSATION_REQUIRED', 'FAILED')
          )
      )
  );
$$;

revoke all on function public.meta_organic_boost_executor_preflight_ok(uuid)
  from public, anon, authenticated;
grant execute on function public.meta_organic_boost_executor_preflight_ok(uuid)
  to service_role;

comment on function public.meta_organic_boost_executor_preflight_ok(uuid) is
  'Executor preflight for organic Beitrag-Push LAUNCH_CHAIN plans. AUTO skips meta_launch_canary_approvals; REVIEW uses meta_organic_boost_canary_approvals.';

create or replace function public.meta_launch_canary_preflight_ok(
  p_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.meta_organic_boost_executor_preflight_ok(p_plan_id)
    or exists (
      select 1
      from public.mutation_plans plan
      join public.platform_accounts account
        on account.id = plan.platform_account_id
       and account.user_id = plan.user_id
       and account.platform = 'meta'
       and account.revoked_at is null
       and account.marketing_currency = 'EUR'
       and account.marketing_sync_id = plan.source_marketing_sync_id
       and account.marketing_sync_status = 'success'
       and account.marketing_last_success_at >= now() - interval '2 hours'
       and account.marketing_last_success_at <= now() + interval '1 minute'
       and 'ads_management' = any(account.meta_scopes)
      join public.automation_policies policy
        on policy.id = plan.policy_id
       and policy.user_id = plan.user_id
       and policy.platform_account_id = plan.platform_account_id
       and policy.is_current
       and policy.status = 'ACTIVE'
       and policy.currency = 'EUR'
       and policy.allow_new_launches
       and policy.allow_status_changes
       and policy.policy_hash = plan.expected_before->>'policy_hash'
      join public.meta_launch_canary_approvals approval
        on approval.plan_id = plan.id
       and approval.user_id = plan.user_id
       and approval.platform_account_id = plan.platform_account_id
       and approval.payload_hash = plan.payload_hash
       and approval.objective = plan.planned_payload->>'objective'
       and approval.destination_url = plan.planned_payload->>'destination_url'
       and approval.budget_owner_type = plan.planned_payload->>'budget_owner_type'
       and approval.budget_type = coalesce(plan.planned_payload->>'budget_type', 'DAILY')
       and approval.campaign_name = plan.planned_payload#>>'{campaign,name}'
       and approval.ad_set_name = plan.planned_payload#>>'{ad_set,name}'
       and approval.creative_name = plan.planned_payload#>>'{creative,name}'
       and approval.ad_name = plan.planned_payload#>>'{ad,name}'
       and approval.target_status = plan.intended_after->>'status'
       and (
         (
           (plan.planned_payload->>'contract_version')::integer = 2
           and approval.daily_budget_minor
                 = (plan.planned_payload->>'daily_budget_minor')::bigint
           and approval.lifetime_budget_minor is null
           and approval.start_time is null
           and approval.end_time is null
         ) or (
           (plan.planned_payload->>'contract_version')::integer = 3
           and approval.daily_budget_minor is null
           and approval.lifetime_budget_minor
                 = (plan.planned_payload->>'lifetime_budget_minor')::bigint
           and approval.start_time
                 = (plan.planned_payload->>'start_time')::timestamptz
           and approval.end_time
                 = (plan.planned_payload->>'end_time')::timestamptz
         )
       )
      join public.daily_budget_exposure_snapshots snapshot
        on snapshot.id = (plan.expected_before->>'exposure_snapshot_id')::uuid
       and snapshot.user_id = plan.user_id
       and snapshot.platform_account_id = plan.platform_account_id
       and snapshot.policy_id = plan.policy_id
       and snapshot.source_marketing_sync_id = plan.source_marketing_sync_id
       and snapshot.status = 'COMPLETE'
       and snapshot.currency = 'EUR'
      where plan.id = p_plan_id
        and plan.source_rule_key is distinct from 'organic-boost'
        and plan.action_type = 'LAUNCH_CHAIN'
        and not plan.safety_action
        and plan.max_attempts = 1
        and plan.attempt_count <= 1
        and plan.payload_hash ~ '^[0-9a-f]{64}$'
        and public.meta_sha256(plan.planned_payload::text) = plan.payload_hash
        and (plan.planned_payload->>'contract_version')::integer in (2, 3)
        and plan.planned_payload#>>'{campaign,status}' = 'PAUSED'
        and plan.planned_payload#>>'{ad_set,status}' = 'PAUSED'
        and plan.planned_payload#>>'{ad,status}' = 'PAUSED'
        and plan.intended_after->>'status' = 'ACTIVE'
        and (
          (plan.planned_payload->>'contract_version')::integer = 2
          or (
            plan.planned_payload->>'budget_type' = 'LIFETIME'
            and plan.planned_payload->>'budget_owner_type' = 'CAMPAIGN'
            and (plan.planned_payload#>>'{campaign,lifetime_budget}')::bigint
                  = (plan.planned_payload->>'lifetime_budget_minor')::bigint
            and plan.planned_payload#>>'{campaign,daily_budget}' is null
            and plan.planned_payload#>>'{ad_set,daily_budget}' is null
            and plan.planned_payload#>>'{ad_set,lifetime_budget}' is null
            and (plan.planned_payload#>>'{ad_set,start_time}')::timestamptz
                  = (plan.planned_payload->>'start_time')::timestamptz
            and (plan.planned_payload#>>'{ad_set,end_time}')::timestamptz
                  = (plan.planned_payload->>'end_time')::timestamptz
            and public.meta_active_lifetime_budget_exposure_minor(
                  plan.user_id,
                  plan.platform_account_id,
                  plan.source_marketing_sync_id,
                  now()
                ) = (plan.expected_before->>'existing_lifetime_exposure_minor')::bigint
            and (
              select coalesce(sum(account_exposure.reserved_exposure_minor), 0)::bigint
              from public.daily_budget_exposures account_exposure
              where account_exposure.platform_account_id = plan.platform_account_id
                and account_exposure.account_day = snapshot.account_day
            ) + public.meta_active_lifetime_budget_exposure_minor(
                  plan.user_id,
                  plan.platform_account_id,
                  plan.source_marketing_sync_id,
                  now()
                ) <= policy.account_daily_hard_cap_minor
          )
        )
        and exists (
          select 1
          from public.daily_budget_exposures exposure
          where exposure.plan_id = plan.id
            and exposure.user_id = plan.user_id
            and exposure.platform_account_id = plan.platform_account_id
            and exposure.policy_id = plan.policy_id
            and exposure.snapshot_id = snapshot.id
            and exposure.source in ('PLAN', 'RECONCILIATION')
            and exposure.budget_owner_type
                  = plan.planned_payload->>'budget_owner_type'
            and exposure.max_daily_budget_minor = case
              when (plan.planned_payload->>'contract_version')::integer = 2
                then (plan.planned_payload->>'daily_budget_minor')::bigint
              else (plan.planned_payload->>'lifetime_budget_minor')::bigint
            end
            and exposure.flex_spend_multiplier_bps = case
              when (plan.planned_payload->>'contract_version')::integer = 2
                then policy.standard_flex_spend_multiplier_bps
              else 10000
            end
        )
        and not exists (
          select 1
          from public.mutation_plan_steps step
          where step.plan_id = plan.id
            and (
              public.meta_sha256(step.planned_request::text) <> step.request_hash
              or step.dispatch_state = 'REMOTE_UNKNOWN'
              or step.status in ('COMPENSATION_REQUIRED', 'FAILED')
            )
        )
        and (select ks.mode
             from public.get_effective_meta_kill_switch(
               plan.user_id, plan.platform_account_id, plan.id
             ) ks) = 'ALLOW'
    );
$$;

comment on function public.meta_launch_canary_preflight_ok(uuid) is
  'Launch preflight: organic-boost uses meta_organic_boost_executor_preflight_ok; other LAUNCH_CHAIN plans keep the launch-canary approval contract.';

-- Revive AUTO organic plans killed by the false canary preflight so the
-- executor can send them on the next cron minute.
update public.mutation_plans mp
set
  status = 'PENDING',
  attempt_count = 0,
  max_attempts = greatest(coalesce(mp.max_attempts, 1), 3),
  lease_token = null,
  lease_owner = null,
  lease_expires_at = null,
  error_class = null,
  blocked_reason = null,
  terminal_at = null,
  updated_at = now()
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status = 'STALE'
  and mp.blocked_reason = 'launch_canary_preflight_drift'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and mp.not_before <= now();

-- Future organic materializations get a small retry budget for lease/timeouts.
-- Applied to currently pending AUTO organic plans as well.
update public.mutation_plans mp
set
  max_attempts = greatest(coalesce(mp.max_attempts, 1), 3),
  updated_at = now()
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status in ('PENDING', 'RETRYABLE')
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and coalesce(mp.max_attempts, 1) < 3;

create or replace function public.hold_meta_launch_plan_for_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action_type <> 'LAUNCH_CHAIN' or new.safety_action then
    return new;
  end if;

  if new.source_rule_key = 'organic-boost'
    and coalesce((new.planned_payload->>'require_manual_approval')::boolean, true) = false then
    new.not_before := coalesce(new.not_before, now());
    -- Small retry budget: WRITE lease contention / brief Meta timeouts.
    new.max_attempts := greatest(coalesce(new.max_attempts, 1), 3);
    return new;
  end if;

  new.not_before := 'infinity'::timestamptz;
  new.max_attempts := 1;
  return new;
end;
$$;

commit;

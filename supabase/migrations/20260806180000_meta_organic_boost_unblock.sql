-- Unblock Beitrag-Push end-to-end:
-- 1) Ensure organic executor preflight exists (safe if 061700 already applied).
-- 2) Revive STALE organic AUTO plans stuck on launch_canary_preflight_drift.
-- 3) Vollautomatik defaults to source_filter=both (IG+FB); migrate current AUTO rows.
-- 4) Claim must not terminal-STALE organic plans on transient preflight failure.

begin;

-- ---------------------------------------------------------------------------
-- 1) Organic executor preflight (idempotent recreate)
-- ---------------------------------------------------------------------------
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
     and account.marketing_last_success_at >= now() - interval '48 hours'
     and account.marketing_last_success_at <= now() + interval '1 minute'
     and 'ads_management' = any(account.meta_scopes)
     and nullif(account.marketing_meta_ad_account_id, '') is not null
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
        (
          coalesce((plan.planned_payload->>'require_manual_approval')::boolean, true) = false
          and (select ks.mode
               from public.get_effective_meta_kill_switch(
                 plan.user_id, plan.platform_account_id, plan.id
               ) ks) = 'ALLOW'
        )
        or (
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
       and approval.destination_url is not distinct from plan.planned_payload->>'destination_url'
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

-- ---------------------------------------------------------------------------
-- 2) Revive stuck organic AUTO plans
-- ---------------------------------------------------------------------------
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
  and mp.status in ('STALE', 'BLOCKED', 'PREFLIGHT_FAILED')
  and coalesce(mp.blocked_reason, '') in (
    'launch_canary_preflight_drift',
    'writes_frozen',
    'action_not_allowed',
    'ads_management_reconnect_required',
    ''
  )
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and mp.not_before <= now();

-- ---------------------------------------------------------------------------
-- 3) Vollautomatik: boost Facebook + Instagram by default
-- ---------------------------------------------------------------------------
alter table public.meta_boost_settings
  alter column source_filter set default 'both';

update public.meta_boost_settings
set
  source_filter = 'both',
  updated_at = now()
where is_current
  and boost_mode = 'AUTO'
  and source_filter = 'facebook';

-- ---------------------------------------------------------------------------
-- 4) Link orphan Instagram assets to the sole Facebook page when unambiguous
-- ---------------------------------------------------------------------------
update public.meta_assets ig
set
  parent_meta_asset_id = page.meta_asset_id,
  updated_at = now()
from (
  select
    platform_account_id,
    user_id,
    min(meta_asset_id) as meta_asset_id
  from public.meta_assets
  where asset_type = 'facebook_page'
  group by platform_account_id, user_id
  having count(*) = 1
) page
where ig.asset_type = 'instagram_account'
  and ig.platform_account_id = page.platform_account_id
  and ig.user_id = page.user_id
  and (ig.parent_meta_asset_id is null or char_length(ig.parent_meta_asset_id) < 5);

-- ---------------------------------------------------------------------------
-- 5) Claim: skip organic preflight failures instead of terminal STALE
-- ---------------------------------------------------------------------------
create or replace function public.meta_launch_chain_preflight_action(
  p_plan_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
begin
  select * into v_plan
  from public.mutation_plans
  where id = p_plan_id;

  if not found or v_plan.action_type <> 'LAUNCH_CHAIN' then
    return 'ok';
  end if;

  if public.meta_launch_canary_preflight_ok(p_plan_id) then
    return 'ok';
  end if;

  -- Organic AUTO/REVIEW: retry next minute instead of killing the plan.
  if v_plan.source_rule_key = 'organic-boost' then
    return 'skip';
  end if;

  return 'stale';
end;
$$;

revoke all on function public.meta_launch_chain_preflight_action(uuid)
  from public, anon, authenticated;
grant execute on function public.meta_launch_chain_preflight_action(uuid)
  to service_role;

-- Do not terminal-STALE organic-boost plans on preflight miss; skip this tick.
do $patch$
declare
  v_def text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.claim_next_meta_mutation_execution(text,integer)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'claim_next_meta_mutation_execution not found';
  end if;

  if position('meta_launch_chain_preflight_action' in v_def) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_def,
    E'if v_plan\\.action_type = ''LAUNCH_CHAIN''\\s+and not public\\.meta_launch_canary_preflight_ok\\(v_plan\\.id\\) then\\s+update public\\.mutation_plans\\s+set status = ''STALE'',\\s+lease_token = null,\\s+lease_owner = null,\\s+lease_expires_at = null,\\s+error_class = ''PREFLIGHT'',\\s+blocked_reason = ''launch_canary_preflight_drift'',\\s+terminal_at = now\\(\\),\\s+updated_at = now\\(\\)\\s+where id = v_plan\\.id;\\s+continue;\\s+end if;',
    $repl$if v_plan.action_type = 'LAUNCH_CHAIN' then
      case public.meta_launch_chain_preflight_action(v_plan.id)
        when 'ok' then
          null;
        when 'skip' then
          continue;
        else
          update public.mutation_plans
          set status = 'STALE',
              lease_token = null,
              lease_owner = null,
              lease_expires_at = null,
              error_class = 'PREFLIGHT',
              blocked_reason = 'launch_canary_preflight_drift',
              terminal_at = now(),
              updated_at = now()
          where id = v_plan.id;
          continue;
      end case;
    end if;$repl$,
    1
  );

  if position('meta_launch_chain_preflight_action' in v_updated) = 0 then
    -- Minimal fallback: never mark organic-boost STALE for canary preflight.
    -- Organic failures become a no-op continue via a dedicated guard below.
    v_updated := replace(
      v_def,
      'and not public.meta_launch_canary_preflight_ok(v_plan.id) then',
      $fallback$and public.meta_launch_chain_preflight_action(v_plan.id) = 'stale' then$fallback$
    );

    if position('meta_launch_chain_preflight_action' in v_updated) = 0 then
      raise exception 'Failed to patch claim_next_meta_mutation_execution for organic boost';
    end if;

    -- Insert skip branch immediately after the STALE end if.
    v_updated := regexp_replace(
      v_updated,
      E'(blocked_reason = ''launch_canary_preflight_drift'',\\s+terminal_at = now\\(\\),\\s+updated_at = now\\(\\)\\s+where id = v_plan\\.id;\\s+continue;\\s+end if;)',
      E'\\1\n\n    if v_plan.action_type = ''LAUNCH_CHAIN''\n      and public.meta_launch_chain_preflight_action(v_plan.id) = ''skip'' then\n      continue;\n    end if;',
      1
    );
  end if;

  execute v_updated;
end;
$patch$;

commit;

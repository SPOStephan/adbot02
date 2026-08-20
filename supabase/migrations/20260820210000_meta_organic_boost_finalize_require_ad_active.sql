-- Beitrag-Push: do not mark LAUNCH_CHAIN SUCCEEDED when only the campaign is
-- ACTIVE. Ads/ad sets often stay PAUSED after create-paused + partial activate;
-- premature finalize abandoned activate-ad / activate-ad-set and the dashboard
-- then lied with "Boost aktiv".

begin;

create or replace function public.finalize_meta_organic_boost_already_active_plans(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finalized_ids uuid[] := array[]::uuid[];
begin
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta account operation scope is invalid';
  end if;

  with finalized as (
    update public.mutation_plans mp
    set
      status = 'SUCCEEDED',
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      error_class = null,
      blocked_reason = null,
      terminal_at = coalesce(mp.terminal_at, now()),
      updated_at = now()
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING'
      )
      and exists (
        select 1
        from public.remote_object_bindings binding
        join public.campaigns campaign
          on campaign.platform_account_id = binding.platform_account_id
         and campaign.user_id = binding.user_id
         and campaign.is_current
         and (
           campaign.platform_campaign_id = binding.remote_object_id
           or campaign.id = binding.local_campaign_id
         )
        where binding.plan_id = mp.id
          and binding.user_id = p_user_id
          and binding.platform_account_id = p_platform_account_id
          and binding.object_type = 'CAMPAIGN'
          and upper(coalesce(campaign.effective_status, campaign.status, ''))
            = 'ACTIVE'
      )
      -- Delivery tree must exist (create steps finished).
      and exists (
        select 1
        from public.remote_object_bindings binding
        where binding.plan_id = mp.id
          and binding.user_id = p_user_id
          and binding.platform_account_id = p_platform_account_id
          and binding.object_type = 'AD_SET'
      )
      and exists (
        select 1
        from public.remote_object_bindings binding
        where binding.plan_id = mp.id
          and binding.user_id = p_user_id
          and binding.platform_account_id = p_platform_account_id
          and binding.object_type = 'AD'
      )
      -- Activate steps must have hit Meta; campaign-only ACTIVE is not enough.
      and (
        not exists (
          select 1
          from public.mutation_plan_steps s
          where s.plan_id = mp.id
            and s.step_key = 'activate-ad-set'
        )
        or exists (
          select 1
          from public.mutation_plan_steps s
          where s.plan_id = mp.id
            and s.step_key = 'activate-ad-set'
            and s.dispatch_state = 'REMOTE_APPLIED'
        )
      )
      and (
        not exists (
          select 1
          from public.mutation_plan_steps s
          where s.plan_id = mp.id
            and s.step_key = 'activate-ad'
        )
        or exists (
          select 1
          from public.mutation_plan_steps s
          where s.plan_id = mp.id
            and s.step_key = 'activate-ad'
            and s.dispatch_state = 'REMOTE_APPLIED'
        )
      )
    returning mp.id
  )
  select coalesce(array_agg(finalized.id), array[]::uuid[])
    into v_finalized_ids
  from finalized;

  if cardinality(v_finalized_ids) > 0 then
    delete from public.daily_budget_exposures dbe
    where dbe.user_id = p_user_id
      and dbe.platform_account_id = p_platform_account_id
      and dbe.plan_id = any(v_finalized_ids)
      and dbe.source = 'PLAN'
      and (
        dbe.budget_owner_key like 'boost:campaign:%'
        or dbe.budget_owner_key like 'boost:adset:%'
      );
  end if;

  return coalesce(cardinality(v_finalized_ids), 0);
end;
$$;

revoke all on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid)
  to service_role;

comment on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid) is
  'Marks organic LAUNCH_CHAIN SUCCEEDED only when campaign is ACTIVE and activate-ad-set/activate-ad are REMOTE_APPLIED (or absent); drops provisional boost:* PLAN exposures.';

commit;

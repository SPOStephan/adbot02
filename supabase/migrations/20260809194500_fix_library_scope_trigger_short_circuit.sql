-- Fix: Media Library migration referenced NEW.library_scope in a shared trigger
-- with AND short-circuit that PL/pgSQL does not honor. Inserts into
-- mutation_plans (Beitrag-Push) then failed with:
--   record "new" has no field "library_scope"
-- Nested IF confines library_scope access to brand_assets only.

create or replace function public.guard_meta_control_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'kill_switch_state' then
    if new.scope_type = 'SYSTEM' then
      return new;
    end if;
  end if;

  -- Nested IF: PL/pgSQL evaluates AND operands even when tg_table_name differs,
  -- so new.library_scope must not be referenced on mutation_plans etc.
  if tg_table_name = 'brand_assets' then
    if coalesce(new.library_scope, 'CUSTOMER') = 'INSPIRATION' then
      if new.user_id is null then
        raise exception 'Inspiration vault asset requires an uploader user_id';
      end if;
      if new.platform_account_id is not null
        or new.brand_profile_id is not null
        or new.source_type <> 'UPLOADED'
        or new.meta_image_hash is not null then
        raise exception 'Inspiration vault asset identity is invalid';
      end if;
      if new.reviewed_by is not null and new.reviewed_by <> new.user_id then
        raise exception 'Brand asset reviewer must be the owning customer';
      end if;
      return new;
    end if;
  end if;

  if new.user_id is null or new.platform_account_id is null or not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = new.platform_account_id
      and pa.user_id = new.user_id
      and pa.platform = 'meta'
  ) then
    raise exception 'Cross-tenant or non-Meta control-plane account reference rejected';
  end if;

  if tg_table_name = 'automation_policies' then
    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Policy confirmer must be the owning customer';
    end if;
    if new.previous_policy_id is not null and not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.previous_policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Previous policy belongs to another tenant or account';
    end if;
  elsif tg_table_name = 'allowed_domains' then
    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Domain confirmer must be the owning customer';
    end if;
  elsif tg_table_name = 'objective_blueprints' then
    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Blueprint confirmer must be the owning customer';
    end if;
  elsif tg_table_name = 'brand_assets' then
    if coalesce(new.library_scope, 'CUSTOMER') <> 'CUSTOMER' then
      raise exception 'Unexpected brand asset library scope in tenant guard';
    end if;
    if new.reviewed_by is not null and new.reviewed_by <> new.user_id then
      raise exception 'Brand asset reviewer must be the owning customer';
    end if;
  elsif tg_table_name = 'automation_targets' then
    if not exists (
      select 1 from public.campaigns c
      where c.id = new.campaign_id
        and c.user_id = new.user_id
        and c.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Automation target campaign scope is invalid';
    end if;
    if new.ad_group_id is not null and not exists (
      select 1 from public.ad_groups ag
      where ag.id = new.ad_group_id
        and ag.campaign_id = new.campaign_id
        and ag.user_id = new.user_id
        and ag.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Automation target ad-set scope is invalid';
    end if;
    if new.ad_id is not null and not exists (
      select 1 from public.ads a
      where a.id = new.ad_id
        and a.ad_group_id = new.ad_group_id
        and a.user_id = new.user_id
        and a.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Automation target ad scope is invalid';
    end if;
  elsif tg_table_name = 'campaign_budget_limits' then
    if new.customer_confirmed_by <> new.user_id or not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Campaign budget limit policy or confirmer scope is invalid';
    end if;
    if new.campaign_id is not null and not exists (
      select 1 from public.campaigns c
      where c.id = new.campaign_id
        and c.user_id = new.user_id
        and c.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Campaign budget limit campaign scope is invalid';
    end if;
  elsif tg_table_name = 'daily_budget_exposure_snapshots' then
    if not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Exposure snapshot policy scope is invalid';
    end if;
  elsif tg_table_name = 'mutation_plans' then
    if not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation plan policy scope is invalid';
    end if;
    if new.automation_target_id is not null and not exists (
      select 1 from public.automation_targets target
      where target.id = new.automation_target_id
        and target.user_id = new.user_id
        and target.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation plan target scope is invalid';
    end if;
  elsif tg_table_name = 'mutation_plan_steps' then
    if not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation step plan scope is invalid';
    end if;
    if new.depends_on_step_id is not null and not exists (
      select 1 from public.mutation_plan_steps mps
      where mps.id = new.depends_on_step_id
        and mps.plan_id = new.plan_id
        and mps.user_id = new.user_id
        and mps.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation step dependency scope is invalid';
    end if;
  elsif tg_table_name = 'mutation_executions' then
    if not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation execution plan scope is invalid';
    end if;
  elsif tg_table_name = 'remote_object_bindings' then
    if not exists (
      select 1
      from public.mutation_plans mp
      join public.mutation_plan_steps mps
        on mps.id = new.step_id and mps.plan_id = mp.id
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
        and mps.user_id = new.user_id
        and mps.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Remote object binding plan or step scope is invalid';
    end if;
    if new.execution_id is not null and not exists (
      select 1 from public.mutation_executions me
      where me.id = new.execution_id
        and me.plan_id = new.plan_id
        and me.user_id = new.user_id
        and me.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Remote object binding execution scope is invalid';
    end if;
  elsif tg_table_name = 'daily_budget_exposures' then
    if not exists (
      select 1
      from public.automation_policies ap
      join public.daily_budget_exposure_snapshots s
        on s.id = new.snapshot_id and s.policy_id = ap.id
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
        and s.user_id = new.user_id
        and s.platform_account_id = new.platform_account_id
        and s.account_day = new.account_day
    ) then
      raise exception 'Daily exposure policy or snapshot scope is invalid';
    end if;
    if new.plan_id is not null and not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Daily exposure plan scope is invalid';
    end if;
    if new.automation_target_id is not null and not exists (
      select 1 from public.automation_targets target
      where target.id = new.automation_target_id
        and target.user_id = new.user_id
        and target.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Daily exposure target scope is invalid';
    end if;
  elsif tg_table_name = 'budget_mutation_ledger' then
    if not exists (
      select 1
      from public.mutation_plans mp
      join public.mutation_plan_steps mps
        on mps.id = new.step_id and mps.plan_id = mp.id
      join public.mutation_executions me
        on me.id = new.execution_id and me.plan_id = mp.id
      join public.automation_targets target
        on target.id = new.automation_target_id
      where mp.id = new.plan_id
        and mp.policy_id = new.policy_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
        and mps.user_id = new.user_id
        and mps.platform_account_id = new.platform_account_id
        and me.user_id = new.user_id
        and me.platform_account_id = new.platform_account_id
        and target.user_id = new.user_id
        and target.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Budget ledger execution scope is invalid';
    end if;
  elsif tg_table_name = 'mutation_audit_events' then
    if new.policy_id is not null and not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Audit policy scope is invalid';
    end if;
    if new.plan_id is not null and not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Audit plan scope is invalid';
    end if;
    if new.step_id is not null and not exists (
      select 1 from public.mutation_plan_steps mps
      where mps.id = new.step_id
        and mps.plan_id = new.plan_id
        and mps.user_id = new.user_id
        and mps.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Audit step scope is invalid';
    end if;
    if new.execution_id is not null and not exists (
      select 1 from public.mutation_executions me
      where me.id = new.execution_id
        and me.plan_id = new.plan_id
        and me.user_id = new.user_id
        and me.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Audit execution scope is invalid';
    end if;
  elsif tg_table_name = 'kill_switch_state' then
    if new.scope_type = 'PLAN' and not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Plan kill-switch scope is invalid';
    end if;
  elsif tg_table_name = 'automation_alerts' then
    if new.plan_id is not null and not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Automation alert plan scope is invalid';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_creative_asset_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nested IF so brand_profiles / creative_asset_jobs never touch library_scope.
  if tg_table_name = 'brand_assets' then
    if coalesce(new.library_scope, 'CUSTOMER') = 'INSPIRATION' then
      if new.platform_account_id is not null
        or new.brand_profile_id is not null
        or new.generation_job_id is not null then
        raise exception 'Inspiration vault asset must not bind Meta tenant scope';
      end if;
      return new;
    end if;
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = new.platform_account_id
      and pa.user_id = new.user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Creative asset account scope is invalid';
  end if;

  if tg_table_name = 'brand_profiles' then
    if new.previous_profile_id is not null and not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.previous_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Previous brand profile scope is invalid';
    end if;

    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Brand profile confirmer must be the owning customer';
    end if;
  elsif tg_table_name = 'creative_asset_jobs' then
    if not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.brand_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Creative asset job profile scope is invalid';
    end if;

    if new.result_asset_id is not null and not exists (
      select 1 from public.brand_assets ba
      where ba.id = new.result_asset_id
        and ba.user_id = new.user_id
        and ba.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Creative asset job result scope is invalid';
    end if;
  elsif tg_table_name = 'brand_assets' then
    if new.brand_profile_id is not null and not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.brand_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
        and bp.version = new.brand_policy_version
    ) then
      raise exception 'Brand asset profile scope is invalid';
    end if;

    if new.generation_job_id is not null and not exists (
      select 1 from public.creative_asset_jobs caj
      where caj.id = new.generation_job_id
        and caj.user_id = new.user_id
        and caj.platform_account_id = new.platform_account_id
        and caj.brand_profile_id = new.brand_profile_id
    ) then
      raise exception 'Brand asset generation job scope is invalid';
    end if;
  end if;

  return new;
end;
$$;

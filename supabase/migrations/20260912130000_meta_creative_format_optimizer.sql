-- Meta creative/format optimizer v1.
-- Additive only: creates tests inside an existing managed ACTIVE ad set, never
-- creates campaigns/ad sets and never changes budgets. Provider calls remain in
-- the existing service-role executor; this migration only materializes plans.

begin;

create table public.meta_creative_optimization_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null references public.platform_accounts(id) on delete restrict,
  policy_id uuid not null references public.automation_policies(id) on delete restrict,
  source_marketing_sync_id uuid not null,
  source_launch_plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  plan_id uuid not null unique references public.mutation_plans(id) on delete restrict,
  brand_profile_id uuid not null references public.brand_profiles(id) on delete restrict,
  ad_set_id uuid not null references public.ad_groups(id) on delete restrict,
  platform_ad_set_id text not null,
  baseline_ad_id uuid not null references public.ads(id) on delete restrict,
  platform_baseline_ad_id text not null,
  baseline_asset_id uuid not null references public.brand_assets(id) on delete restrict,
  candidate_asset_id uuid not null references public.brand_assets(id) on delete restrict,
  candidate_ad_id uuid references public.ads(id) on delete restrict,
  remote_creative_id text,
  remote_ad_id text,
  test_kind text not null check (test_kind in ('FORMAT', 'CREATIVE')),
  contract_marker text not null check (
    contract_marker = 'meta_existing_adset_creative_test_v1'
  ),
  test_family_key text not null unique,
  status text not null default 'PLANNED' check (
    status in (
      'PLANNED', 'ACTIVE_TEST', 'PAUSE_PLANNED',
      'COMPLETED', 'FAILED', 'CANCELLED'
    )
  ),
  started_at timestamptz,
  measurement_start_date date,
  measurement_end_date date,
  completed_at timestamptz,
  completion_reason text,
  decision_evidence jsonb,
  decision_evidence_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_creative_cycles_hash_check check (
    test_family_key ~ '^[0-9a-f]{64}$'
    and (
      decision_evidence_hash is null
      or decision_evidence_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  constraint meta_creative_cycles_evidence_check check (
    (decision_evidence is null) = (decision_evidence_hash is null)
    and (
      decision_evidence is null
      or jsonb_typeof(decision_evidence) = 'object'
    )
  ),
  constraint meta_creative_cycles_remote_ids_check check (
    (remote_creative_id is null or remote_creative_id ~ '^[1-9][0-9]{0,39}$')
    and (remote_ad_id is null or remote_ad_id ~ '^[1-9][0-9]{0,39}$')
  ),
  constraint meta_creative_cycles_active_result_check check (
    status not in ('ACTIVE_TEST', 'PAUSE_PLANNED', 'COMPLETED')
    or (
      candidate_ad_id is not null
      and remote_creative_id is not null
      and remote_ad_id is not null
      and started_at is not null
      and measurement_start_date is not null
      and measurement_end_date = measurement_start_date + 6
    )
  ),
  constraint meta_creative_cycles_completed_check check (
    status <> 'COMPLETED'
    or (
      completed_at is not null
      and decision_evidence is not null
      and decision_evidence_hash is not null
    )
  )
);

create unique index meta_creative_cycles_one_open_per_ad_set
  on public.meta_creative_optimization_cycles (platform_account_id, ad_set_id)
  where status in ('PLANNED', 'ACTIVE_TEST', 'PAUSE_PLANNED');

create index meta_creative_cycles_account_recent_idx
  on public.meta_creative_optimization_cycles (
    platform_account_id, ad_set_id, created_at desc
  );

create or replace function public.guard_meta_creative_optimization_cycle_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.policy_id is distinct from old.policy_id
    or new.source_marketing_sync_id is distinct from old.source_marketing_sync_id
    or new.source_launch_plan_id is distinct from old.source_launch_plan_id
    or new.plan_id is distinct from old.plan_id
    or new.brand_profile_id is distinct from old.brand_profile_id
    or new.ad_set_id is distinct from old.ad_set_id
    or new.platform_ad_set_id is distinct from old.platform_ad_set_id
    or new.baseline_ad_id is distinct from old.baseline_ad_id
    or new.platform_baseline_ad_id is distinct from old.platform_baseline_ad_id
    or new.baseline_asset_id is distinct from old.baseline_asset_id
    or new.candidate_asset_id is distinct from old.candidate_asset_id
    or new.test_kind is distinct from old.test_kind
    or new.contract_marker is distinct from old.contract_marker
    or new.test_family_key is distinct from old.test_family_key
    or new.created_at is distinct from old.created_at then
    raise exception 'Creative optimization cycle provenance is immutable';
  end if;

  if old.candidate_ad_id is not null
    and new.candidate_ad_id is distinct from old.candidate_ad_id then
    raise exception 'Creative optimization candidate ad result is immutable once set';
  end if;
  if old.remote_creative_id is not null
    and new.remote_creative_id is distinct from old.remote_creative_id then
    raise exception 'Creative optimization remote creative result is immutable once set';
  end if;
  if old.remote_ad_id is not null
    and new.remote_ad_id is distinct from old.remote_ad_id then
    raise exception 'Creative optimization remote ad result is immutable once set';
  end if;
  if old.measurement_start_date is not null
    and new.measurement_start_date is distinct from old.measurement_start_date then
    raise exception 'Creative optimization measurement start is immutable once set';
  end if;
  if old.measurement_end_date is not null
    and new.measurement_end_date is distinct from old.measurement_end_date then
    raise exception 'Creative optimization measurement end is immutable once set';
  end if;
  if old.decision_evidence is not null
    and (
      new.decision_evidence is distinct from old.decision_evidence
      or new.decision_evidence_hash is distinct from old.decision_evidence_hash
    ) then
    raise exception 'Creative optimization decision evidence is immutable once set';
  end if;

  return new;
end;
$$;

create trigger guard_meta_creative_optimization_cycle_update
  before update on public.meta_creative_optimization_cycles
  for each row execute function public.guard_meta_creative_optimization_cycle_update();

create or replace function public.sync_meta_creative_cycle_terminal_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and new.status in ('PREFLIGHT_FAILED', 'BLOCKED', 'FAILED', 'CANCELLED', 'STALE') then
    update public.meta_creative_optimization_cycles cycle
    set status = case when new.status = 'CANCELLED' then 'CANCELLED' else 'FAILED' end,
      completed_at = coalesce(new.terminal_at, now()),
      completion_reason = coalesce(new.blocked_reason, new.error_class, new.status),
      updated_at = now()
    where (
        cycle.plan_id = new.id
        and cycle.status = 'PLANNED'
      ) or (
        new.action_type = 'PAUSE'
        and cycle.id::text = new.planned_payload->>'optimization_cycle_id'
        and cycle.status = 'PAUSE_PLANNED'
      );
  end if;
  return new;
end;
$$;

create trigger sync_meta_creative_cycle_terminal_plan
  after update of status on public.mutation_plans
  for each row execute function public.sync_meta_creative_cycle_terminal_plan();

alter table public.meta_creative_optimization_cycles enable row level security;
revoke all on table public.meta_creative_optimization_cycles
  from public, anon, authenticated;
grant all on table public.meta_creative_optimization_cycles to service_role;
grant select (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_launch_plan_id, plan_id, brand_profile_id, ad_set_id,
  platform_ad_set_id, baseline_ad_id, platform_baseline_ad_id,
  baseline_asset_id, candidate_asset_id, candidate_ad_id,
  remote_creative_id, remote_ad_id, test_kind, contract_marker,
  test_family_key, status, started_at, measurement_start_date,
  measurement_end_date, completed_at, completion_reason,
  created_at, updated_at
) on public.meta_creative_optimization_cycles to authenticated;

create policy meta_creative_optimization_cycles_select_own
  on public.meta_creative_optimization_cycles
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.materialize_meta_creative_format_optimizer_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_baseline_ad_id uuid,
  p_candidate_asset_id uuid,
  p_test_kind text default 'CREATIVE',
  p_planned_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_baseline_ad public.ads%rowtype;
  v_ad_set public.ad_groups%rowtype;
  v_campaign public.campaigns%rowtype;
  v_baseline_target public.automation_targets%rowtype;
  v_ad_set_target public.automation_targets%rowtype;
  v_campaign_target public.automation_targets%rowtype;
  v_profile public.brand_profiles%rowtype;
  v_baseline_asset public.brand_assets%rowtype;
  v_candidate public.brand_assets%rowtype;
  v_launch_plan public.mutation_plans%rowtype;
  v_parent_launch_plan_id uuid;
  v_baseline_ad_binding public.remote_object_bindings%rowtype;
  v_baseline_creative_binding public.remote_object_bindings%rowtype;
  v_original_ad_request jsonb;
  v_original_creative_request jsonb;
  v_original_ad_set_request jsonb;
  v_ad_payload jsonb;
  v_creative_payload jsonb;
  v_image_reference jsonb;
  v_baseline_image_hash text;
  v_baseline_asset_id uuid;
  v_active_ad_count integer;
  v_kill_mode text;
  v_family_key text;
  v_existing_cycle public.meta_creative_optimization_cycles%rowtype;
  v_plan_id uuid := gen_random_uuid();
  v_cycle_id uuid := gen_random_uuid();
  v_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_step_upload uuid := gen_random_uuid();
  v_step_validate_creative uuid := gen_random_uuid();
  v_step_create_creative uuid := gen_random_uuid();
  v_step_read_creative uuid := gen_random_uuid();
  v_step_validate_ad uuid := gen_random_uuid();
  v_step_create_ad uuid := gen_random_uuid();
  v_step_read_paused uuid := gen_random_uuid();
  v_step_activate_ad uuid := gen_random_uuid();
  v_step_read_active uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_previous_step uuid;
  v_request jsonb;
  v_index integer := 0;
  v_has_upload boolean := false;
  v_kind text := upper(btrim(coalesce(p_test_kind, '')));
  v_name_suffix text;
begin
  if p_user_id is null or p_platform_account_id is null
    or p_source_marketing_sync_id is null or p_read_lease_token is null
    or p_baseline_ad_id is null or p_candidate_asset_id is null
    or p_planned_at is null or v_kind not in ('FORMAT', 'CREATIVE') then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_arguments');
  end if;

  if not exists (
    select 1
    from public.meta_account_operation_leases lease
    where lease.platform_account_id = p_platform_account_id
      and lease.user_id = p_user_id
      and lease.lease_kind = 'READ_SYNC'
      and lease.lease_token = p_read_lease_token
      and lease.expires_at > now()
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'read_lease_required');
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
  for update;

  if not found
    or v_account.marketing_sync_status <> 'success'
    or v_account.marketing_sync_id is distinct from p_source_marketing_sync_id
    or v_account.marketing_last_success_at is null
    or v_account.marketing_last_success_at < p_planned_at - interval '2 hours'
    or v_account.marketing_last_success_at > p_planned_at + interval '5 minutes'
    or v_account.marketing_currency is distinct from 'EUR'
    or not ('ads_management' = any(coalesce(v_account.meta_scopes, '{}'::text[])))
    or jsonb_typeof(v_account.ad_account_ids) <> 'array'
    or nullif(v_account.marketing_meta_ad_account_id, '') is null
    or pg_catalog.regexp_replace(v_account.marketing_meta_ad_account_id, '^act_', '')
      !~ '^[1-9][0-9]{0,39}$'
    or v_account.marketing_timezone_name is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names tz
      where tz.name = v_account.marketing_timezone_name
    )
    or not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(v_account.ad_account_ids) allowed(value)
      where pg_catalog.regexp_replace(allowed.value, '^act_', '')
        = pg_catalog.regexp_replace(v_account.marketing_meta_ad_account_id, '^act_', '')
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'current_meta_sync_or_permission_required');
  end if;

  -- An exact request replay is a read-only lookup and must remain stable after
  -- the first test has created a second active ad or completed terminally.
  select cycle.* into v_existing_cycle
  from public.meta_creative_optimization_cycles cycle
  where cycle.user_id = p_user_id
    and cycle.platform_account_id = p_platform_account_id
    and cycle.baseline_ad_id = p_baseline_ad_id
    and cycle.candidate_asset_id = p_candidate_asset_id
    and cycle.test_kind = v_kind
  order by cycle.created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'outcome', 'EXISTING', 'reason', 'idempotent_test_family',
      'cycle_id', v_existing_cycle.id, 'plan_id', v_existing_cycle.plan_id,
      'status', v_existing_cycle.status
    );
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
    and ap.currency = 'EUR'
    and ap.allow_new_launches
    and ap.allow_status_changes
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'active_launch_status_policy_required');
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;
  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'ALLOW' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'kill_switch_not_allow');
  end if;

  select a.* into v_baseline_ad
  from public.ads a
  where a.id = p_baseline_ad_id
    and a.user_id = p_user_id
    and a.platform_account_id = p_platform_account_id
    and a.is_current
    and a.last_seen_sync_id = v_account.marketing_sync_id
    and coalesce(a.effective_status, a.status) = 'ACTIVE'
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'baseline_ad_not_active_current');
  end if;

  select ag.* into v_ad_set
  from public.ad_groups ag
  where ag.id = v_baseline_ad.ad_group_id
    and ag.user_id = p_user_id
    and ag.platform_account_id = p_platform_account_id
    and ag.is_current
    and ag.last_seen_sync_id = v_account.marketing_sync_id
    and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'parent_ad_set_not_active_current');
  end if;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_ad_set.campaign_id
    and c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
    and c.last_seen_sync_id = v_account.marketing_sync_id
    and coalesce(c.effective_status, c.status) = 'ACTIVE'
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'parent_campaign_not_active_current');
  end if;
  if v_campaign.objective not in ('OUTCOME_TRAFFIC', 'LINK_CLICKS')
    or v_ad_set.optimization_goal is distinct from 'LINK_CLICKS' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'traffic_link_clicks_only_v1');
  end if;

  select target.* into v_baseline_target
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'AD'
    and target.ad_id = v_baseline_ad.id
    and target.ad_group_id = v_ad_set.id
    and target.campaign_id = v_campaign.id
    and target.platform_object_id = v_baseline_ad.platform_ad_id
    and target.status = 'MANAGED'
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'baseline_ad_not_managed');
  end if;

  select target.* into v_ad_set_target
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'AD_SET'
    and target.ad_group_id = v_ad_set.id
    and target.campaign_id = v_campaign.id
    and target.platform_object_id = v_ad_set.platform_ad_group_id
    and target.status = 'MANAGED'
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'parent_ad_set_not_managed');
  end if;

  select target.* into v_campaign_target
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'CAMPAIGN'
    and target.campaign_id = v_campaign.id
    and target.platform_object_id = v_campaign.platform_campaign_id
    and target.status = 'MANAGED'
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'parent_campaign_not_managed');
  end if;

  select count(*)::integer into v_active_ad_count
  from public.ads a
  where a.ad_group_id = v_ad_set.id
    and a.user_id = p_user_id
    and a.platform_account_id = p_platform_account_id
    and a.is_current
    and a.last_seen_sync_id = v_account.marketing_sync_id
    and coalesce(a.effective_status, a.status) = 'ACTIVE';
  if v_active_ad_count <> 1 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'single_active_baseline_required');
  end if;

  -- The baseline must be the reconciled AD binding of a successful Adbot launch.
  select mp.*
    into v_launch_plan
  from public.remote_object_bindings binding
  join public.mutation_plans mp on mp.id = binding.plan_id
  join public.mutation_plan_steps step
    on step.id = binding.step_id and step.plan_id = mp.id
  where binding.user_id = p_user_id
    and binding.platform_account_id = p_platform_account_id
    and binding.object_type = 'AD'
    and binding.remote_object_id = v_baseline_ad.platform_ad_id
    and binding.local_ad_id = v_baseline_ad.id
    and binding.reconciled_at is not null
    and mp.status = 'SUCCEEDED'
    and mp.action_type in ('LAUNCH_CHAIN', 'LAUNCH_AD')
    and step.operation = 'CREATE'
    and step.object_type = 'AD'
    and step.planned_request->>'operation' = 'CREATE_AD'
  order by mp.terminal_at desc nulls last, mp.created_at desc
  limit 1;
  if v_launch_plan.id is null then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'baseline_not_adbot_launch');
  end if;

  v_parent_launch_plan_id := v_launch_plan.id;
  if v_launch_plan.source_rule_key = 'meta_creative_format_optimizer_v1'
    and v_launch_plan.planned_payload->>'contract'
      = 'meta_existing_adset_creative_test_v1' then
    begin
      v_parent_launch_plan_id :=
        (v_launch_plan.planned_payload->>'source_launch_plan_id')::uuid;
    exception when others then
      return jsonb_build_object(
        'outcome', 'BLOCKED', 'reason', 'optimizer_parent_launch_missing'
      );
    end;
    if not exists (
      select 1 from public.mutation_plans root_plan
      where root_plan.id = v_parent_launch_plan_id
        and root_plan.user_id = p_user_id
        and root_plan.platform_account_id = p_platform_account_id
        and root_plan.status = 'SUCCEEDED'
        and root_plan.action_type in ('LAUNCH_CHAIN', 'LAUNCH_AD')
    ) then
      return jsonb_build_object(
        'outcome', 'BLOCKED', 'reason', 'optimizer_parent_launch_missing'
      );
    end if;
  end if;

  if exists (
    select 1
    from public.mutation_plans root_plan
    where root_plan.id = v_parent_launch_plan_id
      and root_plan.user_id = p_user_id
      and root_plan.platform_account_id = p_platform_account_id
      and (
        root_plan.source_rule_key = 'organic-boost'
        or root_plan.planned_payload->>'launch_kind' = 'ORGANIC_BOOST'
      )
  ) or exists (
    select 1
    from public.meta_organic_boost_links link
    join public.remote_object_bindings campaign_binding
      on campaign_binding.plan_id = link.plan_id
     and campaign_binding.user_id = link.user_id
     and campaign_binding.platform_account_id = link.platform_account_id
    where link.user_id = p_user_id
      and link.platform_account_id = p_platform_account_id
      and campaign_binding.object_type = 'CAMPAIGN'
      and campaign_binding.remote_object_id = v_campaign.platform_campaign_id
  ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'organic_boost_creative_test_forbidden'
    );
  end if;

  select binding.* into v_baseline_ad_binding
  from public.remote_object_bindings binding
  join public.mutation_plan_steps step
    on step.id = binding.step_id and step.plan_id = binding.plan_id
  where binding.plan_id = v_launch_plan.id
    and binding.user_id = p_user_id
    and binding.platform_account_id = p_platform_account_id
    and binding.object_type = 'AD'
    and binding.remote_object_id = v_baseline_ad.platform_ad_id
    and binding.local_ad_id = v_baseline_ad.id
    and binding.reconciled_at is not null
    and step.operation = 'CREATE'
    and step.object_type = 'AD'
    and step.planned_request->>'operation' = 'CREATE_AD'
  order by binding.bound_at desc
  limit 1;

  select binding.* into v_baseline_creative_binding
  from public.remote_object_bindings binding
  join public.mutation_plan_steps step
    on step.id = binding.step_id and step.plan_id = binding.plan_id
  where binding.plan_id = v_launch_plan.id
    and binding.user_id = p_user_id
    and binding.platform_account_id = p_platform_account_id
    and binding.object_type = 'CREATIVE'
    and binding.remote_object_id = v_baseline_ad.platform_creative_id
    and binding.local_creative_id = v_baseline_ad.creative_id
    and binding.reconciled_at is not null
    and step.operation = 'CREATE'
    and step.object_type = 'CREATIVE'
    and step.planned_request->>'operation' = 'CREATE_CREATIVE'
  order by binding.bound_at desc
  limit 1;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'baseline_creative_provenance_missing');
  end if;

  select step.planned_request into v_original_ad_request
  from public.mutation_plan_steps step
  where step.id = v_baseline_ad_binding.step_id;
  select step.planned_request into v_original_creative_request
  from public.mutation_plan_steps step
  where step.id = v_baseline_creative_binding.step_id;
  select step.planned_request into v_original_ad_set_request
  from public.remote_object_bindings binding
  join public.mutation_plan_steps step on step.id = binding.step_id
  where binding.plan_id = v_parent_launch_plan_id
    and binding.object_type = 'AD_SET'
    and binding.remote_object_id = v_ad_set.platform_ad_group_id
    and binding.reconciled_at is not null
    and step.operation = 'CREATE'
    and step.object_type = 'AD_SET'
    and step.planned_request->>'operation' = 'CREATE_AD_SET'
  order by binding.bound_at desc
  limit 1;

  v_creative_payload := v_original_creative_request->'payload';
  v_ad_payload := v_original_ad_request->'payload';
  if jsonb_typeof(v_creative_payload) <> 'object'
    or jsonb_typeof(v_ad_payload) <> 'object'
    or jsonb_typeof(v_original_ad_set_request->'payload') <> 'object' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'baseline_launch_payload_missing');
  end if;
  if jsonb_typeof(v_creative_payload->'asset_feed_spec') = 'object'
    or jsonb_typeof(v_creative_payload#>'{object_story_spec,video_data}') = 'object'
    or jsonb_typeof(v_creative_payload#>'{object_story_spec,link_data,child_attachments}') = 'array'
    or coalesce((v_original_ad_set_request#>>'{payload,is_dynamic_creative}')::boolean, false) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'dynamic_creative_not_supported');
  end if;

  begin
    v_baseline_asset_id := coalesce(
      (v_launch_plan.planned_payload->>'candidate_asset_id')::uuid,
      (v_launch_plan.planned_payload->'brand_asset_ids'->>0)::uuid
    );
  exception when others then
    v_baseline_asset_id := null;
  end;
  select asset.* into v_baseline_asset
  from public.brand_assets asset
  where asset.id = v_baseline_asset_id
    and asset.user_id = p_user_id
    and asset.platform_account_id = p_platform_account_id
    and asset.library_scope = 'CUSTOMER';
  if not found
    or v_baseline_asset.source_type not in ('UPLOADED', 'GENERATED')
    or v_baseline_asset.asset_role not in ('LOCKED_PHOTO', 'UPLOAD_EDITABLE', 'GENERATED')
    or v_baseline_asset.status <> 'READY'
    or v_baseline_asset.moderation_status <> 'APPROVED'
    or v_baseline_asset.reviewed_at is null
    or v_baseline_asset.mime_type not in ('image/jpeg', 'image/png') then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'baseline_asset_provenance_missing');
  end if;

  begin
    select bp.* into v_profile
    from public.brand_profiles bp
    where bp.id = (v_launch_plan.planned_payload->>'brand_profile_id')::uuid
      and bp.user_id = p_user_id
      and bp.platform_account_id = p_platform_account_id
      and bp.status = 'ACTIVE'
    for update;
  exception when others then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'active_launch_brand_profile_required');
  end;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'active_launch_brand_profile_required');
  end if;

  select asset.* into v_candidate
  from public.brand_assets asset
  where asset.id = p_candidate_asset_id
    and asset.user_id = p_user_id
    and asset.platform_account_id = p_platform_account_id
    and asset.brand_profile_id = v_profile.id
    and asset.source_type in ('UPLOADED', 'GENERATED')
    and asset.asset_role in ('LOCKED_PHOTO', 'UPLOAD_EDITABLE', 'GENERATED')
    and asset.library_scope = 'CUSTOMER'
    and asset.status = 'READY'
    and asset.moderation_status = 'APPROVED'
    and asset.reviewed_at is not null
    and asset.mime_type in ('image/jpeg', 'image/png')
  for update;
  if not found
    or v_candidate.sha256 !~ '^[0-9a-f]{64}$'
    or v_candidate.sha256 = v_baseline_asset.sha256
    or (
      nullif(v_candidate.meta_image_hash, '') is null
      and (
        nullif(v_candidate.storage_bucket, '') is null
        or nullif(v_candidate.storage_path, '') is null
        or v_candidate.byte_size is null
        or v_candidate.byte_size <= 0
      )
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'candidate_asset_not_eligible');
  end if;

  v_baseline_image_hash := coalesce(
    v_creative_payload#>>'{object_story_spec,link_data,image_hash}',
    v_creative_payload->>'image_hash'
  );
  if nullif(v_candidate.meta_image_hash, '') is not null
    and v_candidate.meta_image_hash = v_baseline_image_hash then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'candidate_image_matches_baseline');
  end if;

  v_family_key := public.meta_sha256(
    'meta_existing_adset_creative_test_v1|'
    || p_user_id::text || '|' || p_platform_account_id::text || '|'
    || v_ad_set.id::text || '|' || v_baseline_ad.id::text || '|'
    || v_candidate.id::text || '|' || v_kind
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':creative-optimizer:' || v_ad_set.id::text,
      0
    )
  );

  -- Replays remain stable across sync IDs; every mutable safety check above was
  -- intentionally repeated before returning the original family.
  select cycle.* into v_existing_cycle
  from public.meta_creative_optimization_cycles cycle
  where cycle.test_family_key = v_family_key;
  if found then
    return jsonb_build_object(
      'outcome', 'EXISTING', 'reason', 'idempotent_test_family',
      'cycle_id', v_existing_cycle.id, 'plan_id', v_existing_cycle.plan_id,
      'status', v_existing_cycle.status
    );
  end if;

  if exists (
    select 1
    from public.meta_creative_optimization_cycles cycle
    join public.brand_assets prior_candidate
      on prior_candidate.id = cycle.candidate_asset_id
    join public.brand_assets prior_baseline
      on prior_baseline.id = cycle.baseline_asset_id
    where cycle.platform_account_id = p_platform_account_id
      and cycle.ad_set_id = v_ad_set.id
      and (
        cycle.candidate_asset_id = v_candidate.id
        or cycle.baseline_asset_id = v_candidate.id
        or prior_candidate.sha256 = v_candidate.sha256
        or prior_baseline.sha256 = v_candidate.sha256
      )
  ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'candidate_asset_already_tested'
    );
  end if;

  if exists (
      select 1
      from public.meta_creative_optimization_cycles cycle
      where cycle.platform_account_id = p_platform_account_id
        and cycle.ad_set_id = v_ad_set.id
        and cycle.status in ('PLANNED', 'ACTIVE_TEST')
    ) or exists (
      select 1
      from public.mutation_plans mp
      where mp.platform_account_id = p_platform_account_id
        and mp.source_rule_key = 'meta_creative_format_optimizer_v1'
        and mp.status in (
          'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
          'RETRYABLE', 'COMPENSATION_REQUIRED'
        )
        and (
          mp.target_key = v_ad_set_target.target_key
          or mp.planned_payload->>'platform_ad_set_id' = v_ad_set.platform_ad_group_id
        )
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'optimizer_already_open_for_ad_set');
  end if;

  if coalesce(v_ad_set_target.last_successful_mutation_at, '-infinity'::timestamptz)
       > p_planned_at - interval '12 hours'
    or exists (
      select 1
      from public.meta_creative_optimization_cycles cycle
      where cycle.platform_account_id = p_platform_account_id
        and cycle.ad_set_id = v_ad_set.id
        and greatest(
          cycle.created_at,
          coalesce(cycle.started_at, '-infinity'::timestamptz),
          coalesce(cycle.completed_at, '-infinity'::timestamptz)
        ) > p_planned_at - interval '12 hours'
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'ad_set_cooldown');
  end if;

  if v_candidate.meta_image_hash is null then
    v_has_upload := true;
    v_image_reference := jsonb_build_object('$binding_step_id', v_step_upload);
  else
    v_image_reference := pg_catalog.to_jsonb(v_candidate.meta_image_hash);
  end if;

  v_name_suffix := ' [mcf-' || substr(v_family_key, 1, 12) || ']';
  v_creative_payload := v_creative_payload - 'id' - 'asset_feed_spec';
  v_creative_payload := jsonb_set(
    v_creative_payload, '{name}',
    pg_catalog.to_jsonb(left(coalesce(nullif(v_creative_payload->>'name', ''), 'Adbot Creative Test'), 220) || v_name_suffix),
    true
  );
  if jsonb_typeof(v_creative_payload#>'{object_story_spec,link_data}') = 'object' then
    v_creative_payload := jsonb_set(
      v_creative_payload, '{object_story_spec,link_data}',
      ((v_creative_payload #> array['object_story_spec', 'link_data']::text[])
        - 'picture'::text - 'image_url'::text)
        || jsonb_build_object('image_hash', v_image_reference),
      true
    );
  elsif v_creative_payload ? 'image_hash' then
    v_creative_payload := jsonb_set(v_creative_payload, '{image_hash}', v_image_reference, true);
  else
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'unsupported_baseline_creative_payload');
  end if;

  v_ad_payload := v_ad_payload - 'id' - 'adset_id' - 'creative' - 'status' - 'name'
    || jsonb_build_object(
      'name', left(coalesce(nullif(v_ad_payload->>'name', ''), 'Adbot Ad Test'), 220) || v_name_suffix,
      'adset_id', v_ad_set.platform_ad_group_id,
      'creative', jsonb_build_object(
        'creative_id', jsonb_build_object('$binding_step_id', v_step_create_creative)
      ),
      'status', 'PAUSED'
    );

  if (v_creative_payload || v_ad_payload)::text ~* '\"(daily_budget|lifetime_budget|budget|bid_amount|bid_strategy)\"[[:space:]]*:' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'budget_fields_forbidden');
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'contract', 'meta_existing_adset_creative_test_v1',
    'test_family_key', v_family_key,
    'test_kind', v_kind,
    'source_launch_plan_id', v_parent_launch_plan_id,
    'brand_profile_id', v_profile.id,
    'baseline_ad_id', v_baseline_ad.id,
    'baseline_platform_ad_id', v_baseline_ad.platform_ad_id,
    'baseline_asset_id', v_baseline_asset.id,
    'candidate_asset_id', v_candidate.id,
    'platform_campaign_id', v_campaign.platform_campaign_id,
    'platform_ad_set_id', v_ad_set.platform_ad_group_id,
    'source_marketing_sync_id', v_account.marketing_sync_id,
    'meta_ad_account_id', pg_catalog.regexp_replace(
      v_account.marketing_meta_ad_account_id, '^act_', ''
    ),
    'account_timezone_name', v_account.marketing_timezone_name,
    'max_active_ads', 3,
    'campaign_effective_status', coalesce(v_campaign.effective_status, v_campaign.status),
    'ad_set_effective_status', coalesce(v_ad_set.effective_status, v_ad_set.status),
    'campaign_daily_budget_minor', v_campaign.daily_budget_minor,
    'campaign_lifetime_budget_minor', v_campaign.lifetime_budget_minor,
    'ad_set_daily_budget_minor', v_ad_set.daily_budget_minor,
    'ad_set_lifetime_budget_minor', v_ad_set.lifetime_budget_minor,
    'active_ad_count_before', v_active_ad_count,
    'creative', v_creative_payload,
    'ad', v_ad_payload
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := v_family_key;

  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
    source_rule_key, source_rule_version, action_type, target_type, target_key,
    campaign_scope_key, budget_owner_key, automation_target_id, idempotency_key,
    expected_before, intended_after, planned_payload, payload_hash,
    status, priority, safety_action, not_before, max_attempts, created_at, updated_at
  ) values (
    v_plan_id, p_user_id, p_platform_account_id, v_policy.id,
    v_account.marketing_sync_id, 'meta_creative_format_optimizer_v1', 1,
    'LAUNCH_AD', 'AD_SET', v_ad_set_target.target_key,
    v_ad_set_target.campaign_scope_key, null, v_ad_set_target.id,
    v_idempotency_key,
    jsonb_build_object(
      'status', 'ACTIVE',
      'source_marketing_sync_id', v_account.marketing_sync_id,
      'meta_ad_account_id', pg_catalog.regexp_replace(
        v_account.marketing_meta_ad_account_id, '^act_', ''
      ),
      'platform_ad_set_id', v_ad_set.platform_ad_group_id,
      'baseline_ad_id', v_baseline_ad.id,
      'active_ad_count', v_active_ad_count,
      'contract', 'meta_existing_adset_creative_test_v1',
      'platform_campaign_id', v_campaign.platform_campaign_id,
      'baseline_platform_ad_id', v_baseline_ad.platform_ad_id,
      'campaign_effective_status', coalesce(v_campaign.effective_status, v_campaign.status),
      'ad_set_effective_status', coalesce(v_ad_set.effective_status, v_ad_set.status),
      'campaign_daily_budget_minor', v_campaign.daily_budget_minor,
      'campaign_lifetime_budget_minor', v_campaign.lifetime_budget_minor,
      'ad_set_daily_budget_minor', v_ad_set.daily_budget_minor,
      'ad_set_lifetime_budget_minor', v_ad_set.lifetime_budget_minor
    ),
    jsonb_build_object(
      'status', 'ACTIVE', 'new_ad_count', 1,
      'platform_ad_set_id', v_ad_set.platform_ad_group_id,
      'budget_unchanged', true
    ),
    v_payload, v_payload_hash, 'PENDING', 52, false,
    p_planned_at, 3, p_planned_at, p_planned_at
  );

  if v_has_upload then
    v_request := jsonb_build_object(
      'operation', 'UPLOAD_IMAGE', 'object_type', 'IMAGE',
      'brand_asset_id', v_candidate.id, 'asset_sha256', v_candidate.sha256
    );
    insert into public.mutation_plan_steps (
      id, plan_id, user_id, platform_account_id, step_index, step_key,
      operation, object_type, depends_on_step_id, planned_request,
      request_hash, expected_result, compensation_operation, status
    ) values (
      v_step_upload, v_plan_id, p_user_id, p_platform_account_id, v_index,
      'upload-candidate-image', 'CREATE', 'IMAGE', null, v_request,
      public.meta_sha256(v_request::text),
      jsonb_build_object('asset_sha256', v_candidate.sha256), 'NONE', 'PENDING'
    );
    v_previous_step := v_step_upload;
    v_index := v_index + 1;
  end if;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
    'mode', 'validate_only', 'payload', v_creative_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_validate_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-test-creative', 'VALIDATE', 'CREATIVE', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_validate_creative; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
    'mode', 'execute', 'payload', v_creative_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_create_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-test-creative', 'CREATE', 'CREATIVE', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('created', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_create_creative; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'CREATIVE',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_creative)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_creative, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-test-creative', 'READ', 'CREATIVE', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('created', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_creative; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD', 'object_type', 'AD',
    'mode', 'validate_only', 'payload', v_ad_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_validate_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'validate-test-ad-paused', 'VALIDATE', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_validate_ad; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'CREATE_AD', 'object_type', 'AD',
    'mode', 'execute', 'payload', v_ad_payload
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_create_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'create-test-ad-paused', 'CREATE', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'PAUSED'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_create_ad; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad)
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_paused, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-test-ad-paused', 'READ', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
  );
  v_previous_step := v_step_read_paused; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad),
    'status', 'ACTIVE', 'mode', 'execute'
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_activate_ad, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'activate-test-ad', 'UPDATE', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_activate_ad; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'READ', 'object_type', 'AD',
    'object_id', jsonb_build_object('$binding_step_id', v_step_create_ad),
    'expected_status', 'ACTIVE'
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_read_active, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'read-test-ad-active', 'READ', 'AD', v_previous_step,
    v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
  );
  v_previous_step := v_step_read_active; v_index := v_index + 1;

  v_request := jsonb_build_object(
    'operation', 'RECONCILE', 'object_type', 'AD',
    'expected_status', 'ACTIVE',
    'contract', 'meta_existing_adset_creative_test_v1',
    'platform_ad_set_id', v_ad_set.platform_ad_group_id
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id,
    v_index, 'reconcile-existing-adset-creative-test', 'RECONCILE', 'AD',
    v_previous_step, v_request, public.meta_sha256(v_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'), 'PAUSE', 'PENDING'
  );

  insert into public.meta_creative_optimization_cycles (
    id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
    source_launch_plan_id, plan_id, brand_profile_id, ad_set_id,
    platform_ad_set_id, baseline_ad_id, platform_baseline_ad_id,
    baseline_asset_id, candidate_asset_id, test_kind, contract_marker,
    test_family_key, status, created_at, updated_at
  ) values (
    v_cycle_id, p_user_id, p_platform_account_id, v_policy.id,
    v_account.marketing_sync_id, v_parent_launch_plan_id, v_plan_id, v_profile.id,
    v_ad_set.id, v_ad_set.platform_ad_group_id, v_baseline_ad.id,
    v_baseline_ad.platform_ad_id, v_baseline_asset.id, v_candidate.id,
    v_kind, 'meta_existing_adset_creative_test_v1', v_family_key,
    'PLANNED', p_planned_at, p_planned_at
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, v_policy.id, v_plan_id,
    null, null, 'SYSTEM', 'meta-creative-format-optimizer',
    'META_CREATIVE_OPTIMIZER_PLAN_MATERIALIZED',
    jsonb_build_object(
      'baseline_ad_id', v_baseline_ad.id,
      'platform_ad_set_id', v_ad_set.platform_ad_group_id,
      'active_ad_count', v_active_ad_count
    ),
    jsonb_build_object(
      'candidate_asset_id', v_candidate.id, 'test_kind', v_kind,
      'contract_marker', 'meta_existing_adset_creative_test_v1'
    ),
    '{}'::jsonb,
    jsonb_build_object('plan_status', 'PENDING', 'cycle_status', 'PLANNED'),
    jsonb_build_object(
      'cycle_id', v_cycle_id, 'test_family_key', v_family_key,
      'budget_unchanged', true
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED', 'reason', 'safe_existing_adset_creative_test',
    'plan_id', v_plan_id, 'cycle_id', v_cycle_id,
    'idempotency_key', v_idempotency_key, 'test_kind', v_kind,
    'step_count', v_index + 1
  );
end;
$$;

revoke all on function public.materialize_meta_creative_format_optimizer_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_meta_creative_format_optimizer_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz
) to service_role;

comment on function public.materialize_meta_creative_format_optimizer_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz
) is 'Atomically materializes one idempotent Creative/Format test ad inside an existing ACTIVE MANAGED Meta ad set; never creates parents or changes budget.';

-- Specialized reconciler: unlike launch-chain reconciliation it never creates or
-- updates campaign/ad-set projections and never assumes a launch budget chain.
create or replace function public.reconcile_meta_creative_format_optimizer_plan(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid
)
returns table (
  outcome text,
  plan_id uuid,
  ledger_id uuid,
  snapshot_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_cycle public.meta_creative_optimization_cycles%rowtype;
  v_ad_set public.ad_groups%rowtype;
  v_creative_binding public.remote_object_bindings%rowtype;
  v_ad_binding public.remote_object_bindings%rowtype;
  v_creative_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_ad_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_mutate_step public.mutation_plan_steps%rowtype;
  v_creative_id uuid;
  v_ad_id uuid;
  v_ad_target_id uuid;
  v_creative_count integer;
  v_ad_count integer;
  v_parent_binding_count integer;
  v_matches boolean := false;
  v_mismatch_reason text := 'optimizer_remote_state_mismatch';
begin
  select me.* into v_execution
  from public.mutation_executions me
  where me.id = p_execution_id
    and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then raise exception 'Active Meta execution is required'; end if;

  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = v_execution.plan_id
    and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
    and mp.action_type = 'LAUNCH_AD'
    and mp.source_rule_key = 'meta_creative_format_optimizer_v1'
    and mp.planned_payload->>'contract' = 'meta_existing_adset_creative_test_v1'
  for update;
  if not found then raise exception 'Active creative optimizer plan is required'; end if;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.operation = 'RECONCILE'
    and mps.step_key = 'reconcile-existing-adset-creative-test'
    and mps.status in ('CLAIMED', 'RUNNING', 'RETRYABLE') for update;
  if not found then raise exception 'Claimed creative optimizer reconcile step is required'; end if;

  select cycle.* into v_cycle from public.meta_creative_optimization_cycles cycle
  where cycle.plan_id = v_plan.id and cycle.user_id = v_plan.user_id
    and cycle.platform_account_id = v_plan.platform_account_id
    and cycle.status = 'PLANNED'
    and cycle.contract_marker = 'meta_existing_adset_creative_test_v1' for update;
  if not found then raise exception 'Planned creative optimization cycle is required'; end if;

  select ag.* into v_ad_set from public.ad_groups ag
  join public.automation_targets target on target.ad_group_id = ag.id
    and target.target_type = 'AD_SET' and target.status = 'MANAGED'
    and target.platform_object_id = ag.platform_ad_group_id
  where ag.id = v_cycle.ad_set_id and ag.user_id = v_plan.user_id
    and ag.platform_account_id = v_plan.platform_account_id and ag.is_current
    and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
    and ag.platform_ad_group_id = v_cycle.platform_ad_set_id for update of ag;
  if not found then raise exception 'Existing ACTIVE MANAGED ad set is required'; end if;

  select count(*)::integer into v_creative_count
  from public.remote_object_bindings creative_binding
  where creative_binding.plan_id = v_plan.id
    and creative_binding.object_type = 'CREATIVE';
  select count(*)::integer into v_ad_count
  from public.remote_object_bindings ad_binding
  where ad_binding.plan_id = v_plan.id
    and ad_binding.object_type = 'AD';
  select count(*)::integer into v_parent_binding_count
  from public.remote_object_bindings parent_binding
  where parent_binding.plan_id = v_plan.id
    and parent_binding.object_type in ('CAMPAIGN', 'AD_SET');
  select binding.* into v_creative_binding from public.remote_object_bindings binding
  join public.mutation_plan_steps create_step on create_step.id = binding.step_id
    and create_step.step_key = 'create-test-creative' and create_step.operation = 'CREATE'
  where binding.plan_id = v_plan.id and binding.object_type = 'CREATIVE';
  select binding.* into v_ad_binding from public.remote_object_bindings binding
  join public.mutation_plan_steps create_step on create_step.id = binding.step_id
    and create_step.step_key = 'create-test-ad-paused' and create_step.operation = 'CREATE'
  where binding.plan_id = v_plan.id and binding.object_type = 'AD';
  if v_creative_count <> 1 or v_ad_count <> 1 or v_parent_binding_count <> 0
    or v_creative_binding.id is null or v_ad_binding.id is null
    or v_creative_binding.remote_object_id !~ '^[1-9][0-9]{0,39}$'
    or v_ad_binding.remote_object_id !~ '^[1-9][0-9]{0,39}$' then
    raise exception 'Exactly one new creative/ad binding and no parent bindings are required';
  end if;

  select snapshot.* into v_creative_snapshot from public.meta_mutation_remote_snapshots snapshot
  join public.mutation_plan_steps read_step on read_step.id = snapshot.step_id
  where snapshot.plan_id = v_plan.id and snapshot.object_type = 'CREATIVE'
    and snapshot.remote_object_id = v_creative_binding.remote_object_id
    and snapshot.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
    and read_step.step_key = 'read-test-creative'
  order by read_step.step_index desc, snapshot.observed_at desc limit 1;
  select snapshot.* into v_ad_snapshot from public.meta_mutation_remote_snapshots snapshot
  join public.mutation_plan_steps read_step on read_step.id = snapshot.step_id
  where snapshot.plan_id = v_plan.id and snapshot.object_type = 'AD'
    and snapshot.remote_object_id = v_ad_binding.remote_object_id
    and snapshot.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
    and read_step.step_key = 'read-test-ad-active'
  order by read_step.step_index desc, snapshot.observed_at desc limit 1;
  v_matches := v_creative_snapshot.id is not null and v_ad_snapshot.id is not null
    and v_creative_snapshot.snapshot_payload->>'id' = v_creative_binding.remote_object_id
    and v_ad_snapshot.snapshot_payload->>'id' = v_ad_binding.remote_object_id
    and (v_ad_snapshot.snapshot_payload->>'status' = 'ACTIVE'
      or v_ad_snapshot.snapshot_payload->>'effective_status' = 'ACTIVE')
    and v_ad_snapshot.snapshot_payload->>'adset_id' = v_cycle.platform_ad_set_id
    and coalesce(v_ad_snapshot.snapshot_payload#>>'{creative,id}',
      v_ad_snapshot.snapshot_payload->>'creative_id') = v_creative_binding.remote_object_id;

  if not v_matches then
    return query select 'MISMATCH'::text, v_plan.id, null::uuid, v_ad_snapshot.id;
    return;
  end if;

  insert into public.creatives (user_id, platform_account_id, platform_creative_id,
    source, name, type, content, generated_by_ai, object_type, platform_status,
    last_seen_at, last_seen_sync_id, is_current, updated_at)
  values (v_plan.user_id, v_plan.platform_account_id, v_creative_binding.remote_object_id,
    'meta', coalesce(v_creative_snapshot.snapshot_payload->>'name',
    v_plan.planned_payload#>>'{creative,name}'), 'image', v_creative_snapshot.snapshot_payload,
    false, coalesce(v_creative_snapshot.snapshot_payload->>'object_type', 'IMAGE'),
    v_creative_snapshot.snapshot_payload->>'status', now(), v_plan.source_marketing_sync_id, true, now())
  on conflict (platform_account_id, platform_creative_id) where source = 'meta'
  do update set name = excluded.name, content = excluded.content, last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id, is_current = true, updated_at = now()
  returning id into v_creative_id;

  insert into public.ads (user_id, platform_account_id, ad_group_id, platform_ad_id,
    name, status, effective_status, creative_id, platform_creative_id,
    last_seen_at, last_seen_sync_id, is_current, updated_at)
  values (v_plan.user_id, v_plan.platform_account_id, v_ad_set.id,
    v_ad_binding.remote_object_id, coalesce(v_ad_snapshot.snapshot_payload->>'name',
    v_plan.planned_payload#>>'{ad,name}'), coalesce(v_ad_snapshot.snapshot_payload->>'status', 'ACTIVE'),
    coalesce(v_ad_snapshot.snapshot_payload->>'effective_status',
    v_ad_snapshot.snapshot_payload->>'status', 'ACTIVE'), v_creative_id,
    v_creative_binding.remote_object_id, now(), v_plan.source_marketing_sync_id, true, now())
  on conflict (platform_account_id, platform_ad_id)
  do update set ad_group_id = excluded.ad_group_id, name = excluded.name, status = excluded.status,
    effective_status = excluded.effective_status, creative_id = excluded.creative_id,
    platform_creative_id = excluded.platform_creative_id, last_seen_at = excluded.last_seen_at,
    last_seen_sync_id = excluded.last_seen_sync_id, is_current = true, updated_at = now()
  returning id into v_ad_id;

  insert into public.automation_targets (user_id, platform_account_id, target_type,
    target_key, platform_object_id, campaign_scope_key, campaign_id, ad_group_id, ad_id,
    status, last_successful_mutation_at, last_reconciled_at, updated_at)
  values (v_plan.user_id, v_plan.platform_account_id, 'AD', 'ad:' || v_ad_binding.remote_object_id,
    v_ad_binding.remote_object_id, v_plan.campaign_scope_key, v_ad_set.campaign_id,
    v_ad_set.id, v_ad_id, 'MANAGED', now(), now(), now())
  on conflict (platform_account_id, target_type, platform_object_id)
  do update set ad_group_id = excluded.ad_group_id, ad_id = excluded.ad_id,
    status = 'MANAGED', last_successful_mutation_at = now(), last_reconciled_at = now(),
    row_version = public.automation_targets.row_version + 1, updated_at = now()
  returning id into v_ad_target_id;

  update public.remote_object_bindings set local_creative_id = v_creative_id, reconciled_at = now()
  where id = v_creative_binding.id;
  update public.remote_object_bindings set local_campaign_id = v_ad_set.campaign_id,
    local_ad_group_id = v_ad_set.id, local_creative_id = v_creative_id,
    local_ad_id = v_ad_id, reconciled_at = now() where id = v_ad_binding.id;
  update public.remote_object_bindings image_binding set reconciled_at = now()
  where image_binding.plan_id = v_plan.id
    and image_binding.object_type = 'IMAGE'
    and image_binding.reconciled_at is null;
  select mutate_step.* into v_mutate_step from public.mutation_plan_steps mutate_step
  where mutate_step.plan_id = v_plan.id and mutate_step.operation in ('CREATE', 'UPDATE')
    and mutate_step.status in ('REMOTE_APPLIED', 'RECONCILED')
  order by mutate_step.step_index desc limit 1;
  update public.mutation_plan_steps set status = 'RECONCILED', dispatch_state = 'RECONCILED',
    dispatch_started_at = coalesce(dispatch_started_at, now()),
    remote_applied_at = coalesce(remote_applied_at, now()), completed_at = now(),
    error_class = null, error_code = null, updated_at = now() where id = v_step.id;
  update public.mutation_executions set status = 'SUCCEEDED', finished_at = now(),
    last_heartbeat_at = now(), error_class = null, error_code = null where id = v_execution.id;
  update public.mutation_plans set status = 'SUCCEEDED', lease_token = null, lease_owner = null,
    lease_expires_at = null, terminal_at = now(), blocked_reason = null, error_class = null,
    updated_at = now() where id = v_plan.id;
  update public.meta_creative_optimization_cycles set candidate_ad_id = v_ad_id,
    remote_creative_id = v_creative_binding.remote_object_id,
    remote_ad_id = v_ad_binding.remote_object_id, status = 'ACTIVE_TEST',
    started_at = now(),
    measurement_start_date =
      (now() at time zone (v_plan.planned_payload->>'account_timezone_name'))::date + 1,
    measurement_end_date =
      (now() at time zone (v_plan.planned_payload->>'account_timezone_name'))::date + 7,
    updated_at = now() where id = v_cycle.id;
  perform public.release_meta_account_operation(v_plan.platform_account_id, v_plan.user_id, p_lease_token);
  perform public.append_meta_mutation_audit_event(v_plan.user_id, v_plan.platform_account_id,
    v_plan.policy_id, v_plan.id, v_step.id, v_execution.id, 'RECONCILER', v_execution.worker_id,
    'META_CREATIVE_OPTIMIZER_TEST_ACTIVATED', jsonb_build_object('cycle_status', 'PLANNED'),
    jsonb_build_object('contract', 'meta_existing_adset_creative_test_v1'),
    jsonb_build_object('creative_snapshot_id', v_creative_snapshot.id, 'ad_snapshot_id', v_ad_snapshot.id),
    jsonb_build_object('plan_status', 'SUCCEEDED', 'cycle_status', 'ACTIVE_TEST'),
    jsonb_build_object('cycle_id', v_cycle.id, 'ad_target_id', v_ad_target_id,
      'budget_unchanged', true, 'parents_unchanged', true),
    'meta', null, null, v_mutate_step.remote_request_id, null, now());
  return query select 'SUCCEEDED'::text, v_plan.id, null::uuid, v_ad_snapshot.id;
end;
$$;

revoke all on function public.reconcile_meta_creative_format_optimizer_plan(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_meta_creative_format_optimizer_plan(uuid, uuid, uuid)
  to service_role;

create or replace function public.complete_meta_creative_optimization_cycle_no_winner(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_cycle_id uuid,
  p_reason text,
  p_evidence jsonb,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_cycle public.meta_creative_optimization_cycles%rowtype;
  v_ad_set public.ad_groups%rowtype;
  v_campaign public.campaigns%rowtype;
  v_baseline public.ads%rowtype;
  v_candidate public.ads%rowtype;
  v_day_count integer;
  v_distinct_days integer;
  v_wi bigint; v_li bigint; v_ws bigint; v_ls bigint; v_wc bigint; v_lc bigint;
  v_reported_wi bigint; v_reported_li bigint;
  v_reported_ws bigint; v_reported_ls bigint;
  v_reported_wc bigint; v_reported_lc bigint;
  v_daily_wins integer;
  v_reported_daily_wins integer;
  v_wrate double precision;
  v_lrate double precision;
  v_reported_wrate double precision;
  v_reported_lrate double precision;
  v_lift double precision;
  v_reported_lift double precision;
  v_delivery_agreement boolean;
  v_expected_reason text;
  v_evidence_hash text;
begin
  if p_completed_at is null
    or p_completed_at < now() - interval '5 minutes'
    or p_completed_at > now() + interval '1 minute'
    or p_reason not in (
      'insufficient_volume', 'imbalanced_delivery',
      'no_delivery_agreement', 'no_consistent_lift'
    )
    or jsonb_typeof(p_evidence) <> 'object'
    or pg_catalog.pg_column_size(p_evidence) > 65536
    or p_evidence->>'contract' <> 'meta_creative_format_operational_evidence_v2'
    or p_evidence->>'attributionContract' <> 'link_ctr:daily:v1'
    or p_evidence->>'successKind' <> 'traffic'
    or p_evidence->>'optimizationGoal' <> 'LINK_CLICKS'
    or jsonb_typeof(p_evidence->'commonDates') <> 'array'
    or jsonb_array_length(p_evidence->'commonDates') <> 7
    or jsonb_typeof(p_evidence#>'{winner,daily}') <> 'array'
    or jsonb_array_length(p_evidence#>'{winner,daily}') <> 7
    or jsonb_typeof(p_evidence#>'{loser,daily}') <> 'array'
    or jsonb_array_length(p_evidence#>'{loser,daily}') <> 7
    or (p_evidence#>>'{thresholds,fixedTestDays}')::integer <> 7
    or (p_evidence#>>'{thresholds,impressions}')::bigint <> 1000
    or (p_evidence#>>'{thresholds,spendMinor}')::bigint <> 5000
    or (p_evidence#>>'{thresholds,trafficClicks}')::bigint <> 100
    or (p_evidence#>>'{thresholds,minDeliveryBalance}')::numeric <> 0.5
    or (p_evidence#>>'{thresholds,relativeLift}')::numeric <> 0.1
    or (p_evidence#>>'{thresholds,dailyWins}')::integer <> 6 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_completion_evidence');
  end if;

  if not exists (
    select 1 from public.meta_account_operation_leases lease
    where lease.platform_account_id = p_platform_account_id
      and lease.user_id = p_user_id
      and lease.lease_kind = 'READ_SYNC'
      and lease.lease_token = p_read_lease_token
      and lease.expires_at > now()
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'read_lease_required');
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
  for update;
  if not found
    or v_account.marketing_sync_status <> 'success'
    or v_account.marketing_sync_id is distinct from p_source_marketing_sync_id
    or v_account.marketing_timezone_name is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names tz
      where tz.name = v_account.marketing_timezone_name
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'current_meta_sync_required');
  end if;

  select cycle.* into v_cycle
  from public.meta_creative_optimization_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.user_id = p_user_id
    and cycle.platform_account_id = p_platform_account_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'cycle_not_found');
  end if;
  if v_cycle.status = 'COMPLETED' then
    return jsonb_build_object('outcome', 'EXISTING', 'cycle_id', v_cycle.id);
  end if;
  if v_cycle.status <> 'ACTIVE_TEST'
    or v_cycle.measurement_start_date is null
    or v_cycle.measurement_end_date <> v_cycle.measurement_start_date + 6
    or v_cycle.measurement_end_date
      > ((p_completed_at at time zone v_account.marketing_timezone_name)::date - 3) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'fixed_window_not_complete');
  end if;

  select ad.* into v_baseline from public.ads ad where ad.id = v_cycle.baseline_ad_id;
  select ad.* into v_candidate from public.ads ad where ad.id = v_cycle.candidate_ad_id;
  select ad_set.* into v_ad_set from public.ad_groups ad_set where ad_set.id = v_cycle.ad_set_id;
  select campaign.* into v_campaign from public.campaigns campaign where campaign.id = v_ad_set.campaign_id;
  if v_baseline.id is null or v_candidate.id is null or v_ad_set.id is null or v_campaign.id is null
    or p_evidence->>'sourceSyncId' is distinct from p_source_marketing_sync_id::text
    or p_evidence->>'currency' is distinct from 'EUR'
    or p_evidence->>'adSetId' is distinct from v_ad_set.id::text
    or p_evidence->>'platformAdSetId' is distinct from v_cycle.platform_ad_set_id
    or p_evidence->>'campaignId' is distinct from v_campaign.id::text
    or p_evidence->>'platformCampaignId' is distinct from v_campaign.platform_campaign_id
    or p_evidence->>'objective' is distinct from v_campaign.objective
    or not (
      array[p_evidence#>>'{winner,adId}', p_evidence#>>'{loser,adId}']::text[]
      @> array[v_baseline.id::text, v_candidate.id::text]::text[]
      and array[p_evidence#>>'{winner,adId}', p_evidence#>>'{loser,adId}']::text[]
      <@ array[v_baseline.id::text, v_candidate.id::text]::text[]
    )
    or not (
      array[p_evidence#>>'{winner,platformAdId}', p_evidence#>>'{loser,platformAdId}']::text[]
      @> array[v_baseline.platform_ad_id, v_candidate.platform_ad_id]::text[]
      and array[p_evidence#>>'{winner,platformAdId}', p_evidence#>>'{loser,platformAdId}']::text[]
      <@ array[v_baseline.platform_ad_id, v_candidate.platform_ad_id]::text[]
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'completion_scope_mismatch');
  end if;

  if (select pg_catalog.jsonb_agg(
        pg_catalog.to_char(day_value, 'YYYY-MM-DD') order by day_value
      )
      from pg_catalog.generate_series(
        v_cycle.measurement_start_date,
        v_cycle.measurement_end_date,
        interval '1 day'
      ) day_value)
    is distinct from p_evidence->'commonDates' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'fixed_window_mismatch');
  end if;

  begin
    select count(*)::integer, count(distinct expected.value)::integer,
      coalesce(sum((winner.value->>'impressions')::bigint), 0),
      coalesce(sum((loser.value->>'impressions')::bigint), 0),
      coalesce(sum((winner.value->>'spendMinor')::bigint), 0),
      coalesce(sum((loser.value->>'spendMinor')::bigint), 0),
      coalesce(sum((winner.value->>'inlineLinkClicks')::bigint), 0),
      coalesce(sum((loser.value->>'inlineLinkClicks')::bigint), 0),
      count(*) filter (
        where case when (winner.value->>'impressions')::bigint > 0
          then (winner.value->>'inlineLinkClicks')::double precision
            / (winner.value->>'impressions')::double precision
          else 0 end
          > case when (loser.value->>'impressions')::bigint > 0
            then (loser.value->>'inlineLinkClicks')::double precision
              / (loser.value->>'impressions')::double precision
            else 0 end
      )::integer
    into v_day_count, v_distinct_days, v_wi, v_li, v_ws, v_ls, v_wc, v_lc,
      v_daily_wins
    from pg_catalog.jsonb_array_elements(p_evidence#>'{winner,daily}')
      with ordinality winner(value, position)
    join pg_catalog.jsonb_array_elements(p_evidence#>'{loser,daily}')
      with ordinality loser(value, position) using (position)
    join pg_catalog.jsonb_array_elements_text(p_evidence->'commonDates')
      with ordinality expected(value, position) using (position)
    where winner.value->>'date' = expected.value
      and loser.value->>'date' = expected.value;

    v_reported_wi := (p_evidence#>>'{winner,impressions}')::bigint;
    v_reported_li := (p_evidence#>>'{loser,impressions}')::bigint;
    v_reported_ws := (p_evidence#>>'{winner,spendMinor}')::bigint;
    v_reported_ls := (p_evidence#>>'{loser,spendMinor}')::bigint;
    v_reported_wc := (p_evidence#>>'{winner,inlineLinkClicks}')::bigint;
    v_reported_lc := (p_evidence#>>'{loser,inlineLinkClicks}')::bigint;
    v_reported_wrate := (p_evidence#>>'{winner,rate}')::double precision;
    v_reported_lrate := (p_evidence#>>'{loser,rate}')::double precision;
    v_reported_daily_wins := (p_evidence->>'dailyWins')::integer;
    v_delivery_agreement := (p_evidence->>'deliveryAgreement')::boolean;
  exception when others then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_completion_values');
  end;

  if v_day_count <> 7 or v_distinct_days <> 7
    or v_wi is distinct from v_reported_wi or v_li is distinct from v_reported_li
    or v_ws is distinct from v_reported_ws or v_ls is distinct from v_reported_ls
    or v_wc is distinct from v_reported_wc or v_lc is distinct from v_reported_lc
    or v_daily_wins is distinct from v_reported_daily_wins
    or v_wi < 0 or v_li < 0 or v_wc < 0 or v_lc < 0
    or v_wc > v_wi or v_lc > v_li
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        (p_evidence#>'{winner,daily}') || (p_evidence#>'{loser,daily}')
      ) day_row
      where (day_row->>'impressions')::bigint < 0
        or (day_row->>'spendMinor')::bigint < 0
        or (day_row->>'inlineLinkClicks')::bigint < 0
        or (day_row->>'inlineLinkClicks')::bigint
          > (day_row->>'impressions')::bigint
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'completion_aggregate_mismatch');
  end if;

  v_wrate := case when v_wi > 0
    then v_wc::double precision / v_wi::double precision else 0 end;
  v_lrate := case when v_li > 0
    then v_lc::double precision / v_li::double precision else 0 end;
  if abs(v_wrate - v_reported_wrate) > 0.000001
    or abs(v_lrate - v_reported_lrate) > 0.000001 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'completion_rate_mismatch');
  end if;
  if v_wrate < v_lrate
    or (
      v_wrate = v_lrate
      and (p_evidence#>>'{winner,platformAdId}')
        > (p_evidence#>>'{loser,platformAdId}')
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'completion_rank_mismatch');
  end if;
  if v_lrate = 0 then
    v_lift := null;
    if p_evidence->'relativeLift' <> 'null'::jsonb then
      return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'completion_lift_mismatch');
    end if;
  else
    v_lift := v_wrate / v_lrate - 1;
    begin
      v_reported_lift := (p_evidence->>'relativeLift')::double precision;
    exception when others then
      return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'completion_lift_mismatch');
    end;
    if abs(v_lift - v_reported_lift) > 0.000001 then
      return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'completion_lift_mismatch');
    end if;
  end if;

  if least(v_wi, v_li) < 1000 or least(v_ws, v_ls) < 5000
    or least(v_wc, v_lc) < 100 then
    v_expected_reason := 'insufficient_volume';
  elsif least(v_wi, v_li)::double precision / greatest(v_wi, v_li) < 0.5
    or least(v_ws, v_ls)::double precision / greatest(v_ws, v_ls) < 0.5 then
    v_expected_reason := 'imbalanced_delivery';
  elsif not (v_wi >= v_li and v_ws >= v_ls) then
    v_expected_reason := 'no_delivery_agreement';
  elsif v_lift is null or v_lift < 0.10 or v_daily_wins < 6 then
    v_expected_reason := 'no_consistent_lift';
  else
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'winner_evidence_cannot_close_no_winner');
  end if;

  if v_delivery_agreement is distinct from (v_wi >= v_li and v_ws >= v_ls)
    or p_reason is distinct from v_expected_reason then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'completion_reason_mismatch');
  end if;
  if exists (
    select 1 from public.mutation_plans plan
    where plan.platform_account_id = p_platform_account_id
      and plan.source_rule_key = 'meta_creative_format_optimizer_v1'
      and plan.action_type = 'PAUSE'
      and plan.planned_payload->>'optimization_cycle_id' = v_cycle.id::text
      and plan.status in (
        'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
        'RETRYABLE', 'COMPENSATION_REQUIRED'
      )
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'optimizer_plan_already_open');
  end if;

  v_evidence_hash := public.meta_sha256(p_evidence::text);
  update public.meta_creative_optimization_cycles
  set status = 'COMPLETED', completed_at = p_completed_at,
    completion_reason = p_reason, decision_evidence = p_evidence,
    decision_evidence_hash = v_evidence_hash, updated_at = now()
  where id = v_cycle.id and status = 'ACTIVE_TEST';
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'cycle_changed');
  end if;
  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, v_cycle.policy_id, v_cycle.plan_id,
    null, null, 'SYSTEM', 'creative-format-optimizer',
    'META_CREATIVE_OPTIMIZER_NO_WINNER',
    jsonb_build_object('cycle_status', 'ACTIVE_TEST'),
    jsonb_build_object('reason', p_reason),
    jsonb_build_object('evidence_hash', v_evidence_hash),
    jsonb_build_object('cycle_status', 'COMPLETED'),
    jsonb_build_object('cycle_id', v_cycle.id, 'evidence', p_evidence),
    'meta', null, null, null, null, p_completed_at
  );
  return jsonb_build_object(
    'outcome', 'CREATED', 'cycle_id', v_cycle.id,
    'evidence_hash', v_evidence_hash
  );
end;
$$;

revoke all on function public.complete_meta_creative_optimization_cycle_no_winner(
  uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_meta_creative_optimization_cycle_no_winner(
  uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz
) to service_role;

create or replace function public.queue_meta_creative_evidence_pause_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_source_marketing_sync_id uuid,
  p_read_lease_token uuid,
  p_winner_ad_id uuid,
  p_loser_ad_id uuid,
  p_evidence jsonb,
  p_planned_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_policy public.automation_policies%rowtype;
  v_loser public.ads%rowtype;
  v_winner public.ads%rowtype;
  v_loser_target public.automation_targets%rowtype;
  v_ad_set public.ad_groups%rowtype;
  v_campaign public.campaigns%rowtype;
  v_ad_set_target public.automation_targets%rowtype;
  v_campaign_target public.automation_targets%rowtype;
  v_cycle public.meta_creative_optimization_cycles%rowtype;
  v_kill_mode text;
  v_kind text;
  v_active_count integer;
  v_day_count integer;
  v_distinct_days integer;
  v_latest_day date;
  v_wi bigint;
  v_li bigint;
  v_ws bigint;
  v_ls bigint;
  v_wc bigint;
  v_lc bigint;
  v_wr bigint;
  v_lr bigint;
  v_wtrials bigint;
  v_ltrials bigint;
  v_wsuccess bigint;
  v_lsuccess bigint;
  v_wrate double precision;
  v_lrate double precision;
  v_lift double precision;
  v_reported_lift double precision;
  v_reported_daily_wins integer;
  v_dwi bigint;
  v_dli bigint;
  v_dws bigint;
  v_dls bigint;
  v_dwc bigint;
  v_dlc bigint;
  v_daily_wins integer;
  v_evidence_hash text;
  v_idempotency_key text;
  v_existing uuid;
  v_plan_id uuid := gen_random_uuid();
  v_validate uuid := gen_random_uuid();
  v_update uuid := gen_random_uuid();
  v_read uuid := gen_random_uuid();
  v_reconcile uuid := gen_random_uuid();
  v_payload jsonb;
  v_request jsonb;
begin
  if p_user_id is null or p_platform_account_id is null
    or p_source_marketing_sync_id is null or p_read_lease_token is null
    or p_winner_ad_id is null or p_loser_ad_id is null
    or p_winner_ad_id = p_loser_ad_id or p_planned_at is null
    or p_planned_at < now() - interval '5 minutes'
    or p_planned_at > now() + interval '1 minute'
    or jsonb_typeof(p_evidence) <> 'object'
    or pg_catalog.pg_column_size(p_evidence) > 65536
    or p_evidence->>'contract' <> 'meta_creative_format_operational_evidence_v2'
    or p_evidence->>'attributionContract' <> 'link_ctr:daily:v1'
    or p_evidence->>'successKind' <> 'traffic'
    or p_evidence->>'optimizationGoal' <> 'LINK_CLICKS'
    or jsonb_typeof(p_evidence->'commonDates') <> 'array'
    or jsonb_array_length(p_evidence->'commonDates') <> 7
    or jsonb_typeof(p_evidence#>'{winner,daily}') <> 'array'
    or jsonb_array_length(p_evidence#>'{winner,daily}') <> 7
    or jsonb_typeof(p_evidence#>'{loser,daily}') <> 'array'
    or jsonb_array_length(p_evidence#>'{loser,daily}') <> 7
    or (p_evidence#>>'{thresholds,fixedTestDays}')::integer <> 7
    or (p_evidence#>>'{thresholds,impressions}')::bigint <> 1000
    or (p_evidence#>>'{thresholds,spendMinor}')::bigint <> 5000
    or (p_evidence#>>'{thresholds,trafficClicks}')::bigint <> 100
    or (p_evidence#>>'{thresholds,minDeliveryBalance}')::numeric <> 0.5
    or (p_evidence#>>'{thresholds,relativeLift}')::numeric <> 0.1
    or (p_evidence#>>'{thresholds,dailyWins}')::integer <> 6
    or p_evidence->>'deliveryAgreement' <> 'true' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_evidence_contract');
  end if;

  v_evidence_hash := public.meta_sha256(p_evidence::text);
  select plan.id into v_existing
  from public.mutation_plans plan
  where plan.user_id = p_user_id
    and plan.platform_account_id = p_platform_account_id
    and plan.source_rule_key = 'meta_creative_format_optimizer_v1'
    and plan.action_type = 'PAUSE'
    and plan.planned_payload->>'evidence_hash' = v_evidence_hash
    and plan.planned_payload->>'winner_ad_id' = p_winner_ad_id::text
    and plan.planned_payload->>'loser_ad_id' = p_loser_ad_id::text
  order by plan.created_at desc
  limit 1;
  if found then
    return jsonb_build_object('outcome', 'EXISTING', 'plan_id', v_existing);
  end if;

  if not exists (
    select 1
    from public.meta_account_operation_leases lease
    where lease.platform_account_id = p_platform_account_id
      and lease.user_id = p_user_id
      and lease.lease_kind = 'READ_SYNC'
      and lease.lease_token = p_read_lease_token
      and lease.expires_at > now()
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'read_lease_required');
  end if;

  begin
    select count(*)::integer,
      count(distinct day_value)::integer,
      max(day_value)
    into v_day_count, v_distinct_days, v_latest_day
    from (
      select value::date as day_value
      from pg_catalog.jsonb_array_elements_text(p_evidence->'commonDates') value
    ) days;
  exception when others then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_evidence_days');
  end;
  if v_day_count <> 7 or v_distinct_days <> 7 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'immature_or_incomplete_evidence_days');
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
  for update;
  if not found
    or v_account.marketing_sync_status <> 'success'
    or v_account.marketing_sync_id is distinct from p_source_marketing_sync_id
    or v_account.marketing_last_success_at is null
    or v_account.marketing_last_success_at < p_planned_at - interval '2 hours'
    or v_account.marketing_last_success_at > p_planned_at + interval '5 minutes'
    or v_account.marketing_currency is distinct from 'EUR'
    or pg_catalog.regexp_replace(
      coalesce(v_account.marketing_meta_ad_account_id, ''), '^act_', ''
    ) !~ '^[1-9][0-9]{0,39}$'
    or v_account.marketing_timezone_name is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names tz
      where tz.name = v_account.marketing_timezone_name
    )
    or not ('ads_management' = any(coalesce(v_account.meta_scopes, '{}'::text[]))) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'current_meta_sync_or_permission_required');
  end if;
  if v_latest_day
      > ((p_planned_at at time zone v_account.marketing_timezone_name)::date - 3) then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'immature_or_incomplete_evidence_days'
    );
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
    and ap.currency = 'EUR'
    and ap.allow_status_changes
  for update;
  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'status_changes_not_allowed');
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;
  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'ALLOW' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'kill_switch_not_allow');
  end if;

  select ad.* into v_winner
  from public.ads ad
  where ad.id = p_winner_ad_id
    and ad.user_id = p_user_id
    and ad.platform_account_id = p_platform_account_id
    and ad.is_current
    and ad.last_seen_sync_id = p_source_marketing_sync_id
    and coalesce(ad.effective_status, ad.status) = 'ACTIVE'
  for update;
  select ad.* into v_loser
  from public.ads ad
  where ad.id = p_loser_ad_id
    and ad.user_id = p_user_id
    and ad.platform_account_id = p_platform_account_id
    and ad.is_current
    and ad.last_seen_sync_id = p_source_marketing_sync_id
    and coalesce(ad.effective_status, ad.status) = 'ACTIVE'
  for update;
  if v_winner.id is null or v_loser.id is null
    or v_winner.ad_group_id <> v_loser.ad_group_id then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'winner_loser_identity_mismatch');
  end if;

  select target.* into v_loser_target
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'AD'
    and target.ad_id = v_loser.id
    and target.platform_object_id = v_loser.platform_ad_id
    and target.status = 'MANAGED'
  for update;
  if not found or not exists (
    select 1 from public.automation_targets target
    where target.user_id = p_user_id
      and target.platform_account_id = p_platform_account_id
      and target.target_type = 'AD'
      and target.ad_id = v_winner.id
      and target.platform_object_id = v_winner.platform_ad_id
      and target.status = 'MANAGED'
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'managed_comparison_ads_required');
  end if;

  select ag.* into v_ad_set
  from public.ad_groups ag
  where ag.id = v_loser.ad_group_id
    and ag.user_id = p_user_id
    and ag.platform_account_id = p_platform_account_id
    and ag.is_current
    and ag.last_seen_sync_id = p_source_marketing_sync_id
    and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
  for update;
  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_ad_set.campaign_id
    and c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
    and c.last_seen_sync_id = p_source_marketing_sync_id
    and coalesce(c.effective_status, c.status) = 'ACTIVE'
  for update;
  if v_ad_set.id is null or v_campaign.id is null then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'active_parent_chain_required');
  end if;

  select target.* into v_ad_set_target
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'AD_SET'
    and target.ad_group_id = v_ad_set.id
    and target.campaign_id = v_campaign.id
    and target.platform_object_id = v_ad_set.platform_ad_group_id
    and target.status = 'MANAGED'
  for update;
  select target.* into v_campaign_target
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'CAMPAIGN'
    and target.campaign_id = v_campaign.id
    and target.platform_object_id = v_campaign.platform_campaign_id
    and target.status = 'MANAGED'
  for update;
  if v_ad_set_target.id is null or v_campaign_target.id is null then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'managed_parent_chain_required');
  end if;

  if v_campaign.name ilike 'Organic Boost%'
    or exists (
      select 1
      from public.meta_organic_boost_links link
      join public.remote_object_bindings binding
        on binding.plan_id = link.plan_id
       and binding.user_id = link.user_id
       and binding.platform_account_id = link.platform_account_id
      where link.user_id = p_user_id
        and link.platform_account_id = p_platform_account_id
        and binding.object_type = 'CAMPAIGN'
        and binding.remote_object_id = v_campaign.platform_campaign_id
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'organic_boost_auto_pause_forbidden');
  end if;

  select count(*)::integer into v_active_count
  from public.ads ad
  join public.automation_targets target
    on target.ad_id = ad.id
   and target.target_type = 'AD'
   and target.status = 'MANAGED'
  where ad.ad_group_id = v_ad_set.id
    and ad.user_id = p_user_id
    and ad.platform_account_id = p_platform_account_id
    and ad.is_current
    and ad.last_seen_sync_id = p_source_marketing_sync_id
    and coalesce(ad.effective_status, ad.status) = 'ACTIVE';
  if v_active_count <> 2 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'comparison_cardinality_changed');
  end if;

  select cycle.* into v_cycle
  from public.meta_creative_optimization_cycles cycle
  where cycle.platform_account_id = p_platform_account_id
    and cycle.ad_set_id = v_ad_set.id
    and cycle.status = 'ACTIVE_TEST'
  order by cycle.started_at desc
  limit 1
  for update;
  if v_cycle.id is null
    or v_cycle.candidate_ad_id is null
    or not (
      (v_cycle.baseline_ad_id = v_winner.id and v_cycle.candidate_ad_id = v_loser.id)
      or (v_cycle.baseline_ad_id = v_loser.id and v_cycle.candidate_ad_id = v_winner.id)
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'active_test_cycle_required');
  end if;
  if not exists (
    select 1 from public.mutation_plans test_plan
    where test_plan.id = v_cycle.plan_id
      and test_plan.user_id = p_user_id
      and test_plan.platform_account_id = p_platform_account_id
      and test_plan.source_rule_key = 'meta_creative_format_optimizer_v1'
      and test_plan.action_type = 'LAUNCH_AD'
      and test_plan.status = 'SUCCEEDED'
  ) or not exists (
    select 1 from public.mutation_plans root_plan
    where root_plan.id = v_cycle.source_launch_plan_id
      and root_plan.user_id = p_user_id
      and root_plan.platform_account_id = p_platform_account_id
      and root_plan.action_type in ('LAUNCH_CHAIN', 'LAUNCH_AD')
      and root_plan.status = 'SUCCEEDED'
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'verified_test_provenance_required');
  end if;
  if v_cycle.measurement_start_date is null
    or v_cycle.measurement_end_date <> v_cycle.measurement_start_date + 6
    or (select pg_catalog.jsonb_agg(
          pg_catalog.to_char(day_value, 'YYYY-MM-DD') order by day_value
        )
        from pg_catalog.generate_series(
          v_cycle.measurement_start_date,
          v_cycle.measurement_end_date,
          interval '1 day'
        ) day_value)
      is distinct from p_evidence->'commonDates' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'fixed_window_mismatch');
  end if;
  if v_cycle.measurement_end_date
      > ((p_planned_at at time zone v_account.marketing_timezone_name)::date - 3) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'fixed_window_not_mature');
  end if;

  if exists (
    select 1
    from public.mutation_plans mp
    where mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'meta_creative_format_optimizer_v1'
      and mp.status in (
        'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
        'RETRYABLE', 'COMPENSATION_REQUIRED'
      )
      and (
        mp.target_key = v_loser_target.target_key
        or mp.planned_payload->>'platform_ad_set_id' = v_ad_set.platform_ad_group_id
      )
  ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'optimizer_plan_already_open');
  end if;
  if coalesce(v_ad_set_target.last_successful_mutation_at, '-infinity'::timestamptz)
       > p_planned_at - interval '12 hours'
    or (v_cycle.id is not null and v_cycle.started_at > p_planned_at - interval '12 hours') then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'ad_set_cooldown');
  end if;

  v_kind := p_evidence->>'successKind';
  if v_campaign.objective not in ('OUTCOME_TRAFFIC', 'LINK_CLICKS')
    or v_ad_set.optimization_goal is distinct from 'LINK_CLICKS'
    or v_kind is distinct from 'traffic'
    or p_evidence->>'sourceSyncId' is distinct from p_source_marketing_sync_id::text
    or p_evidence->>'currency' is distinct from 'EUR'
    or p_evidence->>'adSetId' is distinct from v_ad_set.id::text
    or p_evidence->>'platformAdSetId' is distinct from v_ad_set.platform_ad_group_id
    or p_evidence->>'campaignId' is distinct from v_campaign.id::text
    or p_evidence->>'platformCampaignId' is distinct from v_campaign.platform_campaign_id
    or p_evidence->>'objective' is distinct from v_campaign.objective
    or p_evidence->>'optimizationGoal' is distinct from v_ad_set.optimization_goal
    or p_evidence#>>'{winner,adId}' is distinct from v_winner.id::text
    or p_evidence#>>'{winner,platformAdId}' is distinct from v_winner.platform_ad_id
    or p_evidence#>>'{loser,adId}' is distinct from v_loser.id::text
    or p_evidence#>>'{loser,platformAdId}' is distinct from v_loser.platform_ad_id then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'evidence_scope_mismatch');
  end if;

  begin
    v_wi := (p_evidence#>>'{winner,impressions}')::bigint;
    v_li := (p_evidence#>>'{loser,impressions}')::bigint;
    v_ws := (p_evidence#>>'{winner,spendMinor}')::bigint;
    v_ls := (p_evidence#>>'{loser,spendMinor}')::bigint;
    v_wc := (p_evidence#>>'{winner,inlineLinkClicks}')::bigint;
    v_lc := (p_evidence#>>'{loser,inlineLinkClicks}')::bigint;
    v_wr := (p_evidence#>>'{winner,primaryResults}')::bigint;
    v_lr := (p_evidence#>>'{loser,primaryResults}')::bigint;
    v_wtrials := (p_evidence#>>'{winner,trials}')::bigint;
    v_ltrials := (p_evidence#>>'{loser,trials}')::bigint;
    v_wsuccess := (p_evidence#>>'{winner,successes}')::bigint;
    v_lsuccess := (p_evidence#>>'{loser,successes}')::bigint;
    v_wrate := (p_evidence#>>'{winner,rate}')::double precision;
    v_lrate := (p_evidence#>>'{loser,rate}')::double precision;
    v_reported_lift := (p_evidence->>'relativeLift')::double precision;
    v_reported_daily_wins := (p_evidence->>'dailyWins')::integer;
    select
      sum((winner.value->>'impressions')::bigint),
      sum((loser.value->>'impressions')::bigint),
      sum((winner.value->>'spendMinor')::bigint),
      sum((loser.value->>'spendMinor')::bigint),
      sum((winner.value->>'inlineLinkClicks')::bigint),
      sum((loser.value->>'inlineLinkClicks')::bigint),
      count(*) filter (
        where (winner.value->>'impressions')::bigint > 0
          and (loser.value->>'impressions')::bigint > 0
          and (winner.value->>'inlineLinkClicks')::double precision
                / (winner.value->>'impressions')::double precision
            > (loser.value->>'inlineLinkClicks')::double precision
                / (loser.value->>'impressions')::double precision
      )::integer
    into v_dwi, v_dli, v_dws, v_dls, v_dwc, v_dlc, v_daily_wins
    from pg_catalog.jsonb_array_elements(p_evidence#>'{winner,daily}')
      with ordinality winner(value, position)
    join pg_catalog.jsonb_array_elements(p_evidence#>'{loser,daily}')
      with ordinality loser(value, position) using (position)
    join pg_catalog.jsonb_array_elements_text(p_evidence->'commonDates')
      with ordinality expected(value, position) using (position)
    where winner.value->>'date' = expected.value
      and loser.value->>'date' = expected.value;
  exception when others then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_evidence_values');
  end;

  if least(v_wi, v_li) < 1000 or least(v_ws, v_ls) < 5000
    or least(v_wc, v_lc) < 100
    or v_wtrials <= 0 or v_ltrials <= 0
    or v_wsuccess < 0 or v_lsuccess < 0
    or v_wsuccess > v_wtrials or v_lsuccess > v_ltrials
    or v_wsuccess <> v_wr or v_lsuccess <> v_lr
    or v_wtrials <> v_wi or v_ltrials <> v_li
    or v_wr <> v_wc or v_lr <> v_lc
    or v_dwi is distinct from v_wi or v_dli is distinct from v_li
    or v_dws is distinct from v_ws or v_dls is distinct from v_ls
    or v_dwc is distinct from v_wc or v_dlc is distinct from v_lc
    or v_daily_wins is distinct from v_reported_daily_wins
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        (p_evidence#>'{winner,daily}') || (p_evidence#>'{loser,daily}')
      ) day_row
      where (day_row->>'impressions')::bigint < 0
        or (day_row->>'spendMinor')::bigint < 0
        or (day_row->>'inlineLinkClicks')::bigint < 0
        or (day_row->>'inlineLinkClicks')::bigint
          > (day_row->>'impressions')::bigint
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'evidence_minimums_not_met');
  end if;
  if least(v_wi, v_li)::double precision / greatest(v_wi, v_li) < 0.5
    or least(v_ws, v_ls)::double precision / greatest(v_ws, v_ls) < 0.5 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'imbalanced_delivery');
  end if;

  v_wrate := v_wsuccess::double precision / v_wtrials::double precision;
  v_lrate := v_lsuccess::double precision / v_ltrials::double precision;
  if v_lrate <= 0 or v_wrate <= v_lrate then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'winner_not_better');
  end if;
  v_lift := v_wrate / v_lrate - 1;
  if v_lift < 0.10
    or v_daily_wins < 6
    or v_wi < v_li
    or v_ws < v_ls
    or abs(v_reported_lift - v_lift) > 0.000001
    or abs(v_wrate - (p_evidence#>>'{winner,rate}')::double precision) > 0.000001
    or abs(v_lrate - (p_evidence#>>'{loser,rate}')::double precision) > 0.000001 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'operational_dominance_not_proven');
  end if;

  v_idempotency_key := public.meta_sha256(
    'meta_creative_evidence_pause_v2|' || p_platform_account_id::text || '|'
    || v_ad_set.id::text || '|' || v_loser.id::text || '|' || v_evidence_hash
  );
  select id into v_existing
  from public.mutation_plans
  where idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object('outcome', 'EXISTING', 'plan_id', v_existing);
  end if;

  v_payload := jsonb_build_object(
    'contract', 'meta_creative_evidence_pause_v1',
    'platform_campaign_id', v_campaign.platform_campaign_id,
    'platform_ad_set_id', v_ad_set.platform_ad_group_id,
    'baseline_platform_ad_id', v_winner.platform_ad_id,
    'winner_platform_ad_id', v_winner.platform_ad_id,
    'loser_platform_ad_id', v_loser.platform_ad_id,
    'winner_ad_id', v_winner.id,
    'loser_ad_id', v_loser.id,
    'optimization_cycle_id', v_cycle.id,
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'meta_ad_account_id', pg_catalog.regexp_replace(
      v_account.marketing_meta_ad_account_id, '^act_', ''
    ),
    'evidence_valid_until', p_planned_at + interval '10 minutes',
    'campaign_effective_status', coalesce(v_campaign.effective_status, v_campaign.status),
    'ad_set_effective_status', coalesce(v_ad_set.effective_status, v_ad_set.status),
    'campaign_daily_budget_minor', v_campaign.daily_budget_minor,
    'campaign_lifetime_budget_minor', v_campaign.lifetime_budget_minor,
    'ad_set_daily_budget_minor', v_ad_set.daily_budget_minor,
    'ad_set_lifetime_budget_minor', v_ad_set.lifetime_budget_minor,
    'evidence_hash', v_evidence_hash,
    'evidence', p_evidence
  );
  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
    source_rule_key, source_rule_version, action_type, target_type, target_key,
    campaign_scope_key, budget_owner_key, automation_target_id, idempotency_key,
    expected_before, intended_after, planned_payload, payload_hash,
    status, priority, safety_action, not_before, max_attempts, created_at, updated_at
  ) values (
    v_plan_id, p_user_id, p_platform_account_id, v_policy.id,
    p_source_marketing_sync_id, 'meta_creative_format_optimizer_v1', 2,
    'PAUSE', 'AD', v_loser_target.target_key,
    v_loser_target.campaign_scope_key, v_loser_target.budget_owner_key,
    v_loser_target.id, v_idempotency_key,
    v_payload || jsonb_build_object('status', 'ACTIVE'),
    jsonb_build_object('status', 'PAUSED'), v_payload,
    public.meta_sha256(v_payload::text), 'PENDING', 51, false,
    p_planned_at, 3, p_planned_at, p_planned_at
  );

  v_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS', 'object_type', 'AD',
    'object_id', v_loser.platform_ad_id, 'status', 'PAUSED'
  );
  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
   (v_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-creative-evidence-pause', 'VALIDATE', 'AD', null,
    v_request || jsonb_build_object('mode', 'validate_only'),
    public.meta_sha256((v_request || jsonb_build_object('mode', 'validate_only'))::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'),
   (v_update, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-creative-evidence-pause', 'UPDATE', 'AD', v_validate,
    v_request || jsonb_build_object('mode', 'execute'),
    public.meta_sha256((v_request || jsonb_build_object('mode', 'execute'))::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'),
   (v_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-creative-evidence-pause', 'READ', 'AD', v_update,
    jsonb_build_object('operation', 'READ', 'object_type', 'AD',
      'object_id', v_loser.platform_ad_id),
    public.meta_sha256(jsonb_build_object('operation', 'READ', 'object_type', 'AD',
      'object_id', v_loser.platform_ad_id)::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'),
   (v_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-creative-evidence-pause', 'RECONCILE', 'AD', v_read,
    jsonb_build_object('operation', 'RECONCILE', 'object_type', 'AD',
      'expected_status', 'PAUSED', 'contract', 'meta_creative_evidence_pause_v1'),
    public.meta_sha256(jsonb_build_object('operation', 'RECONCILE', 'object_type', 'AD',
      'expected_status', 'PAUSED', 'contract', 'meta_creative_evidence_pause_v1')::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'), 'NONE', 'PENDING');

  update public.meta_creative_optimization_cycles
  set status = 'PAUSE_PLANNED',
    completion_reason = 'operational_traffic_dominance_pending',
    decision_evidence = p_evidence,
    decision_evidence_hash = v_evidence_hash,
    updated_at = now()
  where id = v_cycle.id
    and status = 'ACTIVE_TEST';
  if not found then
    raise exception 'Optimizer cycle decision was concurrently changed';
  end if;

  return jsonb_build_object(
    'outcome', 'CREATED', 'plan_id', v_plan_id,
    'evidence_hash', v_evidence_hash, 'optimization_cycle_id', v_cycle.id
  );
end;
$$;

revoke all on function public.queue_meta_creative_evidence_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.queue_meta_creative_evidence_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz
) to service_role;

update public.mutation_plans legacy_plan
set status = 'CANCELLED',
  blocked_reason = 'disabled_legacy_no_minimum',
  lease_token = null,
  lease_owner = null,
  lease_expires_at = null,
  terminal_at = coalesce(legacy_plan.terminal_at, now()),
  updated_at = now()
where legacy_plan.source_rule_key = 'ad_sibling_success_pause_7d'
  and legacy_plan.status in ('PENDING', 'RETRYABLE', 'CLAIMED')
  and not exists (
    select 1
    from public.mutation_plan_steps legacy_step
    where legacy_step.plan_id = legacy_plan.id
      and legacy_step.dispatch_state <> 'NOT_DISPATCHED'
  );

create or replace function public.queue_meta_ad_sibling_success_pause_internal(
  p_user_id uuid,p_platform_account_id uuid,p_policy_id uuid,p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,p_automation_target_id uuid,p_evidence jsonb,
  p_planned_at timestamptz)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('outcome','SKIPPED','reason','disabled_legacy_no_minimum')
$$;

create or replace function public.queue_meta_ad_sibling_success_pause_scan_internal(
  p_user_id uuid,p_platform_account_id uuid,p_policy_id uuid,p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,p_planned_at timestamptz)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('outcome','SKIPPED','reason','disabled_legacy_no_minimum',
   'created',0,'existing',0,'blocked',0,'skipped',0)
$$;

revoke all on function public.queue_meta_ad_sibling_success_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.queue_meta_ad_sibling_success_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz
) to service_role;
revoke all on function public.queue_meta_ad_sibling_success_pause_scan_internal(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.queue_meta_ad_sibling_success_pause_scan_internal(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

create or replace function public.reconcile_meta_mutation_plan(
  p_execution_id uuid,p_step_id uuid,p_lease_token uuid)
returns table(outcome text,plan_id uuid,ledger_id uuid,snapshot_id uuid)
language plpgsql security definer set search_path='' as $$
declare
 v_action_type text; v_rule text; v_contract text; v_user uuid; v_account uuid;
 v_plan uuid; v_result record; v_account_mode text; v_plan_mode text;
begin
 select mp.action_type,mp.source_rule_key,mp.planned_payload->>'contract',mp.user_id,
   mp.platform_account_id,mp.id into v_action_type,v_rule,v_contract,v_user,v_account,v_plan
 from public.mutation_executions me join public.mutation_plans mp on mp.id=me.plan_id
 where me.id=p_execution_id and me.lease_token=p_lease_token;
 if v_action_type='LAUNCH_AD' and v_rule='meta_creative_format_optimizer_v1'
    and v_contract='meta_existing_adset_creative_test_v1' then
   return query select * from public.reconcile_meta_creative_format_optimizer_plan(p_execution_id,p_step_id,p_lease_token); return;
 end if;
 if v_action_type='PAUSE' and v_rule='meta_creative_format_optimizer_v1'
    and v_contract='meta_creative_evidence_pause_v1' then
   select result.* into v_result
   from public.reconcile_meta_mutation_plan_base(
     p_execution_id, p_step_id, p_lease_token
   ) result;
   if v_result.outcome = 'SUCCEEDED' then
     update public.meta_creative_optimization_cycles cycle
     set status = 'COMPLETED', completed_at = now(),
       completion_reason = 'operational_traffic_dominance', updated_at = now()
     where cycle.id::text = (
       select mp.planned_payload->>'optimization_cycle_id'
       from public.mutation_plans mp
       where mp.id = v_plan
     )
       and cycle.status = 'PAUSE_PLANNED';
   end if;
   return query select v_result.outcome::text, v_result.plan_id::uuid,
     v_result.ledger_id::uuid, v_result.snapshot_id::uuid;
   return;
 end if;
   if v_action_type in ('LAUNCH_CHAIN','LAUNCH_AD') then
     select result.* into v_result from public.reconcile_meta_launch_mutation_plan(p_execution_id,p_step_id,p_lease_token) result;
     if v_action_type='LAUNCH_CHAIN' and v_rule <> 'organic-boost' then
     select latest.mode into v_account_mode from public.kill_switch_state latest
      where latest.scope_type='ACCOUNT' and latest.user_id=v_user and latest.platform_account_id=v_account
      order by latest.sequence desc limit 1;
     if coalesce(v_account_mode,'FREEZE_WRITES')<>'FREEZE_WRITES' then
       perform public.append_meta_kill_switch_state('ACCOUNT',v_user,v_account,null,'FREEZE_WRITES',
         'Atomarer Aktiv-Launch wurde reconciliert: '||v_result.outcome,'SYSTEM','meta-launch-canary-reconciler');
     end if;
     select latest.mode into v_plan_mode from public.kill_switch_state latest
      where latest.scope_type='PLAN' and latest.user_id=v_user and latest.platform_account_id=v_account
        and latest.plan_id=v_plan order by latest.sequence desc limit 1;
     if coalesce(v_plan_mode,'FREEZE_WRITES')<>'FREEZE_WRITES' then
       perform public.append_meta_kill_switch_state('PLAN',v_user,v_account,v_plan,'FREEZE_WRITES',
         'Atomarer Aktiv-Launch wurde reconciliert: '||v_result.outcome,'SYSTEM','meta-launch-canary-reconciler');
     end if;
   end if;
   return query select v_result.outcome::text,v_result.plan_id::uuid,v_result.ledger_id::uuid,v_result.snapshot_id::uuid; return;
 end if;
 return query select result.outcome,result.plan_id,result.ledger_id,result.snapshot_id
 from public.reconcile_meta_mutation_plan_base(p_execution_id,p_step_id,p_lease_token) result;
end;
$$;
revoke all on function public.reconcile_meta_mutation_plan(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_meta_mutation_plan(uuid,uuid,uuid) to service_role;

commit;

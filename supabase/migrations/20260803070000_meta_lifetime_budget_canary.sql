-- Lifetime budget update canary.
-- Adds an explicit customer-confirmed campaign Lifetime-budget path while keeping
-- the existing Daily canary and all account/campaign daily hard-cap semantics
-- unchanged. Lifetime totals never enter daily exposure reservations.


create or replace function public.meta_budget_plan_type(
  p_plan public.mutation_plans
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_plan.planned_payload->>'budget_type' in ('daily_budget', 'lifetime_budget') then
    return p_plan.planned_payload->>'budget_type';
  end if;

  if not (p_plan.planned_payload ? 'budget_type')
    and p_plan.expected_before ? 'daily_budget_minor'
    and not (p_plan.expected_before ? 'lifetime_budget_minor')
    and p_plan.intended_after ? 'daily_budget_minor'
    and not (p_plan.intended_after ? 'lifetime_budget_minor') then
    return 'daily_budget';
  end if;

  return null;
end;
$$;

create or replace function public.meta_executor_current_before(
  p_target public.automation_targets
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_target.target_type = 'CAMPAIGN' then
    select jsonb_build_object(
      'object_id', c.platform_campaign_id,
      'daily_budget_minor', c.daily_budget_minor,
      'lifetime_budget_minor', c.lifetime_budget_minor,
      'status', coalesce(c.effective_status, c.status),
      'source_marketing_sync_id', c.last_seen_sync_id,
      'is_current', c.is_current
    ) into v_result
    from public.campaigns c
    where c.id = p_target.campaign_id
      and c.user_id = p_target.user_id
      and c.platform_account_id = p_target.platform_account_id;
  elsif p_target.target_type = 'AD_SET' then
    select jsonb_build_object(
      'object_id', ag.platform_ad_group_id,
      'daily_budget_minor', ag.daily_budget_minor,
      'lifetime_budget_minor', ag.lifetime_budget_minor,
      'status', coalesce(ag.effective_status, ag.status),
      'source_marketing_sync_id', ag.last_seen_sync_id,
      'is_current', ag.is_current
    ) into v_result
    from public.ad_groups ag
    where ag.id = p_target.ad_group_id
      and ag.user_id = p_target.user_id
      and ag.platform_account_id = p_target.platform_account_id;
  elsif p_target.target_type = 'AD' then
    select jsonb_build_object(
      'object_id', a.platform_ad_id,
      'status', coalesce(a.effective_status, a.status),
      'source_marketing_sync_id', a.last_seen_sync_id,
      'is_current', a.is_current
    ) into v_result
    from public.ads a
    where a.id = p_target.ad_id
      and a.user_id = p_target.user_id
      and a.platform_account_id = p_target.platform_account_id;
  end if;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.meta_executor_before_matches(
  p_plan public.mutation_plans,
  p_target public.automation_targets
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current jsonb;
begin
  v_current := public.meta_executor_current_before(p_target);

  if v_current = '{}'::jsonb
    or coalesce((v_current->>'is_current')::boolean, false) is not true
    or v_current->>'object_id' is distinct from p_target.platform_object_id
    or (v_current->>'source_marketing_sync_id')::uuid
       is distinct from p_plan.source_marketing_sync_id then
    return false;
  end if;

  if p_plan.action_type = 'UPDATE_BUDGET' then
    if public.meta_budget_plan_type(p_plan) = 'daily_budget' then
      if not (p_plan.expected_before ? 'daily_budget_minor')
        or p_plan.expected_before ? 'lifetime_budget_minor'
        or (v_current->>'daily_budget_minor')::bigint
          is distinct from (p_plan.expected_before->>'daily_budget_minor')::bigint then
        return false;
      end if;
    elsif public.meta_budget_plan_type(p_plan) = 'lifetime_budget' then
      if not (p_plan.expected_before ? 'lifetime_budget_minor')
        or p_plan.expected_before ? 'daily_budget_minor'
        or (v_current->>'lifetime_budget_minor')::bigint
          is distinct from (p_plan.expected_before->>'lifetime_budget_minor')::bigint then
        return false;
      end if;
    else
      return false;
    end if;
  end if;

  if p_plan.expected_before ? 'status'
    and v_current->>'status' is distinct from p_plan.expected_before->>'status' then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function public.freeze_meta_budget_plan_for_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  if new.action_type <> 'UPDATE_BUDGET' or new.safety_action then
    return new;
  end if;

  select mwm.mode into v_mode
  from public.meta_account_write_modes mwm
  where mwm.user_id = new.user_id
    and mwm.platform_account_id = new.platform_account_id;

  if coalesce(v_mode, 'CONFIRM_EACH_BUDGET') = 'CONFIRM_EACH_BUDGET' then
    perform public.append_meta_kill_switch_state(
      'PLAN',
      new.user_id,
      new.platform_account_id,
      new.id,
      'FREEZE_WRITES',
      'Budget-Canary wartet auf exakte Kundenbestätigung',
      'SYSTEM',
      'meta-budget-canary-gate'
    );

    perform public.append_meta_mutation_audit_event(
      new.user_id,
      new.platform_account_id,
      new.policy_id,
      new.id,
      null,
      null,
      'SYSTEM',
      'meta-budget-canary-gate',
      'BUDGET_CANARY_CONFIRMATION_REQUIRED',
      '{}'::jsonb,
      jsonb_build_object(
        'payload_hash', new.payload_hash,
        'not_before', 'infinity'
      ),
      '{}'::jsonb,
      jsonb_build_object('plan_status', new.status),
      jsonb_build_object(
        'budget_type', public.meta_budget_plan_type(new),
        'current_budget_minor', case public.meta_budget_plan_type(new)
          when 'daily_budget' then new.expected_before->>'daily_budget_minor'
          when 'lifetime_budget' then new.expected_before->>'lifetime_budget_minor'
          else null end,
        'intended_budget_minor', case public.meta_budget_plan_type(new)
          when 'daily_budget' then new.intended_after->>'daily_budget_minor'
          when 'lifetime_budget' then new.intended_after->>'lifetime_budget_minor'
          else null end
      ),
      null, null, null, null, null, now()
    );
  end if;

  return new;
end;
$$;

create or replace function public.list_meta_budget_canary_plans(
  p_platform_account_id uuid
)
returns table (
  plan_id uuid,
  campaign_id uuid,
  campaign_name text,
  budget_owner_label text,
  target_type text,
  current_budget_minor bigint,
  intended_budget_minor bigint,
  currency text,
  change_bps integer,
  direction text,
  source_rule_key text,
  plan_status text,
  payload_hash text,
  source_marketing_sync_id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  is_expired boolean,
  fresh_sync boolean,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = v_user_id
      and pa.platform = 'meta'
  ) then
    raise exception 'Budget canary account is invalid';
  end if;

  return query
  select
    mp.id,
    at.campaign_id,
    coalesce(c.name, 'Meta-Kampagne'),
    case
      when mp.target_type = 'CAMPAIGN'
        and public.meta_budget_plan_type(mp) = 'lifetime_budget'
        then 'Lifetime-Kampagnenbudget'
      when mp.target_type = 'CAMPAIGN' then 'Kampagnenbudget'
      when mp.target_type = 'AD_SET' then 'Anzeigengruppenbudget'
      else 'Budgetowner'
    end,
    mp.target_type,
    case public.meta_budget_plan_type(mp)
      when 'daily_budget' then (mp.expected_before->>'daily_budget_minor')::bigint
      when 'lifetime_budget' then (mp.expected_before->>'lifetime_budget_minor')::bigint
      else null end,
    case public.meta_budget_plan_type(mp)
      when 'daily_budget' then (mp.intended_after->>'daily_budget_minor')::bigint
      when 'lifetime_budget' then (mp.intended_after->>'lifetime_budget_minor')::bigint
      else null end,
    ap.currency,
    coalesce((mp.planned_payload ->> 'change_bps')::integer, 0),
    coalesce(mp.planned_payload ->> 'direction', 'UNKNOWN'),
    coalesce(mp.source_rule_key, 'unknown'),
    mp.status,
    mp.payload_hash,
    mp.source_marketing_sync_id,
    mp.created_at,
    mp.created_at + interval '2 hours',
    mp.created_at + interval '2 hours' <= now(),
    pa.marketing_sync_status = 'success'
      and pa.marketing_sync_id = mp.source_marketing_sync_id
      and pa.marketing_last_success_at >= now() - interval '2 hours'
      and pa.marketing_last_success_at <= now() + interval '1 minute',
    approval.approved_at
  from public.mutation_plans mp
  join public.platform_accounts pa
    on pa.id = mp.platform_account_id
   and pa.user_id = mp.user_id
   and pa.platform = 'meta'
  join public.automation_policies ap
    on ap.id = mp.policy_id
   and ap.user_id = mp.user_id
   and ap.platform_account_id = mp.platform_account_id
  join public.automation_targets at
    on at.id = mp.automation_target_id
   and at.user_id = mp.user_id
   and at.platform_account_id = mp.platform_account_id
  left join public.campaigns c
    on c.id = at.campaign_id
   and c.user_id = mp.user_id
   and c.platform_account_id = mp.platform_account_id
  left join public.meta_budget_canary_approvals approval
    on approval.plan_id = mp.id
   and approval.user_id = mp.user_id
   and approval.platform_account_id = mp.platform_account_id
  where mp.user_id = v_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.action_type = 'UPDATE_BUDGET'
    and not mp.safety_action
    and mp.created_at >= now() - interval '7 days'
  order by mp.created_at desc
  limit 20;
end;
$$;

create or replace function public.approve_meta_budget_canary_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid,
  p_expected_payload_hash text,
  p_expected_before_minor bigint,
  p_intended_after_minor bigint,
  p_reason text
)
returns table (
  approval_id uuid,
  plan_id uuid,
  plan_status text,
  executable_at timestamptz,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.mutation_plans%rowtype;
  v_policy public.automation_policies%rowtype;
  v_account public.platform_accounts%rowtype;
  v_target public.automation_targets%rowtype;
  v_existing public.meta_budget_canary_approvals%rowtype;
  v_approval_id uuid := gen_random_uuid();
  v_approved_at timestamptz := now();
  v_kill_mode text;
  v_managed_budget_owner_count integer;
  v_current_budget bigint;
  v_intended_budget bigint;
begin
  if p_expected_payload_hash !~ '^[0-9a-f]{64}$'
    or p_expected_before_minor <= 0
    or p_intended_after_minor <= 0
    or nullif(trim(p_reason), '') is null
    or char_length(trim(p_reason)) not between 12 and 500 then
    raise exception 'Invalid budget canary confirmation';
  end if;

  select mp.* into v_plan
  from public.mutation_plans mp
  where mp.id = p_plan_id
    and mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.action_type = 'UPDATE_BUDGET'
    and not mp.safety_action
  for update;

  if not found then
    raise exception 'Budget canary plan is invalid';
  end if;

  select approval.* into v_existing
  from public.meta_budget_canary_approvals approval
  where approval.plan_id = v_plan.id;

  if found then
    if v_existing.payload_hash <> p_expected_payload_hash
      or v_existing.expected_before_minor <> p_expected_before_minor
      or v_existing.intended_after_minor <> p_intended_after_minor then
      raise exception 'Budget canary confirmation fingerprint mismatch';
    end if;

    return query select
      v_existing.id,
      v_plan.id,
      v_plan.status,
      v_plan.not_before,
      v_existing.approved_at;
    return;
  end if;

  if v_plan.status <> 'PENDING'
    or v_plan.attempt_count <> 0
    or v_plan.not_before <> 'infinity'::timestamptz then
    raise exception 'Budget canary plan is not awaiting confirmation';
  end if;

  if public.meta_budget_plan_type(v_plan) = 'daily_budget' then
    if not (v_plan.expected_before ? 'daily_budget_minor')
      or not (v_plan.intended_after ? 'daily_budget_minor')
      or v_plan.expected_before ? 'lifetime_budget_minor'
      or v_plan.intended_after ? 'lifetime_budget_minor' then
      raise exception 'Budget canary contains mixed budget fields';
    end if;
    v_current_budget := (v_plan.expected_before->>'daily_budget_minor')::bigint;
    v_intended_budget := (v_plan.intended_after->>'daily_budget_minor')::bigint;
  elsif public.meta_budget_plan_type(v_plan) = 'lifetime_budget' then
    if not (v_plan.expected_before ? 'lifetime_budget_minor')
      or not (v_plan.intended_after ? 'lifetime_budget_minor')
      or v_plan.expected_before ? 'daily_budget_minor'
      or v_plan.intended_after ? 'daily_budget_minor' then
      raise exception 'Budget canary contains mixed budget fields';
    end if;
    v_current_budget := (v_plan.expected_before->>'lifetime_budget_minor')::bigint;
    v_intended_budget := (v_plan.intended_after->>'lifetime_budget_minor')::bigint;
  else
    raise exception 'Unsupported budget canary type';
  end if;

  if v_plan.payload_hash <> p_expected_payload_hash
    or v_current_budget <> p_expected_before_minor
    or v_intended_budget <> p_intended_after_minor
    or (v_plan.planned_payload ->> 'amount_minor')::bigint <> p_intended_after_minor then
    raise exception 'Budget canary confirmation fingerprint mismatch';
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
    and pa.marketing_currency = 'EUR'
    and pa.marketing_sync_id = v_plan.source_marketing_sync_id
    and pa.marketing_sync_status = 'success'
    and pa.marketing_last_success_at is not null
    and 'ads_management' = any(pa.meta_scopes)
  for share;

  if not found then
    raise exception 'Fresh write-ready EUR Meta account is required';
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = v_plan.policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
    and ap.currency = 'EUR'
    and ap.allow_budget_changes
    and not ap.allow_status_changes
    and not ap.allow_new_launches
  for share;

  if not found then
    raise exception 'Budget-only canary policy is required';
  end if;

  select at.* into v_target
  from public.automation_targets at
  where at.id = v_plan.automation_target_id
    and at.user_id = p_user_id
    and at.platform_account_id = p_platform_account_id
    and at.status = 'MANAGED'
    and at.budget_owner_key is not null
  for share;

  if not found
    or v_target.target_type <> v_plan.target_type
    or v_target.target_key <> v_plan.target_key then
    raise exception 'Managed canary budget owner is required';
  end if;

  select count(*)::integer into v_managed_budget_owner_count
  from public.automation_targets at
  where at.user_id = p_user_id
    and at.platform_account_id = p_platform_account_id
    and at.status = 'MANAGED'
    and at.budget_owner_key is not null;

  if v_managed_budget_owner_count <> 1 then
    raise exception 'Exactly one managed budget owner is required for the canary';
  end if;

  if exists (
    select 1
    from public.mutation_plans other
    where other.user_id = p_user_id
      and other.platform_account_id = p_platform_account_id
      and other.id <> v_plan.id
      and not other.safety_action
      and other.status in ('PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING')
      and other.not_before <= now()
  ) then
    raise exception 'Another non-safety Meta mutation is executable';
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'ALLOW' then
    raise exception 'Account writes must be explicitly allowed for the canary';
  end if;

  insert into public.meta_budget_canary_approvals (
    id, user_id, platform_account_id, plan_id, payload_hash,
    expected_before_minor, intended_after_minor, reason,
    approved_by, approved_at
  ) values (
    v_approval_id, p_user_id, p_platform_account_id, v_plan.id,
    p_expected_payload_hash, p_expected_before_minor, p_intended_after_minor,
    trim(p_reason), p_user_id, v_approved_at
  );

  perform public.append_meta_kill_switch_state(
    'PLAN',
    p_user_id,
    p_platform_account_id,
    v_plan.id,
    'ALLOW',
    'Exakter Budget-Canary kundenseitig bestätigt',
    'CUSTOMER',
    p_user_id::text
  );

  update public.mutation_plans
  set not_before = v_approved_at, updated_at = v_approved_at
  where id = v_plan.id;

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    v_plan.policy_id,
    v_plan.id,
    null,
    null,
    'CUSTOMER',
    p_user_id::text,
    'BUDGET_CANARY_PLAN_APPROVED',
    jsonb_build_object('not_before', 'infinity'),
    jsonb_build_object(
      'payload_hash', p_expected_payload_hash,
      'expected_before_minor', p_expected_before_minor,
      'intended_after_minor', p_intended_after_minor,
      'reason', trim(p_reason)
    ),
    '{}'::jsonb,
    jsonb_build_object('not_before', v_approved_at),
    jsonb_build_object('approval_id', v_approval_id),
    null, null, null, null, null, v_approved_at
  );

  return query select
    v_approval_id,
    v_plan.id,
    'PENDING'::text,
    v_approved_at,
    v_approved_at;
end;
$$;

create or replace function public.guard_meta_budget_canary_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.action_type = 'UPDATE_BUDGET'
    and not old.safety_action
    and old.not_before = 'infinity'::timestamptz
    and new.not_before <> 'infinity'::timestamptz then
    if old.created_at + interval '2 hours' <= now() then
      raise exception 'Budget canary plan has expired';
    end if;

    if not exists (
      select 1
      from public.meta_budget_canary_approvals approval
      where approval.plan_id = old.id
        and approval.user_id = old.user_id
        and approval.platform_account_id = old.platform_account_id
        and approval.payload_hash = old.payload_hash
        and public.meta_budget_plan_type(old) in ('daily_budget', 'lifetime_budget')
        and approval.expected_before_minor = case public.meta_budget_plan_type(old)
          when 'daily_budget' then (old.expected_before->>'daily_budget_minor')::bigint
          when 'lifetime_budget' then (old.expected_before->>'lifetime_budget_minor')::bigint
        end
        and approval.intended_after_minor = case public.meta_budget_plan_type(old)
          when 'daily_budget' then (old.intended_after->>'daily_budget_minor')::bigint
          when 'lifetime_budget' then (old.intended_after->>'lifetime_budget_minor')::bigint
        end
    ) then
      raise exception 'Exact budget canary approval is required';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.materialize_meta_customer_lifetime_budget_canary_plan(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_campaign_id uuid,
  p_read_lease_token uuid,
  p_expected_before_minor bigint,
  p_intended_after_minor bigint,
  p_reason text,
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
  v_campaign public.campaigns%rowtype;
  v_target public.automation_targets%rowtype;
  v_existing_plan public.mutation_plans%rowtype;
  v_kill_mode text;
  v_write_mode text;
  v_campaign_scope_key text;
  v_remote_status text;
  v_latest_change timestamptz;
  v_baseline_budget bigint;
  v_movement_used bigint;
  v_movement_limit bigint;
  v_candidate_delta bigint;
  v_change_bps integer;
  v_direction text;
  v_payload jsonb;
  v_payload_hash text;
  v_idempotency_key text;
  v_plan_id uuid := gen_random_uuid();
  v_step_validate uuid := gen_random_uuid();
  v_step_mutate uuid := gen_random_uuid();
  v_step_read uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_validate_request jsonb;
  v_mutate_request jsonb;
  v_read_request jsonb;
  v_reconcile_request jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_planned_at is null
    or p_read_lease_token is null
    or p_expected_before_minor is null
    or p_intended_after_minor is null
    or p_expected_before_minor <= 0
    or p_intended_after_minor <= 0
    or p_expected_before_minor = p_intended_after_minor
    or char_length(v_reason) not between 12 and 500
    or v_reason ~ '[[:cntrl:]]' then
    raise exception 'Invalid lifetime budget canary request';
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
    and pa.marketing_currency = 'EUR'
    and pa.marketing_sync_status = 'success'
    and pa.marketing_sync_id is not null
    and pa.marketing_last_success_at is not null
    and pa.marketing_last_success_at >= p_planned_at - interval '2 hours'
    and pa.marketing_last_success_at <= p_planned_at + interval '1 minute'
    and 'ads_management' = any(pa.meta_scopes)
  for update;
  if not found then
    raise exception 'Fresh write-ready EUR Meta account is required';
  end if;

  if not exists (
    select 1 from public.meta_account_operation_leases lease
    where lease.platform_account_id = p_platform_account_id
      and lease.user_id = p_user_id
      and lease.lease_kind = 'READ_SYNC'
      and lease.lease_token = p_read_lease_token
      and lease.expires_at > now()
  ) then
    raise exception 'Active READ_SYNC lease is required';
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
    and ap.currency = 'EUR'
    and ap.allow_budget_changes
    and not ap.allow_status_changes
    and not ap.allow_new_launches
    and ap.budget_change_limit_bps > 0
    and ap.cooldown_seconds >= 43200
  for update;
  if not found then
    raise exception 'Budget-only canary policy is required';
  end if;

  select effective.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) effective;
  if coalesce(v_kill_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    raise exception 'Account writes must remain frozen while preparing the canary';
  end if;

  select mode into v_write_mode
  from public.meta_account_write_modes
  where user_id = p_user_id
    and platform_account_id = p_platform_account_id;
  if coalesce(v_write_mode, 'CONFIRM_EACH_BUDGET') <> 'CONFIRM_EACH_BUDGET' then
    raise exception 'Per-plan budget confirmation mode is required';
  end if;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = p_campaign_id
    and c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
  for update;
  if not found
    or v_campaign.platform_campaign_id is null
    or v_campaign.daily_budget_minor is not null
    or v_campaign.lifetime_budget_minor is distinct from p_expected_before_minor
    or v_campaign.last_seen_sync_id is distinct from v_account.marketing_sync_id
    or coalesce(v_campaign.effective_status, v_campaign.status, 'UNKNOWN') <> 'ACTIVE' then
    raise exception 'Selected lifetime campaign is stale, inactive or drifted';
  end if;

  if not exists (
    select 1 from public.automation_scope_selections selection
    where selection.user_id = p_user_id
      and selection.platform_account_id = p_platform_account_id
      and selection.selection_type = 'CAMPAIGN'
      and selection.campaign_id = p_campaign_id
      and selection.status = 'MANAGED'
  ) then
    raise exception 'Customer-managed campaign scope is required';
  end if;

  v_campaign_scope_key := 'campaign:' || v_campaign.platform_campaign_id;
  v_remote_status := coalesce(v_campaign.effective_status, v_campaign.status, 'UNKNOWN');

  select target.* into v_target
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'CAMPAIGN'
    and target.campaign_id = p_campaign_id
    and target.platform_object_id = v_campaign.platform_campaign_id
    and target.status <> 'RETIRED'
  order by target.created_at, target.id
  limit 1
  for update;
  if not found then
    raise exception 'Canonical campaign automation target is required';
  end if;

  update public.automation_targets target
  set target_key = v_campaign_scope_key,
      campaign_scope_key = v_campaign_scope_key,
      budget_owner_type = 'CAMPAIGN',
      budget_owner_key = v_campaign_scope_key,
      status = 'MANAGED',
      row_version = target.row_version + 1,
      updated_at = p_planned_at
  where target.id = v_target.id
  returning target.* into v_target;

  if v_target.status <> 'MANAGED'
    or v_target.budget_owner_type <> 'CAMPAIGN'
    or v_target.budget_owner_key <> v_campaign_scope_key then
    raise exception 'Managed lifetime campaign budget target is required';
  end if;

  if exists (
    select 1 from public.automation_targets other
    where other.user_id = p_user_id
      and other.platform_account_id = p_platform_account_id
      and other.id <> v_target.id
      and other.status = 'MANAGED'
      and other.budget_owner_key is not null
  ) then
    raise exception 'Exactly one managed budget owner is required for the canary';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':budget-owner:' || v_target.budget_owner_key,
      0
    )
  );

  select existing.* into v_existing_plan
  from public.mutation_plans existing
  where existing.user_id = p_user_id
    and existing.platform_account_id = p_platform_account_id
    and not existing.safety_action
    and existing.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by existing.created_at desc
  limit 1;
  if found then
    if v_existing_plan.action_type = 'UPDATE_BUDGET'
      and v_existing_plan.automation_target_id = v_target.id
      and v_existing_plan.planned_payload->>'budget_type' = 'lifetime_budget'
      and (v_existing_plan.expected_before->>'lifetime_budget_minor')::bigint
        = p_expected_before_minor
      and (v_existing_plan.intended_after->>'lifetime_budget_minor')::bigint
        = p_intended_after_minor then
      return jsonb_build_object(
        'outcome', 'EXISTING', 'plan_id', v_existing_plan.id,
        'status', v_existing_plan.status,
        'payload_hash', v_existing_plan.payload_hash,
        'before_budget_minor', p_expected_before_minor,
        'after_budget_minor', p_intended_after_minor
      );
    end if;
    raise exception 'Another non-safety Meta mutation is active';
  end if;

  select max(ledger.executed_at), coalesce(sum(ledger.absolute_delta_minor), 0)
  into v_latest_change, v_movement_used
  from public.budget_mutation_ledger ledger
  where ledger.platform_account_id = p_platform_account_id
    and ledger.budget_owner_key = v_target.budget_owner_key
    and ledger.executed_at > p_planned_at - interval '24 hours'
    and ledger.executed_at <= p_planned_at;

  if v_target.last_successful_mutation_at is not null
    and (v_latest_change is null
      or v_target.last_successful_mutation_at > v_latest_change) then
    v_latest_change := v_target.last_successful_mutation_at;
  end if;
  if v_latest_change is not null
    and v_latest_change + make_interval(secs => v_policy.cooldown_seconds)
      > p_planned_at then
    raise exception 'Budget owner is inside the cooldown window';
  end if;

  select ledger.before_budget_minor into v_baseline_budget
  from public.budget_mutation_ledger ledger
  where ledger.platform_account_id = p_platform_account_id
    and ledger.budget_owner_key = v_target.budget_owner_key
    and ledger.executed_at > p_planned_at - interval '24 hours'
    and ledger.executed_at <= p_planned_at
  order by ledger.executed_at, ledger.created_at
  limit 1;

  v_baseline_budget := coalesce(v_baseline_budget, p_expected_before_minor);
  v_movement_limit :=
    (v_baseline_budget * v_policy.budget_change_limit_bps) / 10000;
  v_candidate_delta := abs(p_intended_after_minor - p_expected_before_minor);
  v_change_bps := (
    (v_candidate_delta * 10000 + p_expected_before_minor - 1)
      / p_expected_before_minor
  )::integer;
  v_direction := case
    when p_intended_after_minor > p_expected_before_minor then 'INCREASE'
    else 'DECREASE'
  end;

  if v_movement_limit <= 0
    or v_change_bps > v_policy.budget_change_limit_bps
    or v_movement_used + v_candidate_delta > v_movement_limit then
    raise exception 'Lifetime budget canary exceeds the rolling 24-hour limit';
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 2,
    'operation', 'UPDATE_BUDGET',
    'object_type', 'CAMPAIGN',
    'object_id', v_campaign.platform_campaign_id,
    'target_key', v_target.target_key,
    'budget_type', 'lifetime_budget',
    'amount_minor', p_intended_after_minor,
    'direction', v_direction,
    'change_bps', v_change_bps,
    'rule_key', 'operator_lifetime_budget_canary_v2',
    'rule_version', 2,
    'source_marketing_sync_id', v_account.marketing_sync_id,
    'evidence', jsonb_build_object(
      'source', 'customer_confirmed_lifetime_canary',
      'reason', v_reason,
      'requested_at', p_planned_at
    )
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || v_policy.id::text || '|' || v_policy.policy_hash || '|'
    || v_account.marketing_sync_id::text
    || '|operator_lifetime_budget_canary_v2|2|CAMPAIGN|'
    || v_target.target_key || '|' || p_expected_before_minor::text || '|'
    || p_intended_after_minor::text || '|' || v_payload_hash
  );

  select existing.* into v_existing_plan
  from public.mutation_plans existing
  where existing.idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object(
      'outcome', 'EXISTING', 'plan_id', v_existing_plan.id,
      'status', v_existing_plan.status,
      'payload_hash', v_existing_plan.payload_hash,
      'before_budget_minor', p_expected_before_minor,
      'after_budget_minor', p_intended_after_minor
    );
  end if;

  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id,
    source_marketing_sync_id, source_recommendation_id,
    source_rule_key, source_rule_version, action_type, target_type,
    target_key, campaign_scope_key, budget_owner_key,
    automation_target_id, idempotency_key, expected_before,
    intended_after, planned_payload, payload_hash, status, priority,
    safety_action, not_before, max_attempts, created_at, updated_at
  ) values (
    v_plan_id, p_user_id, p_platform_account_id, v_policy.id,
    v_account.marketing_sync_id, null,
    'operator_lifetime_budget_canary_v2', 2, 'UPDATE_BUDGET', 'CAMPAIGN',
    v_target.target_key, v_campaign_scope_key, v_target.budget_owner_key,
    v_target.id, v_idempotency_key,
    jsonb_build_object(
      'lifetime_budget_minor', p_expected_before_minor,
      'status', v_remote_status,
      'source_marketing_sync_id', v_account.marketing_sync_id
    ),
    jsonb_build_object('lifetime_budget_minor', p_intended_after_minor),
    v_payload, v_payload_hash, 'PENDING', 95,
    false, p_planned_at, 1, p_planned_at, p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_BUDGET', 'object_type', 'CAMPAIGN',
    'object_id', v_campaign.platform_campaign_id,
    'budget_type', 'lifetime_budget',
    'amount_minor', p_intended_after_minor, 'mode', 'validate_only'
  );
  v_mutate_request :=
    v_validate_request || jsonb_build_object('mode', 'execute');
  v_read_request := jsonb_build_object(
    'object_type', 'CAMPAIGN', 'object_id', v_campaign.platform_campaign_id,
    'fields', jsonb_build_array(
      'id', 'status', 'effective_status', 'daily_budget',
      'lifetime_budget', 'updated_time'
    )
  );
  v_reconcile_request := jsonb_build_object(
    'budget_type', 'lifetime_budget',
    'expected_lifetime_budget_minor', p_intended_after_minor,
    'budget_owner_key', v_target.budget_owner_key
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-lifetime-budget-update', 'VALIDATE', 'CAMPAIGN', null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-lifetime-budget-update', 'UPDATE', 'CAMPAIGN',
    v_step_validate, v_mutate_request,
    public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('lifetime_budget_minor', p_intended_after_minor),
    'PAUSE', 'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-lifetime-budget-update', 'READ', 'CAMPAIGN',
    v_step_mutate, v_read_request, public.meta_sha256(v_read_request::text),
    jsonb_build_object('lifetime_budget_minor', p_intended_after_minor),
    'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-lifetime-budget-update', 'RECONCILE', 'CAMPAIGN',
    v_step_read, v_reconcile_request,
    public.meta_sha256(v_reconcile_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'), 'NONE', 'PENDING'
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, v_policy.id, v_plan_id,
    null, null, 'CUSTOMER', p_user_id::text,
    'LIFETIME_BUDGET_CANARY_PLAN_MATERIALIZED',
    jsonb_build_object(
      'lifetime_budget_minor', p_expected_before_minor,
      'status', v_remote_status
    ),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object(
      'lifetime_budget_minor', p_intended_after_minor,
      'plan_status', 'PENDING', 'not_before', 'infinity'
    ),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash,
      'remote_write_performed', false,
      'daily_hard_cap_applied', false
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED', 'plan_id', v_plan_id, 'status', 'PENDING',
    'budget_type', 'LIFETIME',
    'before_budget_minor', p_expected_before_minor,
    'after_budget_minor', p_intended_after_minor,
    'payload_hash', v_payload_hash
  );
end;
$$;

create or replace function public.begin_meta_mutation_step_dispatch(
  p_execution_id uuid,
  p_step_id uuid,
  p_lease_token uuid
)
returns table (
  plan_id uuid,
  operation text,
  object_type text,
  planned_request jsonb,
  request_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.mutation_executions%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_step public.mutation_plan_steps%rowtype;
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_asset public.brand_assets%rowtype;
  v_kill_mode text;
  v_latest_change timestamptz;
  v_baseline_budget bigint;
  v_movement_used bigint;
  v_movement_limit bigint;
  v_before_budget bigint;
  v_after_budget bigint;
begin
  select me.* into v_execution
  from public.mutation_executions me
  where me.id = p_execution_id
    and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING')
  for update;

  if not found then
    raise exception 'Active Meta execution lease is required';
  end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id
    and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
    and mp.status in ('CLAIMED', 'EXECUTING')
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id
    and mps.plan_id = v_plan.id
    and mps.status = 'CLAIMED'
  for update;

  if not found or v_step.operation not in ('VALIDATE', 'CREATE', 'UPDATE', 'COMPENSATE') then
    raise exception 'Claimed remote mutation step is required';
  end if;

  if v_step.dispatch_state <> 'NOT_DISPATCHED' then
    raise exception 'Mutation step was already dispatched';
  end if;

  if public.meta_sha256(v_step.planned_request::text) <> v_step.request_hash then
    raise exception 'Mutation step request hash mismatch';
  end if;

  if v_plan.action_type = 'LAUNCH_CHAIN' then
    if not public.meta_launch_canary_preflight_ok(v_plan.id) then
      raise exception 'Launch canary preflight drifted before remote dispatch';
    end if;

    if not public.meta_launch_activation_barrier_ok(v_plan.id, v_step.id) then
      raise exception 'Launch activation barrier is not satisfied';
    end if;
  end if;

  select ap.* into v_policy from public.automation_policies ap
  where ap.id = v_plan.policy_id and ap.user_id = v_plan.user_id
    and ap.platform_account_id = v_plan.platform_account_id
    and ap.is_current and ap.status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'Active current automation policy is required';
  end if;

  select mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    v_plan.user_id, v_plan.platform_account_id, v_plan.id
  );
  if v_kill_mode <> 'ALLOW' then
    raise exception 'Meta writes are blocked by kill switch';
  end if;

  if v_plan.automation_target_id is not null then
    select at.* into v_target from public.automation_targets at
    where at.id = v_plan.automation_target_id and at.status = 'MANAGED'
    for update;
    if not found or not public.meta_executor_before_matches(v_plan, v_target) then
      raise exception 'Meta target before-state drifted';
    end if;
  end if;

  if v_step.object_type = 'IMAGE' then
    if v_step.operation <> 'CREATE'
      or v_step.planned_request->>'operation' <> 'UPLOAD_IMAGE'
      or coalesce(v_step.planned_request->>'brand_asset_id', '')
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_step.planned_request->>'asset_sha256', '')
           !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid Brand Asset upload request';
    end if;

    select ba.* into v_asset
    from public.brand_assets ba
    where ba.id = (v_step.planned_request->>'brand_asset_id')::uuid
      and ba.user_id = v_plan.user_id
      and ba.platform_account_id = v_plan.platform_account_id
      and ba.status = 'READY'
      and ba.moderation_status = 'APPROVED'
      and ba.sha256 = v_step.planned_request->>'asset_sha256'
      and ba.storage_bucket is not null
      and ba.storage_path is not null
      and ba.mime_type in ('image/png', 'image/jpeg')
      and ba.byte_size between 1 and 31457280
    for share;

    if not found then
      raise exception 'Matching ready Brand Asset upload is required';
    end if;

    if v_asset.meta_image_hash is not null then
      raise exception 'Brand Asset is already uploaded to Meta';
    end if;
  end if;

  if v_plan.action_type = 'UPDATE_BUDGET' and v_step.operation = 'UPDATE' then
    if public.meta_budget_plan_type(v_plan) = 'daily_budget' then
      v_before_budget := (v_plan.expected_before->>'daily_budget_minor')::bigint;
      v_after_budget := (v_plan.intended_after->>'daily_budget_minor')::bigint;
    elsif public.meta_budget_plan_type(v_plan) = 'lifetime_budget' then
      v_before_budget := (v_plan.expected_before->>'lifetime_budget_minor')::bigint;
      v_after_budget := (v_plan.intended_after->>'lifetime_budget_minor')::bigint;
    else
      raise exception 'Unsupported budget type';
    end if;

    if coalesce(
        v_step.planned_request->>'budget_type',
        case when not (v_plan.planned_payload ? 'budget_type')
          then public.meta_budget_plan_type(v_plan) else null end
      ) is distinct from public.meta_budget_plan_type(v_plan)
      or coalesce(v_step.planned_request->>'amount_minor', '') !~ '^[0-9]+$'
      or (v_step.planned_request->>'amount_minor')::bigint <> v_after_budget then
      raise exception 'Budget dispatch request does not match immutable plan';
    end if;

    select
      max(bml.executed_at), coalesce(sum(bml.absolute_delta_minor), 0)
    into v_latest_change, v_movement_used
    from public.budget_mutation_ledger bml
    where bml.platform_account_id = v_plan.platform_account_id
      and bml.budget_owner_key = v_plan.budget_owner_key
      and bml.executed_at > now() - interval '24 hours'
      and bml.executed_at <= now();

    if v_target.last_successful_mutation_at is not null
      and (v_latest_change is null
           or v_target.last_successful_mutation_at > v_latest_change) then
      v_latest_change := v_target.last_successful_mutation_at;
    end if;

    if v_latest_change is not null
      and v_latest_change + make_interval(secs => v_policy.cooldown_seconds) > now() then
      raise exception 'Budget mutation cooldown is active';
    end if;

    select bml.before_budget_minor into v_baseline_budget
    from public.budget_mutation_ledger bml
    where bml.platform_account_id = v_plan.platform_account_id
      and bml.budget_owner_key = v_plan.budget_owner_key
      and bml.executed_at > now() - interval '24 hours'
      and bml.executed_at <= now()
    order by bml.executed_at asc, bml.created_at asc
    limit 1;

    v_baseline_budget := coalesce(v_baseline_budget, v_before_budget);
    v_movement_limit :=
      (v_baseline_budget * v_policy.budget_change_limit_bps) / 10000;

    if v_movement_limit <= 0
      or v_movement_used + abs(v_after_budget - v_before_budget) > v_movement_limit then
      raise exception 'Rolling 24-hour budget movement limit exceeded';
    end if;

    if public.meta_budget_plan_type(v_plan) = 'daily_budget' then
      select dbe.* into v_exposure
      from public.daily_budget_exposures dbe
      join public.daily_budget_exposure_snapshots s on s.id = dbe.snapshot_id
      where dbe.user_id = v_plan.user_id
        and dbe.platform_account_id = v_plan.platform_account_id
        and dbe.policy_id = v_plan.policy_id
        and dbe.automation_target_id = v_plan.automation_target_id
        and dbe.budget_owner_key = v_plan.budget_owner_key
        and s.id = (v_plan.planned_payload->>'exposure_snapshot_id')::uuid
        and s.user_id = v_plan.user_id
        and s.platform_account_id = v_plan.platform_account_id
        and s.policy_id = v_plan.policy_id
        and s.source_marketing_sync_id = v_plan.source_marketing_sync_id
        and s.status = 'COMPLETE'
      order by dbe.updated_at desc
      limit 1
      for update of dbe;
  
      if not found then
        raise exception 'Matching budget exposure reservation is required';
      end if;
  
      select s.* into strict v_snapshot
      from public.daily_budget_exposure_snapshots s
      where s.id = v_exposure.snapshot_id
        and s.user_id = v_plan.user_id
        and s.platform_account_id = v_plan.platform_account_id
        and s.status = 'COMPLETE'
      for share;
  
      perform public.reserve_meta_daily_budget_exposure(
        v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
        v_snapshot.id, v_plan.id, v_plan.automation_target_id,
        v_snapshot.account_day, v_plan.campaign_scope_key,
        v_plan.budget_owner_key, v_target.budget_owner_type,
        v_exposure.shared_budget_enabled, 'EUR', v_after_budget,
        greatest(
          v_exposure.flex_spend_multiplier_bps,
          case when v_exposure.shared_budget_enabled
            then v_policy.shared_budget_flex_spend_multiplier_bps
            else v_policy.standard_flex_spend_multiplier_bps end
        ),
        'PLAN'
      );
    elsif public.meta_budget_plan_type(v_plan) = 'lifetime_budget' then
      if v_target.target_type <> 'CAMPAIGN'
        or v_target.budget_owner_type <> 'CAMPAIGN'
        or v_plan.planned_payload ? 'exposure_snapshot_id' then
        raise exception 'Lifetime budget canary must be campaign-owned and daily-cap independent';
      end if;
    else
      raise exception 'Unsupported budget type';
    end if;
  end if;

  update public.mutation_plan_steps
  set status = 'RUNNING', dispatch_state = 'PRE_DISPATCH',
      dispatch_started_at = now(), updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = 'RUNNING', last_heartbeat_at = now()
  where id = v_execution.id;

  update public.mutation_plans
  set status = 'EXECUTING', updated_at = now()
  where id = v_plan.id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'EXECUTOR', v_execution.worker_id,
    'MUTATION_STEP_PRE_DISPATCH',
    jsonb_build_object('step_status', 'CLAIMED', 'dispatch_state', 'NOT_DISPATCHED'),
    jsonb_build_object('request_hash', v_step.request_hash), '{}'::jsonb,
    jsonb_build_object('step_status', 'RUNNING', 'dispatch_state', 'PRE_DISPATCH'),
    jsonb_build_object('operation', v_step.operation, 'object_type', v_step.object_type),
    null, null, null, null, null, now()
  );

  return query select v_plan.id, v_step.operation, v_step.object_type,
    v_step.planned_request, v_step.request_hash;
end;
$$;

create or replace function public.reconcile_meta_mutation_plan_base(
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
  v_target public.automation_targets%rowtype;
  v_snapshot public.meta_mutation_remote_snapshots%rowtype;
  v_mutate_step public.mutation_plan_steps%rowtype;
  v_ledger_id uuid;
  v_matches boolean := false;
  v_observed_budget bigint;
  v_expected_budget bigint;
  v_before_budget bigint;
  v_budget_type text;
  v_observed_status text;
  v_expected_status text;
begin
  select me.* into v_execution from public.mutation_executions me
  where me.id = p_execution_id and me.lease_token = p_lease_token
    and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING')
  for update;
  if not found then raise exception 'Active Meta execution is required'; end if;

  select mp.* into v_plan from public.mutation_plans mp
  where mp.id = v_execution.plan_id and mp.lease_token = p_lease_token
    and mp.lease_expires_at > now()
  for update;

  select mps.* into v_step from public.mutation_plan_steps mps
  where mps.id = p_step_id and mps.plan_id = v_plan.id
    and mps.operation = 'RECONCILE' and mps.status in ('CLAIMED', 'RUNNING', 'RETRYABLE')
  for update;
  if not found then raise exception 'Claimed reconciliation step is required'; end if;

  select at.* into v_target from public.automation_targets at
  where at.id = v_plan.automation_target_id
    and at.user_id = v_plan.user_id
    and at.platform_account_id = v_plan.platform_account_id
  for update;

  select s.* into v_snapshot
  from public.meta_mutation_remote_snapshots s
  where s.plan_id = v_plan.id
    and s.snapshot_kind in ('READ_AFTER_WRITE', 'AMBIGUITY_PROBE')
  order by s.observed_at desc, s.created_at desc
  limit 1;
  if not found then raise exception 'Read-after-write snapshot is required'; end if;

  if v_plan.action_type = 'UPDATE_BUDGET' then
    v_budget_type := public.meta_budget_plan_type(v_plan);
    if v_budget_type = 'daily_budget' then
      v_before_budget := (v_plan.expected_before->>'daily_budget_minor')::bigint;
      v_expected_budget := (v_plan.intended_after->>'daily_budget_minor')::bigint;
      if coalesce(v_snapshot.snapshot_payload->>'daily_budget', '') ~ '^[0-9]+$' then
        v_observed_budget := (v_snapshot.snapshot_payload->>'daily_budget')::bigint;
      elsif coalesce(v_snapshot.snapshot_payload->>'daily_budget_minor', '') ~ '^[0-9]+$' then
        v_observed_budget := (v_snapshot.snapshot_payload->>'daily_budget_minor')::bigint;
      end if;
    elsif v_budget_type = 'lifetime_budget' then
      v_before_budget := (v_plan.expected_before->>'lifetime_budget_minor')::bigint;
      v_expected_budget := (v_plan.intended_after->>'lifetime_budget_minor')::bigint;
      if coalesce(v_snapshot.snapshot_payload->>'lifetime_budget', '') ~ '^[0-9]+$' then
        v_observed_budget := (v_snapshot.snapshot_payload->>'lifetime_budget')::bigint;
      elsif coalesce(v_snapshot.snapshot_payload->>'lifetime_budget_minor', '') ~ '^[0-9]+$' then
        v_observed_budget := (v_snapshot.snapshot_payload->>'lifetime_budget_minor')::bigint;
      end if;
    end if;
    v_matches := v_observed_budget is not null and v_observed_budget = v_expected_budget;
  elsif v_plan.action_type in ('PAUSE', 'ACTIVATE', 'SAFETY_PAUSE') then
    v_expected_status := v_plan.intended_after->>'status';
    v_observed_status := coalesce(
      v_snapshot.snapshot_payload->>'status',
      v_snapshot.snapshot_payload->>'effective_status'
    );
    v_matches := v_expected_status in ('ACTIVE', 'PAUSED')
      and v_observed_status = v_expected_status;
  else
    v_matches := v_snapshot.remote_object_id is not null;
  end if;

  if not v_matches then
    update public.mutation_plan_steps
    set status = case when attempt_count < 5 then 'RETRYABLE'
                      else 'COMPENSATION_REQUIRED' end,
        dispatch_state = 'READ_BACK', dispatch_started_at = coalesce(dispatch_started_at, now()),
        remote_applied_at = coalesce(remote_applied_at, now()),
        error_class = 'RECONCILIATION', error_code = 'remote_state_mismatch',
        not_before = now() + interval '2 minutes', updated_at = now()
    where id = v_step.id;

    update public.mutation_executions
    set status = case when v_plan.attempt_count < v_plan.max_attempts
                      then 'RETRYABLE' else 'COMPENSATION_REQUIRED' end,
        finished_at = now(), error_class = 'RECONCILIATION',
        error_code = 'remote_state_mismatch'
    where id = v_execution.id;

    update public.mutation_plans
    set status = case when attempt_count < max_attempts
                      then 'RETRYABLE' else 'COMPENSATION_REQUIRED' end,
        not_before = now() + interval '2 minutes', lease_token = null,
        lease_owner = null, lease_expires_at = null,
        error_class = 'RECONCILIATION', blocked_reason = 'remote_state_mismatch',
        updated_at = now()
    where id = v_plan.id;

    perform public.release_meta_account_operation(
      v_plan.platform_account_id, v_plan.user_id, p_lease_token
    );

    update public.platform_accounts as pa
    set automation_executor_status = case when v_plan.attempt_count < v_plan.max_attempts
          then 'retryable' else 'error' end,
        automation_executor_error_code = 'remote_state_mismatch',
        automation_executor_last_run_at = now(), updated_at = now()
    where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

    return query select 'MISMATCH'::text, v_plan.id, null::uuid, v_snapshot.id;
    return;
  end if;

  select mps.* into v_mutate_step
  from public.mutation_plan_steps mps
  where mps.plan_id = v_plan.id
    and mps.operation in ('CREATE', 'UPDATE', 'COMPENSATE')
    and mps.status in ('REMOTE_APPLIED', 'RECONCILED')
  order by mps.step_index desc
  limit 1;

  if v_plan.action_type = 'UPDATE_BUDGET' then
    insert into public.budget_mutation_ledger (
      user_id, platform_account_id, policy_id, plan_id, step_id,
      execution_id, automation_target_id, budget_owner_key, currency,
      before_budget_minor, after_budget_minor, remote_request_id,
      executed_at, reconciled_at
    ) values (
      v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
      v_plan.id, v_mutate_step.id, v_execution.id, v_plan.automation_target_id,
      v_plan.budget_owner_key, 'EUR',
      v_before_budget,
      v_expected_budget,
      v_mutate_step.remote_request_id,
      coalesce(v_mutate_step.remote_applied_at, now()), now()
    ) on conflict on constraint budget_mutation_ledger_plan_step_key do nothing
    returning id into v_ledger_id;

    if v_target.target_type = 'CAMPAIGN' and v_budget_type = 'daily_budget' then
      update public.campaigns as c set daily_budget_minor = v_expected_budget,
        lifetime_budget_minor = null, last_seen_at = now(), updated_at = now()
      where c.id = v_target.campaign_id and c.user_id = v_plan.user_id;
    elsif v_target.target_type = 'CAMPAIGN' and v_budget_type = 'lifetime_budget' then
      update public.campaigns as c set lifetime_budget_minor = v_expected_budget,
        daily_budget_minor = null, last_seen_at = now(), updated_at = now()
      where c.id = v_target.campaign_id and c.user_id = v_plan.user_id;
    elsif v_target.target_type = 'AD_SET' and v_budget_type = 'daily_budget' then
      update public.ad_groups as ag set daily_budget_minor = v_expected_budget,
        lifetime_budget_minor = null, last_seen_at = now(), updated_at = now()
      where ag.id = v_target.ad_group_id and ag.user_id = v_plan.user_id;
    elsif v_target.target_type = 'AD_SET' and v_budget_type = 'lifetime_budget' then
      update public.ad_groups as ag set lifetime_budget_minor = v_expected_budget,
        daily_budget_minor = null, last_seen_at = now(), updated_at = now()
      where ag.id = v_target.ad_group_id and ag.user_id = v_plan.user_id;
    end if;
  elsif v_plan.action_type in ('PAUSE', 'ACTIVATE', 'SAFETY_PAUSE') then
    if v_target.target_type = 'CAMPAIGN' then
      update public.campaigns as c set status = v_expected_status,
        effective_status = v_expected_status, last_seen_at = now(), updated_at = now()
      where c.id = v_target.campaign_id and c.user_id = v_plan.user_id;
    elsif v_target.target_type = 'AD_SET' then
      update public.ad_groups as ag set status = v_expected_status,
        effective_status = v_expected_status, last_seen_at = now(), updated_at = now()
      where ag.id = v_target.ad_group_id and ag.user_id = v_plan.user_id;
    elsif v_target.target_type = 'AD' then
      update public.ads as ad_row set status = v_expected_status,
        effective_status = v_expected_status, last_seen_at = now(), updated_at = now()
      where ad_row.id = v_target.ad_id and ad_row.user_id = v_plan.user_id;
    end if;
  end if;

  if v_target.id is not null then
    update public.automation_targets
    set last_successful_mutation_at = now(), last_reconciled_at = now(),
        row_version = row_version + 1, updated_at = now()
    where id = v_target.id;
  end if;

  update public.mutation_plan_steps
  set status = 'RECONCILED', dispatch_state = 'RECONCILED',
      dispatch_started_at = coalesce(dispatch_started_at, now()),
      remote_applied_at = coalesce(remote_applied_at, now()),
      completed_at = now(), error_class = null, error_code = null,
      updated_at = now()
  where id = v_step.id;

  update public.mutation_executions
  set status = 'SUCCEEDED', finished_at = now(), last_heartbeat_at = now(),
      error_class = null, error_code = null
  where id = v_execution.id;

  update public.mutation_plans
  set status = 'SUCCEEDED', lease_token = null, lease_owner = null,
      lease_expires_at = null, terminal_at = now(), blocked_reason = null,
      error_class = null, updated_at = now()
  where id = v_plan.id;

  perform public.release_meta_account_operation(
    v_plan.platform_account_id, v_plan.user_id, p_lease_token
  );

  update public.platform_accounts as pa
  set automation_executor_status = 'success',
      automation_executor_error_code = null,
      automation_executor_last_run_at = now(),
      automation_executor_last_success_at = now(),
      automation_executor_last_plan_id = v_plan.id,
      updated_at = now()
  where pa.id = v_plan.platform_account_id and pa.user_id = v_plan.user_id;

  perform public.append_meta_mutation_audit_event(
    v_plan.user_id, v_plan.platform_account_id, v_plan.policy_id,
    v_plan.id, v_step.id, v_execution.id, 'RECONCILER',
    v_execution.worker_id, 'MUTATION_PLAN_RECONCILED',
    jsonb_build_object('plan_status', 'RECONCILING'),
    jsonb_build_object('expected_result', v_step.expected_result),
    jsonb_build_object('snapshot_id', v_snapshot.id,
                       'response_fingerprint', v_snapshot.response_fingerprint),
    jsonb_build_object('plan_status', 'SUCCEEDED', 'ledger_id', v_ledger_id),
    '{}'::jsonb, 'meta', null, null, v_mutate_step.remote_request_id,
    null, now()
  );

  return query select 'SUCCEEDED'::text, v_plan.id, v_ledger_id, v_snapshot.id;
end;
$$;


revoke all on function public.meta_budget_plan_type(public.mutation_plans)
  from public, anon, authenticated, service_role;

revoke all on function public.materialize_meta_customer_lifetime_budget_canary_plan(
  uuid, uuid, uuid, uuid, bigint, bigint, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.materialize_meta_customer_lifetime_budget_canary_plan(
  uuid, uuid, uuid, uuid, bigint, bigint, text, timestamptz
) to service_role;

comment on function public.materialize_meta_customer_lifetime_budget_canary_plan(
  uuid, uuid, uuid, uuid, bigint, bigint, text, timestamptz
) is
  'Materializes one explicit campaign Lifetime-budget update, bound to current Meta state, customer-managed scope, policy movement/cooldown limits and exact second approval; it does not apply daily exposure caps.';

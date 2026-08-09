-- Finish remaining hard-cap resumes:
-- 1) Resume helper required last_seen_sync_id = latest Abruf → blocked many PAUSED rows
-- 2) Terminal FAILED ACTIVATE plans blocked idempotent re-queue
-- 3) force_resume must revive those plans and not require latest sync id on candidates

begin;

-- ---------------------------------------------------------------------------
-- 1) Resume helper: is_current is enough (no last_seen_sync_id match)
-- ---------------------------------------------------------------------------
do $patch_resume$
declare
  v_function regprocedure :=
    'public.queue_meta_hard_cap_resume_internal(uuid,uuid,uuid,uuid,uuid,uuid,date,jsonb,timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if v_definition is null then
    raise exception 'queue_meta_hard_cap_resume_internal not found';
  end if;

  if position('resume_without_last_seen_sync' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'and c\\.is_current\\s+and c\\.last_seen_sync_id = p_source_marketing_sync_id\\s+for update;',
    $repl$and c.is_current
    -- resume_without_last_seen_sync: PAUSED rows may lag the latest Abruf id
  for update;$repl$,
    1
  );

  if position('resume_without_last_seen_sync' in v_updated) = 0 then
    raise exception
      'Could not drop last_seen_sync_id gate on queue_meta_hard_cap_resume_internal';
  end if;

  execute v_updated;
end;
$patch_resume$;

-- ---------------------------------------------------------------------------
-- 2) Stronger force-resume (revive FAILED ACTIVATE, no last_seen candidate gate)
-- ---------------------------------------------------------------------------
create or replace function public.force_resume_meta_organic_boost_hard_cap_pauses(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_source_marketing_sync_id uuid,
  p_planned_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_account public.platform_accounts%rowtype;
  v_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_account_day date;
  v_candidate record;
  v_result jsonb;
  v_created integer := 0;
  v_existing integer := 0;
  v_blocked integer := 0;
  v_revived integer := 0;
  v_exposures_cleared integer := 0;
  v_schedule_ended integer := 0;
begin
  if p_planned_at < now() - interval '5 minutes'
    or p_planned_at > now() + interval '1 minute' then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'invalid_planner_time',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'revived', 0,
      'exposures_cleared', 0,
      'schedule_ended', 0
    );
  end if;

  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'account_unavailable',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'revived', 0,
      'exposures_cleared', 0,
      'schedule_ended', 0
    );
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found or not v_policy.allow_status_changes then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'status_changes_not_allowed',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'revived', 0,
      'exposures_cleared', 0,
      'schedule_ended', 0
    );
  end if;

  if v_account.marketing_timezone_name is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names tz
      where tz.name = v_account.marketing_timezone_name
    ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'timezone_unavailable',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'revived', 0,
      'exposures_cleared', 0,
      'schedule_ended', 0
    );
  end if;

  v_account_day :=
    (p_planned_at at time zone v_account.marketing_timezone_name)::date;

  select s.* into v_snapshot
  from public.daily_budget_exposure_snapshots s
  where s.platform_account_id = p_platform_account_id
    and s.user_id = p_user_id
    and s.account_day = v_account_day
    and s.status = 'COMPLETE'
  order by
    case
      when s.source_marketing_sync_id = p_source_marketing_sync_id then 0
      else 1
    end,
    s.completed_at desc nulls last,
    s.created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'snapshot_unavailable',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'revived', 0,
      'exposures_cleared', 0,
      'schedule_ended', 0
    );
  end if;

  -- Revive terminal hard-cap ACTIVATE plans so idempotency cannot trap FAILED rows.
  begin
    alter table public.mutation_plans
      disable trigger guard_meta_mutation_plan_update;
    alter table public.mutation_plan_steps
      disable trigger guard_meta_mutation_step_update;

    with revived as (
      update public.mutation_plans mp
      set
        status = 'PENDING',
        attempt_count = 0,
        max_attempts = greatest(coalesce(mp.max_attempts, 1), 5),
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        error_class = null,
        blocked_reason = null,
        terminal_at = null,
        not_before = least(coalesce(mp.not_before, p_planned_at), p_planned_at),
        updated_at = p_planned_at
      where mp.user_id = p_user_id
        and mp.platform_account_id = p_platform_account_id
        and mp.source_rule_key = 'hard_cap_day_resume'
        and mp.action_type = 'ACTIVATE'
        and mp.safety_action
        and mp.status in (
          'FAILED', 'STALE', 'BLOCKED', 'CANCELLED', 'PREFLIGHT_FAILED'
        )
        and exists (
          select 1
          from public.automation_targets target
          join public.campaigns c
            on c.id = target.campaign_id
           and c.is_current
          join public.remote_object_bindings binding
            on binding.platform_account_id = c.platform_account_id
           and binding.user_id = c.user_id
           and binding.object_type = 'CAMPAIGN'
           and (
             binding.remote_object_id = c.platform_campaign_id
             or binding.local_campaign_id = c.id
           )
          join public.mutation_plans boost_plan
            on boost_plan.id = binding.plan_id
           and boost_plan.source_rule_key = 'organic-boost'
           and boost_plan.action_type = 'LAUNCH_CHAIN'
          where target.id = mp.automation_target_id
            and target.platform_account_id = p_platform_account_id
            and target.target_type = 'CAMPAIGN'
            and (
              upper(coalesce(c.status, '')) = 'PAUSED'
              or upper(coalesce(c.effective_status, ''))
                in ('PAUSED', 'CAMPAIGN_PAUSED')
            )
        )
      returning mp.id
    )
    select count(*)::integer into v_revived from revived;

    if v_revived > 0 then
      update public.mutation_plan_steps step
      set
        status = 'PENDING',
        dispatch_state = 'NOT_DISPATCHED',
        dispatch_started_at = null,
        error_code = null,
        error_detail = null,
        updated_at = p_planned_at
      where step.platform_account_id = p_platform_account_id
        and step.user_id = p_user_id
        and step.status in ('FAILED', 'RETRYABLE', 'COMPENSATION_REQUIRED')
        and exists (
          select 1
          from public.mutation_plans mp
          where mp.id = step.plan_id
            and mp.source_rule_key = 'hard_cap_day_resume'
            and mp.action_type = 'ACTIVATE'
            and mp.status = 'PENDING'
            and mp.updated_at = p_planned_at
        );
    end if;

    alter table public.mutation_plan_steps
      enable trigger guard_meta_mutation_step_update;
    alter table public.mutation_plans
      enable trigger guard_meta_mutation_plan_update;
  exception
    when others then
      alter table public.mutation_plan_steps
        enable trigger guard_meta_mutation_step_update;
      alter table public.mutation_plans
        enable trigger guard_meta_mutation_plan_update;
      raise;
  end;

  with boost_owners as (
    select distinct coalesce(
      target.budget_owner_key,
      'campaign:' || c.platform_campaign_id
    ) as budget_owner_key
    from public.campaigns c
    join public.automation_targets target
      on target.platform_account_id = c.platform_account_id
     and target.target_type = 'CAMPAIGN'
     and target.platform_object_id = c.platform_campaign_id
     and target.status = 'MANAGED'
    join public.remote_object_bindings binding
      on binding.platform_account_id = c.platform_account_id
     and binding.user_id = c.user_id
     and binding.object_type = 'CAMPAIGN'
     and (
       binding.remote_object_id = c.platform_campaign_id
       or binding.local_campaign_id = c.id
     )
    join public.mutation_plans boost_plan
      on boost_plan.id = binding.plan_id
     and boost_plan.source_rule_key = 'organic-boost'
     and boost_plan.action_type = 'LAUNCH_CHAIN'
    where c.user_id = p_user_id
      and c.platform_account_id = p_platform_account_id
      and c.is_current
      and (
        upper(coalesce(c.status, '')) = 'PAUSED'
        or upper(coalesce(c.effective_status, ''))
          in ('PAUSED', 'CAMPAIGN_PAUSED')
      )
  ),
  deleted as (
    delete from public.daily_budget_exposures dbe
    using boost_owners owners
    where dbe.platform_account_id = p_platform_account_id
      and dbe.user_id = p_user_id
      and dbe.account_day = v_account_day
      and dbe.budget_owner_key = owners.budget_owner_key
    returning dbe.id
  )
  select count(*)::integer into v_exposures_cleared from deleted;

  update public.daily_budget_exposure_snapshots s
  set
    reserved_exposure_minor = totals.reserved_exposure_minor,
    updated_at = now()
  from (
    select coalesce(sum(dbe.reserved_exposure_minor), 0)::bigint
      as reserved_exposure_minor
    from public.daily_budget_exposures dbe
    where dbe.platform_account_id = p_platform_account_id
      and dbe.account_day = v_account_day
  ) totals
  where s.id = v_snapshot.id;

  for v_candidate in
    select
      target.id as automation_target_id,
      target.campaign_scope_key,
      c.stop_time
    from public.campaigns c
    join public.automation_targets target
      on target.platform_account_id = c.platform_account_id
     and target.target_type = 'CAMPAIGN'
     and target.platform_object_id = c.platform_campaign_id
     and target.status = 'MANAGED'
    where c.user_id = p_user_id
      and c.platform_account_id = p_platform_account_id
      and c.is_current
      and (
        upper(coalesce(c.status, '')) = 'PAUSED'
        or upper(coalesce(c.effective_status, ''))
          in ('PAUSED', 'CAMPAIGN_PAUSED')
      )
      and exists (
        select 1
        from public.remote_object_bindings binding
        join public.mutation_plans boost_plan
          on boost_plan.id = binding.plan_id
         and boost_plan.user_id = binding.user_id
         and boost_plan.platform_account_id = binding.platform_account_id
        where binding.user_id = p_user_id
          and binding.platform_account_id = p_platform_account_id
          and binding.object_type = 'CAMPAIGN'
          and (
            binding.remote_object_id = c.platform_campaign_id
            or binding.local_campaign_id = c.id
          )
          and boost_plan.source_rule_key = 'organic-boost'
          and boost_plan.action_type = 'LAUNCH_CHAIN'
      )
      and exists (
        select 1
        from public.mutation_plans prior
        where prior.user_id = p_user_id
          and prior.platform_account_id = p_platform_account_id
          and prior.target_type = 'CAMPAIGN'
          and prior.target_key = target.target_key
          and prior.action_type = 'SAFETY_PAUSE'
          and prior.safety_action
          and prior.status = 'SUCCEEDED'
          and prior.source_rule_key = 'hard_cap_exposure_breach'
      )
    order by target.campaign_scope_key
  loop
    if v_candidate.stop_time is not null
      and v_candidate.stop_time <= p_planned_at then
      v_schedule_ended := v_schedule_ended + 1;
      v_blocked := v_blocked + 1;
      continue;
    end if;

    v_result := public.queue_meta_hard_cap_resume_internal(
      p_user_id,
      p_platform_account_id,
      v_policy.id,
      v_snapshot.id,
      p_source_marketing_sync_id,
      v_candidate.automation_target_id,
      v_account_day,
      jsonb_build_object(
        'account_day', v_account_day,
        'resume_reason', 'organic_boost_hard_cap_force_resume',
        'campaign_scope_key', v_candidate.campaign_scope_key,
        'exposures_cleared', v_exposures_cleared,
        'revived', v_revived
      ),
      p_planned_at
    );

    if v_result->>'outcome' in ('CREATED', 'QUEUED') then
      v_created := v_created + 1;
    elsif v_result->>'outcome' = 'EXISTING' then
      v_existing := v_existing + 1;
    else
      v_blocked := v_blocked + 1;
    end if;
  end loop;

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    v_policy.id,
    null,
    null,
    null,
    'SYSTEM',
    'meta-budget-planner',
    'ORGANIC_BOOST_HARD_CAP_FORCE_RESUME',
    '{}'::jsonb,
    jsonb_build_object(
      'snapshot_id', v_snapshot.id,
      'account_day', v_account_day,
      'source_marketing_sync_id', p_source_marketing_sync_id
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'created', v_created,
      'existing', v_existing,
      'blocked', v_blocked,
      'revived', v_revived,
      'schedule_ended', v_schedule_ended
    ),
    jsonb_build_object('exposures_cleared', v_exposures_cleared),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'OK',
    'reason', 'organic_boost_hard_cap_force_resume',
    'created', v_created,
    'existing', v_existing,
    'blocked', v_blocked,
    'revived', v_revived,
    'exposures_cleared', v_exposures_cleared,
    'schedule_ended', v_schedule_ended,
    'snapshot_id', v_snapshot.id,
    'account_day', v_account_day
  );
end;
$$;

revoke all on function public.force_resume_meta_organic_boost_hard_cap_pauses(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.force_resume_meta_organic_boost_hard_cap_pauses(
  uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.force_resume_meta_organic_boost_hard_cap_pauses(
  uuid, uuid, uuid, timestamptz
) is
  'Force-queues ACTIVATE for paused Beitrag-Push after hard-cap SAFETY_PAUSE; revives FAILED ACTIVATE plans; does not require campaigns.last_seen_sync_id to match the latest Abruf.';

commit;

-- Currently paused Beitrag-Push campaigns stay PAUSED because day-resume only
-- runs on the under-cap planner path. Same-day SNAPSHOT reserve keeps the
-- account over hard-cap → HARD_CAP_SAFETY early return → no ACTIVATE.
--
-- Fix: force-queue ACTIVATE for organic-boost campaigns previously hard-cap
-- SAFETY_PAUSEd (even while still over cap), clear their same-day exposure
-- reserve, and invoke that path from HARD_CAP_SAFETY before return.

begin;

-- ---------------------------------------------------------------------------
-- 1) Resume helper: treat Meta status/effective_status PAUSED more robustly
-- ---------------------------------------------------------------------------
do $patch_resume_status$
declare
  v_function regprocedure :=
    'public.queue_meta_hard_cap_resume_internal(uuid,uuid,uuid,uuid,uuid,uuid,date,jsonb,timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if v_definition is null then
    raise exception 'queue_meta_hard_cap_resume_internal not found — apply day-resume SQL first';
  end if;

  if position('campaign_status_not_paused' in v_definition) > 0 then
    -- Still ensure payload safety_reason is optional (idempotent re-entry).
    if position(
      'prior.planned_payload->>''safety_reason'' = ''hard_cap_exposure_breach'''
      in v_definition
    ) > 0 then
      v_updated := replace(
        v_definition,
        E'and prior.planned_payload->>''safety_reason'' = ''hard_cap_exposure_breach''',
        E'and (\n'
        || E'        prior.planned_payload->>''safety_reason'' = ''hard_cap_exposure_breach''\n'
        || E'        or prior.planned_payload->>''safety_reason'' is null\n'
        || E'      )'
      );
      if position('safety_reason'' is null' in v_updated) > 0 then
        execute v_updated;
      end if;
    end if;
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'if not found\\s+'
    || E'or upper\\(coalesce\\(v_campaign\\.effective_status, v_campaign\\.status, ''''\\)\\)\\s+'
    || E'<> ''PAUSED'' then\\s+'
    || E'return jsonb_build_object\\(\\s+'
    || E'''outcome'', ''BLOCKED'', ''reason'', ''campaign_not_paused''\\s+'
    || E'\\);\\s+'
    || E'end if;',
    $repl$if not found
    or (
      upper(coalesce(v_campaign.status, '')) <> 'PAUSED'
      and upper(coalesce(v_campaign.effective_status, ''))
        not in ('PAUSED', 'CAMPAIGN_PAUSED')
    ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'campaign_status_not_paused'
    );
  end if;$repl$,
    1
  );

  if position('campaign_status_not_paused' in v_updated) = 0 then
    raise exception 'Could not relax PAUSED check on queue_meta_hard_cap_resume_internal';
  end if;

  v_updated := replace(
    v_updated,
    E'and prior.planned_payload->>''safety_reason'' = ''hard_cap_exposure_breach''',
    E'and (\n'
    || E'        prior.planned_payload->>''safety_reason'' = ''hard_cap_exposure_breach''\n'
    || E'        or prior.planned_payload->>''safety_reason'' is null\n'
    || E'      )'
  );

  execute v_updated;
end;
$patch_resume_status$;

-- ---------------------------------------------------------------------------
-- 2) Force-resume RPC for wrongly paused Beitrag-Push campaigns
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
  v_exposures_cleared integer := 0;
begin
  if p_planned_at < now() - interval '5 minutes'
    or p_planned_at > now() + interval '1 minute' then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'invalid_planner_time',
      'created', 0,
      'existing', 0,
      'blocked', 0,
      'exposures_cleared', 0
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
      'exposures_cleared', 0
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
      'exposures_cleared', 0
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
      'exposures_cleared', 0
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
      'exposures_cleared', 0
    );
  end if;

  -- Drop same-day reserve for paused Beitrag-Push owners (wrongly kept after SAFETY_PAUSE).
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
      target.campaign_scope_key
    from public.campaigns c
    join public.automation_targets target
      on target.platform_account_id = c.platform_account_id
     and target.target_type = 'CAMPAIGN'
     and target.platform_object_id = c.platform_campaign_id
     and target.status = 'MANAGED'
    where c.user_id = p_user_id
      and c.platform_account_id = p_platform_account_id
      and c.is_current
      and c.last_seen_sync_id = p_source_marketing_sync_id
      and (
        upper(coalesce(c.status, '')) = 'PAUSED'
        or upper(coalesce(c.effective_status, ''))
          in ('PAUSED', 'CAMPAIGN_PAUSED')
      )
      and (c.stop_time is null or c.stop_time > p_planned_at)
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
        'exposures_cleared', v_exposures_cleared
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
      'blocked', v_blocked
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
    'exposures_cleared', v_exposures_cleared,
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
  'Clears same-day exposure for paused Beitrag-Push campaigns and queues ACTIVATE after prior hard-cap SAFETY_PAUSE, even when the account is still over hard-cap.';

-- ---------------------------------------------------------------------------
-- 3) HARD_CAP_SAFETY path: force-resume Beitrag-Push before early return
-- ---------------------------------------------------------------------------
do $patch_planner$
declare
  v_function regprocedure :=
    'public.run_meta_budget_planner(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if v_definition is null then
    raise exception 'run_meta_budget_planner not found';
  end if;

  if position('force_resume_meta_organic_boost_hard_cap_pauses' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'end loop;\\s+'
    || E'return query select\\s+'
    || E'''HARD_CAP_SAFETY''::text,\\s+'
    || E'v_refresh\\.snapshot_id,\\s+'
    || E'v_refresh\\.account_day,\\s+'
    || E'v_refresh\\.observed_budget_owner_count,\\s+'
    || E'v_refresh\\.reserved_exposure_minor,\\s+'
    || E'v_created,\\s+'
    || E'v_existing,\\s+'
    || E'v_blocked,\\s+'
    || E'true;\\s+'
    || E'return;\\s+'
    || E'end if;',
    $repl$end loop;

    -- Beitrag-Push wrongly paused by hard-cap: reactivate even while over cap.
    v_result := public.force_resume_meta_organic_boost_hard_cap_pauses(
      p_platform_account_id,
      p_user_id,
      p_source_marketing_sync_id,
      p_planned_at
    );
    if coalesce((v_result->>'created')::integer, 0) > 0 then
      v_created := v_created + coalesce((v_result->>'created')::integer, 0);
    end if;
    if coalesce((v_result->>'existing')::integer, 0) > 0 then
      v_existing := v_existing + coalesce((v_result->>'existing')::integer, 0);
    end if;
    if coalesce((v_result->>'blocked')::integer, 0) > 0 then
      v_blocked := v_blocked + coalesce((v_result->>'blocked')::integer, 0);
    end if;

    return query select
      'HARD_CAP_SAFETY'::text,
      v_refresh.snapshot_id,
      v_refresh.account_day,
      v_refresh.observed_budget_owner_count,
      v_refresh.reserved_exposure_minor,
      v_created,
      v_existing,
      v_blocked,
      true;
    return;
  end if;$repl$,
    1
  );

  if position('force_resume_meta_organic_boost_hard_cap_pauses' in v_updated) = 0 then
    raise exception
      'force_resume_meta_organic_boost_hard_cap_pauses patch did not apply to budget planner';
  end if;

  execute v_updated;
end;
$patch_planner$;

comment on function public.run_meta_budget_planner(
  uuid, uuid, uuid, uuid, timestamptz
) is
  'Builds conservative Meta daily exposure, queues SAFETY_PAUSE on hard-cap breach for non-Beitrag-Push MANAGED campaigns, force-resumes wrongly paused Beitrag-Push even on HARD_CAP_SAFETY, and under-cap queues ACTIVATE day-resume. No remote mutation.';

commit;

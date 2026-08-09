-- Hard-cap SAFETY_PAUSE left Meta campaigns permanently PAUSED because:
-- 1) SNAPSHOT exposures ignored delivery status (PAUSED still reserved next day)
-- 2) No ACTIVATE path existed after a new account_day under the hard cap
-- 3) finalize-active left provisional boost:* PLAN exposures (double-count)
-- 4) planner counted outcome 'QUEUED' while helpers return 'CREATED'
--
-- Intended behavior: same-day pause reserve stays (rows written while ACTIVE);
-- next Meta account day does not re-snapshot PAUSED owners; under-cap campaigns
-- previously safety-paused are ACTIVATEd again.

begin;

-- ---------------------------------------------------------------------------
-- 1) Resume helper (mirror of queue_meta_hard_cap_pause_internal → ACTIVE)
-- ---------------------------------------------------------------------------
create or replace function public.queue_meta_hard_cap_resume_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_automation_target_id uuid,
  p_account_day date,
  p_evidence jsonb,
  p_planned_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_campaign public.campaigns%rowtype;
  v_kill_mode text;
  v_plan_id uuid := gen_random_uuid();
  v_existing_plan_id uuid;
  v_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_step_validate uuid := gen_random_uuid();
  v_step_mutate uuid := gen_random_uuid();
  v_step_read uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_validate_request jsonb;
  v_mutate_request jsonb;
  v_read_request jsonb;
  v_reconcile_request jsonb;
begin
  if jsonb_typeof(p_evidence) <> 'object'
    or pg_catalog.pg_column_size(p_evidence) > 65536 then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'invalid_resume_evidence'
    );
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = p_policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found or not v_policy.allow_status_changes then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'status_changes_not_allowed'
    );
  end if;

  select target.* into v_target
  from public.automation_targets target
  where target.id = p_automation_target_id
    and target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'CAMPAIGN'
    and target.status = 'MANAGED'
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'invalid_campaign_target'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':status-target:' || v_target.target_key,
      0
    )
  );

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_target.campaign_id
    and c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
    and c.last_seen_sync_id = p_source_marketing_sync_id
  for update;

  if not found
    or upper(coalesce(v_campaign.effective_status, v_campaign.status, ''))
      <> 'PAUSED' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'campaign_not_paused'
    );
  end if;

  if v_campaign.stop_time is not null
    and v_campaign.stop_time <= p_planned_at then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'campaign_schedule_ended'
    );
  end if;

  -- Only reopen campaigns we ourselves safety-paused for hard-cap exposure.
  if not exists (
    select 1
    from public.mutation_plans prior
    where prior.user_id = p_user_id
      and prior.platform_account_id = p_platform_account_id
      and prior.target_type = 'CAMPAIGN'
      and prior.target_key = v_target.target_key
      and prior.action_type = 'SAFETY_PAUSE'
      and prior.safety_action
      and prior.status = 'SUCCEEDED'
      and prior.source_rule_key = 'hard_cap_exposure_breach'
      and prior.planned_payload->>'safety_reason' = 'hard_cap_exposure_breach'
  ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'not_prior_hard_cap_safety_pause'
    );
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  if coalesce(v_kill_mode, 'ALLOW') <> 'ALLOW' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'kill_switch_blocks_resume'
    );
  end if;

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.platform_account_id = p_platform_account_id
    and mp.target_type = 'CAMPAIGN'
    and mp.target_key = v_target.target_key
    and mp.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by mp.created_at desc
  limit 1;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'pending_campaign_plan',
      'plan_id', v_existing_plan_id
    );
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'operation', 'UPDATE_STATUS',
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'target_key', v_target.target_key,
    'status', 'ACTIVE',
    'safety_reason', 'hard_cap_day_resume',
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'exposure_snapshot_id', p_snapshot_id,
    'account_day', p_account_day,
    'evidence', p_evidence
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || p_policy_id::text || '|' || v_policy.policy_hash || '|'
    || p_account_day::text || '|hard-cap-resume|'
    || v_target.target_key || '|' || v_payload_hash
  );

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.idempotency_key = v_idempotency_key;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'idempotent_replay',
      'plan_id', v_existing_plan_id
    );
  end if;

  insert into public.mutation_plans (
    id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
    source_rule_key, source_rule_version, action_type, target_type, target_key,
    campaign_scope_key, budget_owner_key, automation_target_id, idempotency_key,
    expected_before, intended_after, planned_payload, payload_hash, status,
    priority, safety_action, not_before, max_attempts, created_at, updated_at
  ) values (
    v_plan_id, p_user_id, p_platform_account_id, p_policy_id,
    p_source_marketing_sync_id, 'hard_cap_day_resume', 1, 'ACTIVATE',
    'CAMPAIGN', v_target.target_key, v_target.campaign_scope_key,
    v_target.budget_owner_key, v_target.id, v_idempotency_key,
    jsonb_build_object(
      'status', coalesce(v_campaign.effective_status, v_campaign.status),
      'source_marketing_sync_id', p_source_marketing_sync_id
    ),
    jsonb_build_object('status', 'ACTIVE'),
    v_payload, v_payload_hash, 'PENDING', 90, true, p_planned_at, 10,
    p_planned_at, p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS',
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'status', 'ACTIVE',
    'mode', 'validate_only'
  );
  v_mutate_request :=
    v_validate_request || jsonb_build_object('mode', 'execute');
  v_read_request := jsonb_build_object(
    'object_type', 'CAMPAIGN',
    'object_id', v_target.platform_object_id,
    'fields', jsonb_build_array(
      'id', 'status', 'effective_status', 'updated_time'
    )
  );
  v_reconcile_request := jsonb_build_object(
    'expected_status', 'ACTIVE',
    'exposure_snapshot_id', p_snapshot_id,
    'safety_action', true,
    'resume_reason', 'hard_cap_day_resume'
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-hard-cap-resume', 'VALIDATE', 'CAMPAIGN', null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-hard-cap-resume', 'UPDATE', 'CAMPAIGN', v_step_validate,
    v_mutate_request, public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'PAUSE', 'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-hard-cap-resume', 'READ', 'CAMPAIGN', v_step_mutate,
    v_read_request, public.meta_sha256(v_read_request::text),
    jsonb_build_object('status', 'ACTIVE'), 'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-hard-cap-resume', 'RECONCILE', 'CAMPAIGN', v_step_read,
    v_reconcile_request, public.meta_sha256(v_reconcile_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'), 'NONE', 'PENDING'
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, p_policy_id, v_plan_id,
    null, null, 'SYSTEM', 'meta-budget-planner',
    'HARD_CAP_DAY_RESUME_QUEUED',
    jsonb_build_object(
      'status', coalesce(v_campaign.effective_status, v_campaign.status)
    ),
    v_payload, '{}'::jsonb,
    jsonb_build_object('status', 'ACTIVE', 'plan_status', 'PENDING'),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash,
      'account_day', p_account_day
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'hard_cap_day_resume',
    'plan_id', v_plan_id
  );
end;
$$;

revoke all on function public.queue_meta_hard_cap_resume_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, date, jsonb, timestamptz
) from public, anon, authenticated, service_role;

comment on function public.queue_meta_hard_cap_resume_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, date, jsonb, timestamptz
) is
  'Queues ACTIVATE for a MANAGED campaign previously SAFETY_PAUSED for hard-cap exposure when the current account day is under cap.';

-- ---------------------------------------------------------------------------
-- 2) SNAPSHOT exposures: only ACTIVE delivery owners (keep same-day pause reserve)
-- ---------------------------------------------------------------------------
do $patch_refresh$
declare
  v_function regprocedure :=
    'public.refresh_meta_budget_planner_snapshot_internal(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  v_definition text;
  v_campaign_old constant text :=
    E'and c.is_current\n    and coalesce(c.daily_budget_minor, 0) > 0\n  on conflict on constraint daily_budget_exposures_account_day_owner_key';
  v_campaign_new constant text :=
    E'and c.is_current\n    and coalesce(c.daily_budget_minor, 0) > 0\n    and upper(coalesce(c.effective_status, c.status, '''')) = ''ACTIVE''\n  on conflict on constraint daily_budget_exposures_account_day_owner_key';
  v_adset_old constant text :=
    E'and c.is_current\n    and coalesce(c.daily_budget_minor, 0) = 0\n    and coalesce(ag.daily_budget_minor, 0) > 0\n  on conflict on constraint daily_budget_exposures_account_day_owner_key';
  v_adset_new constant text :=
    E'and c.is_current\n    and coalesce(c.daily_budget_minor, 0) = 0\n    and coalesce(ag.daily_budget_minor, 0) > 0\n    and upper(coalesce(c.effective_status, c.status, '''')) = ''ACTIVE''\n    and upper(coalesce(ag.effective_status, ag.status, '''')) = ''ACTIVE''\n  on conflict on constraint daily_budget_exposures_account_day_owner_key';
begin
  select pg_get_functiondef(v_function) into v_definition;

  if position(v_campaign_old in v_definition) = 0 then
    raise exception 'Campaign ACTIVE exposure patch target not found';
  end if;
  if position(v_adset_old in v_definition) = 0 then
    raise exception 'Ad-set ACTIVE exposure patch target not found';
  end if;

  v_definition := replace(v_definition, v_campaign_old, v_campaign_new);
  v_definition := replace(v_definition, v_adset_old, v_adset_new);

  if position(
    E'upper(coalesce(c.effective_status, c.status, '''')) = ''ACTIVE'''
    in v_definition
  ) = 0 then
    raise exception 'ACTIVE exposure patch did not apply';
  end if;

  execute v_definition;
end;
$patch_refresh$;

comment on function public.refresh_meta_budget_planner_snapshot_internal(
  uuid, uuid, uuid, uuid, timestamptz
) is
  'Refreshes daily exposure from ACTIVE budget owners only; same-day PAUSED rows written earlier keep the pause reserve until the next account day.';

-- ---------------------------------------------------------------------------
-- 3) Planner: count CREATED, queue day-resume when under hard cap
-- ---------------------------------------------------------------------------
do $patch_planner$
declare
  v_function regprocedure :=
    'public.run_meta_budget_planner(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  v_definition text;
  v_queued_old constant text :=
    E'if v_result->>''outcome'' = ''QUEUED'' then';
  v_queued_new constant text :=
    E'if v_result->>''outcome'' in (''CREATED'', ''QUEUED'') then';
  v_resume_anchor constant text :=
    E'if coalesce(v_kill_mode, ''ALLOW'') <> ''ALLOW'' then\n'
    || E'    return query select\n'
    || E'      ''KILL_SWITCH_BLOCKED''::text,\n'
    || E'      v_refresh.snapshot_id,\n'
    || E'      v_refresh.account_day,\n'
    || E'      v_refresh.observed_budget_owner_count,\n'
    || E'      v_refresh.reserved_exposure_minor,\n'
    || E'      0,\n'
    || E'      0,\n'
    || E'      0,\n'
    || E'      false;\n'
    || E'    return;\n'
    || E'  end if;\n'
    || E'\n'
    || E'  -- Negative campaign-level recommendations';
  v_resume_insert constant text :=
    E'if coalesce(v_kill_mode, ''ALLOW'') <> ''ALLOW'' then\n'
    || E'    return query select\n'
    || E'      ''KILL_SWITCH_BLOCKED''::text,\n'
    || E'      v_refresh.snapshot_id,\n'
    || E'      v_refresh.account_day,\n'
    || E'      v_refresh.observed_budget_owner_count,\n'
    || E'      v_refresh.reserved_exposure_minor,\n'
    || E'      0,\n'
    || E'      0,\n'
    || E'      0,\n'
    || E'      false;\n'
    || E'    return;\n'
    || E'  end if;\n'
    || E'\n'
    || E'  -- Under hard cap: reactivate MANAGED campaigns we safety-paused earlier.\n'
    || E'  for v_candidate in\n'
    || E'    select target.id as automation_target_id,\n'
    || E'      target.campaign_scope_key\n'
    || E'    from public.campaigns c\n'
    || E'    join public.automation_targets target\n'
    || E'      on target.platform_account_id = c.platform_account_id\n'
    || E'     and target.target_type = ''CAMPAIGN''\n'
    || E'     and target.platform_object_id = c.platform_campaign_id\n'
    || E'     and target.status = ''MANAGED''\n'
    || E'    where c.user_id = p_user_id\n'
    || E'      and c.platform_account_id = p_platform_account_id\n'
    || E'      and c.is_current\n'
    || E'      and c.last_seen_sync_id = p_source_marketing_sync_id\n'
    || E'      and upper(coalesce(c.effective_status, c.status, '''')) = ''PAUSED''\n'
    || E'      and (c.stop_time is null or c.stop_time > p_planned_at)\n'
    || E'      and exists (\n'
    || E'        select 1\n'
    || E'        from public.mutation_plans prior\n'
    || E'        where prior.user_id = p_user_id\n'
    || E'          and prior.platform_account_id = p_platform_account_id\n'
    || E'          and prior.target_type = ''CAMPAIGN''\n'
    || E'          and prior.target_key = target.target_key\n'
    || E'          and prior.action_type = ''SAFETY_PAUSE''\n'
    || E'          and prior.safety_action\n'
    || E'          and prior.status = ''SUCCEEDED''\n'
    || E'          and prior.source_rule_key = ''hard_cap_exposure_breach''\n'
    || E'      )\n'
    || E'    order by target.campaign_scope_key\n'
    || E'  loop\n'
    || E'    v_result := public.queue_meta_hard_cap_resume_internal(\n'
    || E'      p_user_id,\n'
    || E'      p_platform_account_id,\n'
    || E'      v_policy.id,\n'
    || E'      v_refresh.snapshot_id,\n'
    || E'      p_source_marketing_sync_id,\n'
    || E'      v_candidate.automation_target_id,\n'
    || E'      v_refresh.account_day,\n'
    || E'      jsonb_build_object(\n'
    || E'        ''account_day'', v_refresh.account_day,\n'
    || E'        ''account_reserved_exposure_minor'', v_refresh.reserved_exposure_minor,\n'
    || E'        ''account_hard_cap_minor'', v_policy.account_daily_hard_cap_minor,\n'
    || E'        ''campaign_scope_key'', v_candidate.campaign_scope_key,\n'
    || E'        ''resume_reason'', ''hard_cap_day_resume''\n'
    || E'      ),\n'
    || E'      p_planned_at\n'
    || E'    );\n'
    || E'\n'
    || E'    if v_result->>''outcome'' in (''CREATED'', ''QUEUED'') then\n'
    || E'      v_created := v_created + 1;\n'
    || E'    elsif v_result->>''outcome'' = ''EXISTING'' then\n'
    || E'      v_existing := v_existing + 1;\n'
    || E'    else\n'
    || E'      v_blocked := v_blocked + 1;\n'
    || E'    end if;\n'
    || E'  end loop;\n'
    || E'\n'
    || E'  -- Negative campaign-level recommendations';
  v_queued_count integer;
begin
  select pg_get_functiondef(v_function) into v_definition;

  v_queued_count :=
    (char_length(v_definition)
      - char_length(replace(v_definition, v_queued_old, '')))
    / char_length(v_queued_old);
  if v_queued_count < 1 then
    raise exception 'Expected QUEUED outcome checks in budget planner, found none';
  end if;
  v_definition := replace(v_definition, v_queued_old, v_queued_new);

  if position(v_resume_anchor in v_definition) = 0 then
    raise exception 'Hard-cap day-resume patch anchor not found';
  end if;
  if position('queue_meta_hard_cap_resume_internal' in v_definition) > 0 then
    raise exception 'Hard-cap day-resume patch already present';
  end if;

  v_definition := replace(v_definition, v_resume_anchor, v_resume_insert);
  execute v_definition;
end;
$patch_planner$;

comment on function public.run_meta_budget_planner(
  uuid, uuid, uuid, uuid, timestamptz
) is
  'Builds conservative Meta daily exposure, queues SAFETY_PAUSE on hard-cap breach, and under-cap queues ACTIVATE day-resume for prior hard-cap SAFETY_PAUSE campaigns. No remote mutation.';

-- ---------------------------------------------------------------------------
-- 4) finalize-active: drop provisional boost:* PLAN exposures (stop double-count)
-- ---------------------------------------------------------------------------
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
  'Marks organic LAUNCH_CHAIN plans SUCCEEDED when Meta campaign is ACTIVE and drops provisional boost:* PLAN exposures to prevent hard-cap double-count.';

commit;

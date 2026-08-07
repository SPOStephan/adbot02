-- CONSTRUCTION FIX: Beitrag-Push must survive marketing Abruf.
--
-- Bug: run_meta_budget_planner marked ALL unclaimed PENDING plans STALE with
-- superseded_by_marketing_snapshot when marketing_sync_id changed — including
-- organic-boost. Links stayed; rematerialize returned EXISTING forever.
-- Result: Autonomie + Freigeben could never get Meta writes live after Abruf.
--
-- Fix:
-- 1) Never supersede source_rule_key='organic-boost'
-- 2) Revive already-superseded organic plans to PENDING
-- 3) Freigeben (ALLOW) also revives superseded organic plans
-- 4) Organic planner self-heals superseded linked plans before materialize

begin;

-- ---------------------------------------------------------------------------
-- 1) Budget planner: exclude organic-boost from snapshot supersede
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.run_meta_budget_planner(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'run_meta_budget_planner not found';
  end if;

  if position(
    'mp.source_rule_key is distinct from ''organic-boost'''
    in v_def
  ) > 0 then
    return;
  end if;

  -- Whitespace-tolerant: pg_get_functiondef formatting can differ from source.
  v_updated := regexp_replace(
    v_def,
    E'and mp\\.source_marketing_sync_id <> p_source_marketing_sync_id\\s+and mp\\.status = ''PENDING''',
    $repl$and mp.source_marketing_sync_id <> p_source_marketing_sync_id
      -- Organic Beitrag-Push must survive marketing Abruf (not budget intent).
      and mp.source_rule_key is distinct from 'organic-boost'
      and mp.status = 'PENDING'$repl$,
    1
  );

  if position(
    'mp.source_rule_key is distinct from ''organic-boost'''
    in v_updated
  ) = 0 then
    raise exception
      'Failed to exclude organic-boost from run_meta_budget_planner supersede';
  end if;

  execute v_updated;
end;
$patch$;

comment on function public.run_meta_budget_planner(uuid, uuid, uuid, uuid, timestamptz) is
  'Budget planner after marketing snapshot. Does not supersede organic-boost LAUNCH_CHAIN plans.';

-- ---------------------------------------------------------------------------
-- 2) Helper: revive organic plans killed by snapshot supersede
-- ---------------------------------------------------------------------------
create or replace function public.revive_meta_organic_boost_superseded_plans(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  -- Do not touch source_marketing_sync_id / payload: guard_meta_mutation_plan_update
  -- treats them as immutable intent. Organic preflight no longer requires sync match.
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
    not_before = least(coalesce(mp.not_before, now()), now()),
    updated_at = now()
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
    and (
      (
        mp.status = 'STALE'
        and coalesce(mp.blocked_reason, '') = 'superseded_by_marketing_snapshot'
      )
      or (
        mp.status in ('PENDING', 'RETRYABLE')
        and coalesce(mp.blocked_reason, '') in (
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_marketing_sync_stale',
          'organic_preflight_not_ready',
          'superseded_by_marketing_snapshot'
        )
      )
      or (
        mp.status = 'BLOCKED'
        and coalesce(mp.blocked_reason, '') in (
          'organic_preflight_kill_switch',
          'writes_frozen'
        )
      )
    )
    and not exists (
      select 1
      from public.mutation_executions execution
      where execution.plan_id = mp.id
    );

  get diagnostics v_count = row_count;

  update public.mutation_plan_steps mps
  set
    status = 'PENDING',
    dispatch_state = 'NOT_DISPATCHED',
    dispatch_started_at = null,
    remote_applied_at = null,
    remote_request_id = null,
    response_fingerprint = null,
    validation_fingerprint = null,
    validated_at = null,
    started_at = null,
    error_class = null,
    error_code = null,
    attempt_count = 0,
    completed_at = null,
    updated_at = now()
  from public.mutation_plans mp
  where mps.plan_id = mp.id
    and mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.status = 'PENDING'
    and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
    and mps.status in (
      'FAILED', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'COMPENSATION_REQUIRED', 'STALE'
    );

  return v_count;
end;
$$;

revoke all on function public.revive_meta_organic_boost_superseded_plans(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revive_meta_organic_boost_superseded_plans(uuid, uuid)
  to service_role;

comment on function public.revive_meta_organic_boost_superseded_plans(uuid, uuid) is
  'Re-queue organic AUTO plans stuck as STALE/superseded or soft-blocked so Meta writes can proceed.';

-- ---------------------------------------------------------------------------
-- 3) Freigeben: revive superseded + soft-blocked organic plans
-- ---------------------------------------------------------------------------
create or replace function public.set_meta_customer_kill_switch(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_mode text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_event_id uuid;
begin
  if p_mode not in ('ALLOW', 'FREEZE_WRITES', 'PAUSE_MANAGED')
    or char_length(v_reason) < 8
    or char_length(v_reason) > 500 then
    raise exception 'Customer kill-switch input is invalid';
  end if;

  if p_mode = 'ALLOW' and not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and 'ads_management' = any(pa.meta_scopes)
  ) then
    raise exception 'ALLOW requires ads_management';
  end if;

  v_event_id := public.append_meta_kill_switch_state(
    'ACCOUNT',
    p_user_id,
    p_platform_account_id,
    null,
    p_mode,
    v_reason,
    'CUSTOMER',
    p_user_id::text
  );

  if p_mode = 'ALLOW' then
    perform public.revive_meta_organic_boost_superseded_plans(
      p_user_id,
      p_platform_account_id
    );
  end if;

  return v_event_id;
end;
$$;

revoke all on function public.set_meta_customer_kill_switch(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.set_meta_customer_kill_switch(
  uuid, uuid, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Organic planner: self-heal superseded plans before materialize loop
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_updated text;
  v_marker constant text := 'revive_meta_organic_boost_superseded_plans';
begin
  select pg_get_functiondef(
    'public.run_meta_organic_boost_planner(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'run_meta_organic_boost_planner not found';
  end if;

  if position(v_marker in v_def) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_def,
    E'perform pg_advisory_xact_lock\\(\\s*87201401,\\s*hashtext\\(p_platform_account_id::text \\|\\| '':'' \\|\\| p_user_id::text\\)\\s*\\);',
    $repl$perform pg_advisory_xact_lock(
    87201401,
    hashtext(p_platform_account_id::text || ':' || p_user_id::text)
  );

  -- Heal plans wrongly killed by budget-planner snapshot supersede / soft blocks.
  perform public.revive_meta_organic_boost_superseded_plans(
    p_user_id,
    p_platform_account_id
  );$repl$,
    1
  );

  if position(v_marker in v_updated) = 0 then
    raise exception 'organic planner revive hook missing after patch';
  end if;

  execute v_updated;
end;
$patch$;

-- ---------------------------------------------------------------------------
-- 5) One-shot: revive all accounts' superseded organic AUTO plans now
-- ---------------------------------------------------------------------------
do $heal$
declare
  v_row record;
begin
  for v_row in
    select distinct mp.user_id, mp.platform_account_id
    from public.mutation_plans mp
    where mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and (
        (
          mp.status = 'STALE'
          and coalesce(mp.blocked_reason, '') = 'superseded_by_marketing_snapshot'
        )
        or (
          mp.status in ('PENDING', 'RETRYABLE', 'BLOCKED')
          and coalesce(mp.blocked_reason, '') in (
            'organic_preflight_kill_switch',
            'writes_frozen',
            'organic_preflight_marketing_sync_stale',
            'organic_preflight_not_ready',
            'superseded_by_marketing_snapshot'
          )
        )
      )
  loop
    perform public.revive_meta_organic_boost_superseded_plans(
      v_row.user_id,
      v_row.platform_account_id
    );
  end loop;
end;
$heal$;

-- ---------------------------------------------------------------------------
-- 6) Budget-Autonomie must not undo Freigeben
-- ---------------------------------------------------------------------------
-- set_meta_customer_budget_autonomy(false) previously forced FREEZE_WRITES.
-- Saving Autonomie / disabling budget changes therefore revoked an already
-- saved Freigeben — UI kept nagging "Freigeben speichern" after the customer
-- had done it. Only elevate to ALLOW when enabling; never auto-freeze here.
do $patch$
declare
  v_def text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.set_meta_customer_budget_autonomy(uuid,uuid,boolean)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'set_meta_customer_budget_autonomy not found';
  end if;

  if position('never auto-freeze Freigeben' in v_def) > 0
    or position('Do not revoke Freigeben' in v_def) > 0 then
    return;
  end if;

  -- Remove the auto-FREEZE branch; keep optional ALLOW on enable.
  v_updated := regexp_replace(
    v_def,
    E'elsif not p_enable and v_latest_mode is distinct from ''FREEZE_WRITES'' then\\s+v_kill_switch_event_id := public\\.append_meta_kill_switch_state\\(\\s*''ACCOUNT'',\\s*p_user_id,\\s*p_platform_account_id,\\s*null,\\s*''FREEZE_WRITES'',\\s*''Customer disabled autonomous budget management'',\\s*''CUSTOMER'',\\s*p_user_id::text\\s*\\);\\s*end if;',
    $repl$else
    -- Do not revoke Freigeben when budget autonomy is disabled or budget
    -- changes are off. Kill-switch stays under the Sicherheitsschranke control.
    null; -- never auto-freeze Freigeben from budget-autonomy sync
  end if;$repl$,
    1
  );

  if position('never auto-freeze Freigeben' in v_updated) = 0 then
    raise exception
      'Failed to stop set_meta_customer_budget_autonomy from auto-FREEZE_WRITES';
  end if;

  execute v_updated;
end;
$patch$;

comment on function public.set_meta_customer_budget_autonomy(uuid, uuid, boolean) is
  'Syncs managed targets with bounded budget policy. May elevate to ALLOW when enabling; never auto-FREEZE_WRITES (Freigeben is owned by the kill-switch control).';

commit;

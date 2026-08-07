-- Beitrag-Push must keep ACCOUNT ALLOW. The canary refreeze trigger was
-- freezing the whole account after every organic LAUNCH_CHAIN terminal status
-- (STALE/FAILED/RECONCILING/…), undoing Freigeben and soft-blocking Meta writes.

begin;

-- ---------------------------------------------------------------------------
-- 1) Refreeze trigger: never freeze ACCOUNT for organic-boost
-- ---------------------------------------------------------------------------
create or replace function public.refreeze_meta_launch_plan_after_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_mode text;
  v_plan_mode text;
begin
  if new.action_type <> 'LAUNCH_CHAIN'
    or new.safety_action
    or old.status is not distinct from new.status
    or new.status not in (
      'RECONCILING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STALE',
      'PREFLIGHT_FAILED', 'COMPENSATION_REQUIRED', 'CANCELLED'
    ) then
    return new;
  end if;

  -- Organic AUTO Beitrag-Push keeps account-level Freigeben for further posts.
  if new.source_rule_key = 'organic-boost' then
    return new;
  end if;

  if new.status = 'RECONCILING'
    and exists (
      select 1
      from public.mutation_plan_steps step
      where step.plan_id = new.id
        and step.operation in ('VALIDATE', 'CREATE', 'UPDATE')
        and step.status not in (
          'VALIDATED', 'REMOTE_APPLIED', 'RECONCILED', 'SKIPPED'
        )
    ) then
    return new;
  end if;

  select latest.mode into v_account_mode
  from public.kill_switch_state latest
  where latest.scope_type = 'ACCOUNT'
    and latest.user_id = new.user_id
    and latest.platform_account_id = new.platform_account_id
  order by latest.sequence desc
  limit 1;

  if coalesce(v_account_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    perform public.append_meta_kill_switch_state(
      'ACCOUNT', new.user_id, new.platform_account_id, null,
      'FREEZE_WRITES',
      case when new.status = 'RECONCILING'
        then 'Atomarer Aktiv-Launch hat alle Remote-Writes beendet'
        else 'Atomarer Aktiv-Launch ist terminal beendet'
      end,
      'SYSTEM', 'meta-launch-canary-refreeze'
    );
  end if;

  select latest.mode into v_plan_mode
  from public.kill_switch_state latest
  where latest.scope_type = 'PLAN'
    and latest.user_id = new.user_id
    and latest.platform_account_id = new.platform_account_id
    and latest.plan_id = new.id
  order by latest.sequence desc
  limit 1;

  if coalesce(v_plan_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
    perform public.append_meta_kill_switch_state(
      'PLAN', new.user_id, new.platform_account_id, new.id,
      'FREEZE_WRITES',
      'Atomarer Aktiv-Launch ist nicht mehr remote-schreibbar: ' || new.status,
      'SYSTEM', 'meta-launch-canary-refreeze'
    );
  end if;

  perform public.append_meta_mutation_audit_event(
    new.user_id,
    new.platform_account_id,
    new.policy_id,
    new.id,
    null,
    null,
    'SYSTEM',
    'meta-launch-canary-refreeze',
    'LAUNCH_CANARY_WRITES_REFROZEN',
    jsonb_build_object('plan_status', old.status),
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object(
      'plan_status', new.status,
      'account_kill_switch', 'FREEZE_WRITES',
      'plan_kill_switch', 'FREEZE_WRITES'
    ),
    '{}'::jsonb,
    null, null, null, null, new.error_class, now()
  );

  return new;
end;
$$;

comment on function public.refreeze_meta_launch_plan_after_execution() is
  'Refreezes ACCOUNT/PLAN after non-organic LAUNCH_CHAIN terminals. organic-boost never revokes account Freigeben.';

-- ---------------------------------------------------------------------------
-- 2) Reconciler: do not ACCOUNT-freeze organic-boost launches
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_updated text;
  v_marker constant text := 'organic-boost skips account refreeze after reconcile';
begin
  select pg_get_functiondef(
    'public.reconcile_meta_mutation_plan(uuid,uuid,uuid)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'reconcile_meta_mutation_plan not found';
  end if;

  if position(v_marker in v_def) > 0 then
    return;
  end if;

  -- Skip the whole ACCOUNT+PLAN freeze block for organic-boost plans.
  v_updated := regexp_replace(
    v_def,
    E'if v_action_type = ''LAUNCH_CHAIN'' then\\s+select latest\\.mode into v_account_mode',
    $repl$if v_action_type = 'LAUNCH_CHAIN'
      -- organic-boost skips account refreeze after reconcile
      and not exists (
        select 1
        from public.mutation_plans organic_plan
        where organic_plan.id = v_plan_id
          and organic_plan.source_rule_key = 'organic-boost'
      ) then
      select latest.mode into v_account_mode$repl$,
    1
  );

  if position(v_marker in v_updated) = 0 then
    raise exception
      'Failed to exclude organic-boost from reconcile_meta_mutation_plan ACCOUNT freeze';
  end if;

  execute v_updated;
end;
$patch$;

-- ---------------------------------------------------------------------------
-- 3) One-shot heal: restore ALLOW + clear kill soft-blocks (no customer click)
-- ---------------------------------------------------------------------------
do $heal$
declare
  v_row record;
  v_latest_mode text;
begin
  for v_row in
    select distinct mp.user_id, mp.platform_account_id
    from public.mutation_plans mp
    join public.platform_accounts account
      on account.id = mp.platform_account_id
     and account.user_id = mp.user_id
    where mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and account.platform = 'meta'
      and account.revoked_at is null
      and 'ads_management' = any(account.meta_scopes)
      and nullif(account.marketing_meta_ad_account_id, '') is not null
      and (
        mp.status in ('PENDING', 'RETRYABLE')
        or (
          mp.status = 'FAILED'
          and coalesce(mp.blocked_reason, '') in (
            'organic_preflight_kill_switch',
            'writes_frozen',
            'meta_graph_100'
          )
          and not exists (
            select 1
            from public.remote_object_bindings binding
            where binding.plan_id = mp.id
          )
        )
      )
  loop
    select state.mode
    into v_latest_mode
    from public.kill_switch_state state
    where state.scope_type = 'ACCOUNT'
      and state.user_id = v_row.user_id
      and state.platform_account_id = v_row.platform_account_id
    order by state.sequence desc
    limit 1;

    if v_latest_mode is distinct from 'ALLOW' then
      perform public.append_meta_kill_switch_state(
        'ACCOUNT',
        v_row.user_id,
        v_row.platform_account_id,
        null,
        'ALLOW',
        'Heal: Beitrag-Push Freigeben wiederhergestellt — Canary-Refreeze greift nicht mehr auf organic-boost',
        'SYSTEM',
        'meta-organic-boost-no-account-refreeze'
      );
    end if;

    -- Clear kill soft-blocks / requeue failed-without-remote organic plans.
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
    where mp.user_id = v_row.user_id
      and mp.platform_account_id = v_row.platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
      and (
        (
          mp.status in ('PENDING', 'RETRYABLE')
          and coalesce(mp.blocked_reason, '') in (
            'organic_preflight_kill_switch',
            'writes_frozen',
            'organic_preflight_marketing_sync_stale',
            'organic_preflight_not_ready'
          )
        )
        or (
          mp.status = 'FAILED'
          and coalesce(mp.blocked_reason, '') in (
            'organic_preflight_kill_switch',
            'writes_frozen',
            'meta_graph_100'
          )
          and not exists (
            select 1
            from public.remote_object_bindings binding
            where binding.plan_id = mp.id
          )
        )
      );

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
      and mp.user_id = v_row.user_id
      and mp.platform_account_id = v_row.platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.status = 'PENDING'
      and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
      and mps.status in (
        'FAILED', 'RETRYABLE', 'CLAIMED', 'RUNNING',
        'COMPENSATION_REQUIRED', 'STALE', 'PENDING'
      )
      and mps.dispatch_state is distinct from 'REMOTE_APPLIED';

    perform public.revive_meta_organic_boost_superseded_plans(
      v_row.user_id,
      v_row.platform_account_id
    );
  end loop;
end;
$heal$;

commit;

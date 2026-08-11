-- Fix: Traffic/Lead prepare leaves ACCOUNT FREEZE_WRITES. Under FREEZE the organic
-- materializer used to bake require_manual_approval=true (+ not_before=infinity)
-- into AUTO Beitrag-Push plans. Links stick → Freigeben/rebind never rematerialize
-- AUTO → "In Warteschlange — noch kein Meta-Versand" forever while already-live
-- boosts keep spending.
--
-- Additive only:
-- 1) Stop baking fake REVIEW from kill-mode (AUTO under FREEZE soft-fails instead)
-- 2) Heal already-stuck wire-free AUTO plans when ACCOUNT is ALLOW again
-- 3) prepare_write_now calls the heal before due/preflight counts

begin;

-- ---------------------------------------------------------------------------
-- 1) materialize: kill-switch must not mint fake REVIEW for AUTO settings
-- ---------------------------------------------------------------------------
do $patch_materialize$
declare
  v_def text;
  v_updated text;
  v_marker constant text :=
    'Kill-switch must NOT bake fake REVIEW into AUTO plans';
  v_new constant text :=
    $new$-- Kill-switch must NOT bake fake REVIEW into AUTO plans. Traffic/Lead prepare
  -- FREEZE would otherwise strand linked candidates forever; executor soft-skip
  -- already blocks Meta writes until ALLOW.
  v_require_manual_approval := v_settings.require_manual_approval
    or v_budget_mode = 'LIFETIME'
    or not v_settings.auto_boost_new_candidates;$new$;
begin
  select pg_get_functiondef(
    'public.materialize_meta_organic_boost_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'materialize_meta_organic_boost_plan not found';
  end if;

  if position(v_marker in v_def) > 0 then
    return;
  end if;

  -- Flexible whitespace: pg_get_functiondef may re-indent prior patches.
  v_updated := regexp_replace(
    v_def,
    E'v_require_manual_approval\\s*:=\\s*v_settings\\.require_manual_approval\\s+'
      || E'or\\s+v_budget_mode\\s*=\\s*''LIFETIME''\\s+'
      || E'or\\s+coalesce\\(\\s*v_kill_mode\\s*,\\s*''FREEZE_WRITES''\\s*\\)\\s*<>\\s*''ALLOW''\\s+'
      || E'or\\s+not\\s+v_settings\\.auto_boost_new_candidates\\s*;',
    v_new
  );

  if v_updated is not distinct from v_def
    or position(v_marker in v_updated) = 0 then
    raise exception
      'Failed to patch materialize_meta_organic_boost_plan kill/REVIEW bake gate';
  end if;

  execute v_updated;
end;
$patch_materialize$;

-- ---------------------------------------------------------------------------
-- 2) Heal freeze-baked REVIEW flags on wire-free AUTO organic plans
-- ---------------------------------------------------------------------------
create or replace function public.heal_meta_organic_boost_freeze_baked_review(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kill text;
  v_settings public.meta_boost_settings%rowtype;
  v_plan public.mutation_plans%rowtype;
  v_count integer := 0;
  v_guards_disabled boolean := false;
  v_payload jsonb;
  v_hash text;
begin
  if p_user_id is null or p_platform_account_id is null then
    return 0;
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    return 0;
  end if;

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  if coalesce(v_kill, 'FREEZE_WRITES') <> 'ALLOW' then
    return 0;
  end if;

  select settings.* into v_settings
  from public.meta_boost_settings settings
  where settings.user_id = p_user_id
    and settings.platform_account_id = p_platform_account_id
    and settings.is_current
  order by settings.version desc
  limit 1;

  if not found
    or not v_settings.enabled
    or not v_settings.auto_boost_new_candidates
    or v_settings.require_manual_approval
    or coalesce(v_settings.boost_mode, 'REVIEW') <> 'AUTO' then
    return 0;
  end if;

  begin
    alter table public.mutation_plans
      disable trigger guard_meta_mutation_plan_update;
    v_guards_disabled := true;
  exception
    when others then
      v_guards_disabled := false;
  end;
  perform set_config('app.meta_organic_rebind', '1', true);

  for v_plan in
    select mp.*
    from public.mutation_plans mp
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE', 'PREFLIGHT_FAILED'
      )
      and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = true
      and coalesce(mp.planned_payload->>'budget_mode', 'DAILY') <> 'LIFETIME'
      and coalesce(mp.planned_payload->>'launch_kind', 'ORGANIC_BOOST') = 'ORGANIC_BOOST'
      -- Never touch intentional canaries / already-approved REVIEW.
      and not exists (
        select 1
        from public.meta_organic_boost_canary_approvals approval
        where approval.plan_id = mp.id
      )
      -- Never touch plans that already talked to Meta.
      and not exists (
        select 1
        from public.mutation_plan_steps step
        where step.plan_id = mp.id
          and (
            step.status = 'REMOTE_APPLIED'
            or step.dispatch_state <> 'NOT_DISPATCHED'
            or step.dispatch_started_at is not null
            or step.remote_applied_at is not null
          )
      )
      and not exists (
        select 1
        from public.remote_object_bindings binding
        where binding.plan_id = mp.id
      )
  loop
    v_payload := jsonb_set(
      coalesce(v_plan.planned_payload, '{}'::jsonb),
      '{require_manual_approval}',
      'false'::jsonb,
      true
    );
    v_hash := public.meta_sha256(v_payload::text);

    update public.mutation_plans mp
    set
      planned_payload = v_payload,
      payload_hash = v_hash,
      expected_before = jsonb_set(
        coalesce(mp.expected_before, '{}'::jsonb),
        '{kill_switch_mode}',
        to_jsonb('ALLOW'::text),
        true
      ),
      status = 'PENDING',
      not_before = least(coalesce(mp.not_before, now()), now()),
      blocked_reason = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive',
          'superseded_by_marketing_snapshot'
        ) then null
        else mp.blocked_reason
      end,
      error_class = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive',
          'superseded_by_marketing_snapshot'
        ) then null
        else mp.error_class
      end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = null,
      updated_at = now()
    where mp.id = v_plan.id;

    v_count := v_count + 1;
  end loop;

  perform set_config('app.meta_organic_rebind', '0', true);
  if v_guards_disabled then
    alter table public.mutation_plans
      enable trigger guard_meta_mutation_plan_update;
  end if;

  return v_count;
exception
  when others then
    perform set_config('app.meta_organic_rebind', '0', true);
    if v_guards_disabled then
      begin
        alter table public.mutation_plans
          enable trigger guard_meta_mutation_plan_update;
      exception
        when others then
          null;
      end;
    end if;
    raise;
end;
$$;

revoke all on function public.heal_meta_organic_boost_freeze_baked_review(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.heal_meta_organic_boost_freeze_baked_review(uuid, uuid)
  to service_role;

comment on function public.heal_meta_organic_boost_freeze_baked_review(uuid, uuid) is
  'Clears freeze-baked require_manual_approval on wire-free AUTO organic plans when ACCOUNT ALLOW; never touches Meta-live plans.';

-- ---------------------------------------------------------------------------
-- 3) prepare_write_now: heal freeze-bake before due/preflight
-- ---------------------------------------------------------------------------
create or replace function public.prepare_meta_organic_boost_write_now(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns table (
  due_plans integer,
  lease_user_id uuid,
  account_user_id uuid,
  lease_idle boolean,
  lease_user_matches boolean,
  kill_switch_mode text,
  preflight_ok_count integer,
  rebound_plans integer,
  preflight_blocker text,
  rebind_detail text,
  lease_forced boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kill text;
  v_due integer := 0;
  v_preflight_ok integer := 0;
  v_rebound integer := 0;
  v_rebind_detail text := null;
  v_blocker text := null;
  v_lease_user uuid;
  v_account_user uuid;
  v_expires timestamptz;
  v_plan_id uuid;
  v_rebind record;
  v_lease_forced boolean := false;
  v_finalized integer := 0;
  v_healed integer := 0;
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

  begin
    v_lease_forced := public.force_release_meta_account_operation_lease(
      p_platform_account_id, p_user_id
    );
  exception
    when others then
      perform public.heal_meta_account_operation_lease(
        p_platform_account_id, p_user_id
      );
      v_lease_forced := false;
      v_rebind_detail := 'lease_force_failed:' || SQLERRM;
  end;

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  begin
    select * into v_rebind
    from public.rebind_meta_organic_boost_plans_to_current_policy(
      p_user_id, p_platform_account_id
    );
    v_rebound := coalesce(v_rebind.rebound_count, 0);
    v_rebind_detail := case
      when v_rebind_detail is null then v_rebind.detail
      else v_rebind_detail || ';' || coalesce(v_rebind.detail, '')
    end;
  exception
    when others then
      v_rebound := 0;
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'prepare_rebind_call:' || SQLERRM;
  end;

  begin
    perform public.revive_meta_organic_boost_superseded_plans(
      p_user_id, p_platform_account_id
    );
  exception
    when others then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'revive:' || SQLERRM;
  end;

  begin
    v_healed := public.heal_meta_organic_boost_freeze_baked_review(
      p_user_id, p_platform_account_id
    );
    if v_healed > 0 then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || format('freeze_bake_healed=%s', v_healed);
    end if;
  exception
    when others then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'freeze_bake_heal:' || SQLERRM;
  end;

  if coalesce(v_kill, 'FREEZE_WRITES') = 'ALLOW' then
    update public.mutation_plans mp
    set
      status = 'PENDING',
      not_before = least(coalesce(mp.not_before, now()), now()),
      blocked_reason = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive'
        ) then null
        else mp.blocked_reason
      end,
      error_class = case
        when mp.blocked_reason in (
          'account_operation_lease_busy',
          'organic_preflight_kill_switch',
          'writes_frozen',
          'organic_preflight_not_ready',
          'organic_preflight_marketing_sync_stale',
          'policy_inactive'
        ) then null
        else mp.error_class
      end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = null,
      updated_at = now()
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE',
        'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING'
      );
  end if;

  begin
    v_finalized := public.finalize_meta_organic_boost_already_active_plans(
      p_user_id, p_platform_account_id
    );
    if v_finalized > 0 then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || format('finalized_active=%s', v_finalized);
    end if;
  exception
    when others then
      v_rebind_detail := coalesce(v_rebind_detail || ';', '')
        || 'finalize_active:' || SQLERRM;
  end;

  select count(*)::integer into v_due
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and mp.attempt_count < mp.max_attempts;

  select count(*)::integer into v_preflight_ok
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and public.meta_launch_canary_preflight_ok(mp.id);

  if v_due > 0 and v_preflight_ok < 1 then
    select mp.id into v_plan_id
    from public.mutation_plans mp
    where mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
      and mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in ('PENDING', 'RETRYABLE')
      and mp.not_before <= now()
    order by mp.created_at asc
    limit 1;

    if v_plan_id is not null then
      select string_agg(d.check_name, ',' order by d.check_name)
        into v_blocker
      from public.diagnose_meta_organic_boost_plan_preflight(v_plan_id) d
      where d.ok is not true
        and d.check_name <> 'preflight_ok';
    end if;
  end if;

  select lease.user_id, lease.expires_at, account.user_id
    into v_lease_user, v_expires, v_account_user
  from public.platform_accounts account
  left join public.meta_account_operation_leases lease
    on lease.platform_account_id = account.id
  where account.id = p_platform_account_id
    and account.user_id = p_user_id;

  return query select
    v_due,
    v_lease_user,
    v_account_user,
    (v_expires is null or v_expires <= now()),
    (v_lease_user is not distinct from v_account_user),
    coalesce(v_kill, 'FREEZE_WRITES'),
    v_preflight_ok,
    v_rebound,
    v_blocker,
    v_rebind_detail,
    v_lease_forced;
end;
$$;

revoke all on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_meta_organic_boost_write_now(uuid, uuid)
  to service_role;

comment on function public.prepare_meta_organic_boost_write_now(uuid, uuid) is
  'Heals lease/rebind/freeze-baked REVIEW, then reports due organic plans and preflight blockers.';

-- ---------------------------------------------------------------------------
-- 4) One-shot: heal stuck freeze-baked plans on accounts already ALLOW
-- ---------------------------------------------------------------------------
do $oneshot$
declare
  v_row record;
  v_healed integer;
begin
  for v_row in
    select distinct mp.user_id, mp.platform_account_id
    from public.mutation_plans mp
    join public.platform_accounts account
      on account.id = mp.platform_account_id
     and account.user_id = mp.user_id
    where mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE', 'PREFLIGHT_FAILED'
      )
      and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = true
      and coalesce(mp.planned_payload->>'budget_mode', 'DAILY') <> 'LIFETIME'
      and account.platform = 'meta'
      and account.revoked_at is null
      and not exists (
        select 1
        from public.remote_object_bindings binding
        where binding.plan_id = mp.id
      )
  loop
    begin
      v_healed := public.heal_meta_organic_boost_freeze_baked_review(
        v_row.user_id, v_row.platform_account_id
      );
    exception
      when others then
        raise notice 'freeze_bake_oneshot_skip % %: %',
          v_row.user_id, v_row.platform_account_id, SQLERRM;
    end;
  end loop;
end;
$oneshot$;

commit;

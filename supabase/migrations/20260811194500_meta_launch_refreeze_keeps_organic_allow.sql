-- Traffic/Lead canary used to ACCOUNT-refreeze after every terminal launch.
-- That permanently revoked Freigeben and blocked Beitrag-Push AUTO until a
-- manual click. Keep PLAN freeze for the finished canary; leave ACCOUNT ALLOW
-- when Beitrag-Push AUTO is configured. Also restore ALLOW for already-stuck
-- AUTO accounts (one-shot).

begin;

create or replace function public.refreeze_meta_launch_plan_after_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_mode text;
  v_plan_mode text;
  v_keep_account_allow boolean := false;
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

  -- Traffic/Lead terminals must not revoke Freigeben while Beitrag-Push AUTO
  -- is the customer's configured default workflow.
  select exists (
    select 1
    from public.meta_boost_settings settings
    where settings.user_id = new.user_id
      and settings.platform_account_id = new.platform_account_id
      and settings.is_current
      and settings.enabled
      and settings.boost_mode = 'AUTO'
      and settings.auto_boost_new_candidates
      and settings.require_manual_approval is not true
  ) into v_keep_account_allow;

  select latest.mode into v_account_mode
  from public.kill_switch_state latest
  where latest.scope_type = 'ACCOUNT'
    and latest.user_id = new.user_id
    and latest.platform_account_id = new.platform_account_id
  order by latest.sequence desc
  limit 1;

  if not v_keep_account_allow
    and coalesce(v_account_mode, 'FREEZE_WRITES') <> 'FREEZE_WRITES' then
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
      'account_kill_switch', case
        when v_keep_account_allow then coalesce(v_account_mode, 'ALLOW')
        else 'FREEZE_WRITES'
      end,
      'plan_kill_switch', 'FREEZE_WRITES',
      'kept_account_allow_for_organic_auto', v_keep_account_allow
    ),
    '{}'::jsonb,
    null, null, null, null, new.error_class, now()
  );

  return new;
end;
$$;

comment on function public.refreeze_meta_launch_plan_after_execution() is
  'PLAN-refreeze after LAUNCH_CHAIN terminals; ACCOUNT Freigeben stays when Beitrag-Push AUTO is configured; organic-boost never revokes ACCOUNT.';

-- One-shot: restore ACCOUNT ALLOW for Beitrag-Push AUTO accounts left frozen.
do $oneshot$
declare
  v_row record;
  v_latest_mode text;
begin
  for v_row in
    select settings.user_id, settings.platform_account_id
    from public.meta_boost_settings settings
    join public.platform_accounts account
      on account.id = settings.platform_account_id
     and account.user_id = settings.user_id
    where settings.is_current
      and settings.enabled
      and settings.boost_mode = 'AUTO'
      and settings.auto_boost_new_candidates
      and settings.require_manual_approval is not true
      and account.platform = 'meta'
      and account.revoked_at is null
      and 'ads_management' = any(account.meta_scopes)
  loop
    select state.mode
    into v_latest_mode
    from public.kill_switch_state state
    where state.scope_type = 'ACCOUNT'
      and state.user_id = v_row.user_id
      and state.platform_account_id = v_row.platform_account_id
    order by state.sequence desc
    limit 1;

    if coalesce(v_latest_mode, 'FREEZE_WRITES') <> 'ALLOW' then
      perform public.append_meta_kill_switch_state(
        'ACCOUNT',
        v_row.user_id,
        v_row.platform_account_id,
        null,
        'ALLOW',
        'Heal: Freigeben für Beitrag-Push AUTO wiederhergestellt — Traffic/Lead-Prepare darf ACCOUNT nicht dauerhaft einfrieren',
        'SYSTEM',
        'meta-launch-refreeze-keeps-organic-allow'
      );
    end if;

    begin
      perform public.heal_meta_organic_boost_freeze_baked_review(
        v_row.user_id, v_row.platform_account_id
      );
    exception
      when undefined_function then
        null;
      when others then
        raise notice 'organic_freeze_bake_heal_skip % %: %',
          v_row.user_id, v_row.platform_account_id, SQLERRM;
    end;
  end loop;
end;
$oneshot$;

commit;

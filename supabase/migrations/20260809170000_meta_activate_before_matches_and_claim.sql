-- ACTIVATE plans were queued ("1 geplant") but drain reported
-- claim_idle_with_due_plans. claim_next marks them STALE via
-- meta_executor_before_matches when campaigns.last_seen_sync_id differs from
-- plan.source_marketing_sync_id — a gate meant for budget launches, not status
-- flips. Also prepare_write_now only revived LAUNCH_CHAIN, not ACTIVATE.

begin;

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
  v_status_action boolean := p_plan.action_type in (
    'ACTIVATE', 'SAFETY_PAUSE', 'PAUSE'
  );
begin
  v_current := public.meta_executor_current_before(p_target);

  if v_current = '{}'::jsonb
    or coalesce((v_current->>'is_current')::boolean, false) is not true
    or v_current->>'object_id' is distinct from p_target.platform_object_id then
    return false;
  end if;

  -- Status flips must not require an exact marketing-sync id match. Sync id can
  -- move between queue and claim (Abruf / status refresh) while Meta is still
  -- PAUSED — that previously STALE'd ACTIVATE and left drain idle.
  if not v_status_action then
    if (v_current->>'source_marketing_sync_id')::uuid
         is distinct from p_plan.source_marketing_sync_id then
      return false;
    end if;
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

  if p_plan.expected_before ? 'status' then
    declare
      v_expected text := upper(coalesce(p_plan.expected_before->>'status', ''));
      v_actual text := upper(coalesce(v_current->>'status', ''));
    begin
      if v_status_action then
        -- PAUSED vs CAMPAIGN_PAUSED must both allow ACTIVATE.
        if v_expected in ('PAUSED', 'CAMPAIGN_PAUSED')
          and v_actual in ('PAUSED', 'CAMPAIGN_PAUSED') then
          null;
        elsif v_actual is distinct from v_expected then
          return false;
        end if;
      elsif v_actual is distinct from v_expected then
        return false;
      end if;
    end;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function public.meta_executor_before_matches(
  public.mutation_plans, public.automation_targets
) from public, anon, authenticated;
grant execute on function public.meta_executor_before_matches(
  public.mutation_plans, public.automation_targets
) to service_role;

comment on function public.meta_executor_before_matches(
  public.mutation_plans, public.automation_targets
) is
  'Preflight before-state check; ACTIVATE/PAUSE/SAFETY_PAUSE do not require last_seen_sync_id match.';

-- Revive STALE/blocked ACTIVATE resume plans and align sync id + lease.
create or replace function public.prepare_meta_status_activate_write_now(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease_forced boolean := false;
  v_revived integer := 0;
  v_due integer := 0;
  v_sync_id uuid;
  v_kill text;
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
  end;

  select pa.marketing_sync_id into v_sync_id
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id;

  select ks.mode into v_kill
  from public.get_effective_meta_kill_switch(
    p_user_id, p_platform_account_id, null
  ) ks;

  if coalesce(v_kill, 'FREEZE_WRITES') = 'ALLOW' then
    begin
      alter table public.mutation_plans
        disable trigger guard_meta_mutation_plan_update;
      alter table public.mutation_plan_steps
        disable trigger guard_meta_mutation_step_update;

      update public.mutation_plans mp
      set
        status = 'PENDING',
        source_marketing_sync_id = coalesce(v_sync_id, mp.source_marketing_sync_id),
        expected_before = case
          when mp.expected_before ? 'source_marketing_sync_id'
            and v_sync_id is not null
          then mp.expected_before
            || jsonb_build_object('source_marketing_sync_id', v_sync_id)
          else mp.expected_before
        end,
        attempt_count = least(
          coalesce(mp.attempt_count, 0),
          greatest(coalesce(mp.max_attempts, 5) - 1, 0)
        ),
        max_attempts = greatest(coalesce(mp.max_attempts, 1), 5),
        not_before = least(coalesce(mp.not_before, now()), now()),
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        error_class = null,
        blocked_reason = null,
        terminal_at = null,
        updated_at = now()
      where mp.user_id = p_user_id
        and mp.platform_account_id = p_platform_account_id
        and mp.action_type = 'ACTIVATE'
        and mp.source_rule_key in (
          'organic_boost_reactivate', 'hard_cap_day_resume'
        )
        and mp.status in (
          'PENDING', 'RETRYABLE', 'BLOCKED', 'FAILED', 'STALE',
          'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING',
          'CANCELLED'
        )
        and (
          mp.status is distinct from 'PENDING'
          or coalesce(mp.blocked_reason, '') in (
            'account_operation_lease_busy',
            'before_state_drift',
            'writes_frozen',
            'action_not_allowed'
          )
          or mp.not_before > now()
          or mp.source_marketing_sync_id is distinct from v_sync_id
        );

      get diagnostics v_revived = row_count;

      update public.mutation_plan_steps step
      set
        status = 'PENDING',
        dispatch_state = 'NOT_DISPATCHED',
        dispatch_started_at = null,
        error_code = null,
        error_detail = null,
        error_class = null,
        not_before = least(coalesce(step.not_before, now()), now()),
        updated_at = now()
      where step.platform_account_id = p_platform_account_id
        and step.user_id = p_user_id
        and exists (
          select 1
          from public.mutation_plans mp
          where mp.id = step.plan_id
            and mp.action_type = 'ACTIVATE'
            and mp.source_rule_key in (
              'organic_boost_reactivate', 'hard_cap_day_resume'
            )
            and mp.status = 'PENDING'
        )
        and step.status in (
          'PENDING', 'RETRYABLE', 'FAILED', 'CLAIMED', 'RUNNING',
          'COMPENSATION_REQUIRED', 'VALIDATED', 'REMOTE_APPLIED'
        );

      -- Keep campaign last_seen in sync so older claim paths stay green too.
      if v_sync_id is not null then
        update public.campaigns c
        set
          last_seen_sync_id = v_sync_id,
          updated_at = now()
        where c.user_id = p_user_id
          and c.platform_account_id = p_platform_account_id
          and c.is_current
          and c.last_seen_sync_id is distinct from v_sync_id
          and exists (
            select 1
            from public.mutation_plans mp
            join public.automation_targets t
              on t.id = mp.automation_target_id
            where mp.user_id = p_user_id
              and mp.platform_account_id = p_platform_account_id
              and mp.action_type = 'ACTIVATE'
              and mp.source_rule_key in (
                'organic_boost_reactivate', 'hard_cap_day_resume'
              )
              and mp.status = 'PENDING'
              and t.platform_object_id = c.platform_campaign_id
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
  end if;

  select count(*)::integer into v_due
  from public.mutation_plans mp
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.action_type = 'ACTIVATE'
    and mp.source_rule_key in (
      'organic_boost_reactivate', 'hard_cap_day_resume'
    )
    and mp.status in ('PENDING', 'RETRYABLE')
    and mp.not_before <= now()
    and mp.attempt_count < mp.max_attempts;

  return jsonb_build_object(
    'outcome', 'OK',
    'due_plans', v_due,
    'revived', v_revived,
    'lease_forced', v_lease_forced,
    'kill_switch_mode', coalesce(v_kill, 'FREEZE_WRITES'),
    'source_marketing_sync_id', v_sync_id
  );
end;
$$;

revoke all on function public.prepare_meta_status_activate_write_now(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_meta_status_activate_write_now(uuid, uuid)
  to service_role;

comment on function public.prepare_meta_status_activate_write_now(uuid, uuid) is
  'Force-releases WRITE lease and revives organic_boost_reactivate / hard_cap_day_resume ACTIVATE plans for immediate claim.';

-- One-shot: revive any currently stuck ACTIVATE resume plans (all tenants).
do $$
declare
  v_account record;
begin
  for v_account in
    select distinct mp.user_id, mp.platform_account_id
    from public.mutation_plans mp
    where mp.action_type = 'ACTIVATE'
      and mp.source_rule_key in (
        'organic_boost_reactivate', 'hard_cap_day_resume'
      )
      and mp.status in (
        'PENDING', 'RETRYABLE', 'STALE', 'BLOCKED', 'FAILED',
        'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING'
      )
  loop
    perform public.prepare_meta_status_activate_write_now(
      v_account.user_id,
      v_account.platform_account_id
    );
  end loop;
end;
$$;

commit;

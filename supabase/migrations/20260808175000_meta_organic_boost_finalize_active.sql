-- When Meta campaigns are already ACTIVE but mutation_plans stay PENDING/
-- RETRYABLE, drain reports claim_idle_with_due_plans and the UI skips Abruf.
-- Finalize those plans so due=0 and Kennzahlen-Abruf can run.

begin;

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
  v_count integer := 0;
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
        and (
          upper(coalesce(campaign.effective_status, campaign.status, '')) = 'ACTIVE'
        )
    );

  get diagnostics v_count = row_count;

  -- Steps that are still open after Meta is already ACTIVE: close locally.
  update public.mutation_plan_steps mps
  set
    status = case
      when mps.status = 'SUCCEEDED' then mps.status
      else 'SUCCEEDED'
    end,
    dispatch_state = case
      when mps.dispatch_state = 'REMOTE_APPLIED' then mps.dispatch_state
      else 'REMOTE_APPLIED'
    end,
    completed_at = coalesce(mps.completed_at, now()),
    updated_at = now()
  from public.mutation_plans mp
  where mps.plan_id = mp.id
    and mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.status = 'SUCCEEDED'
    and mps.status in (
      'PENDING', 'RETRYABLE', 'CLAIMED', 'RUNNING', 'FAILED', 'STALE'
    );

  return v_count;
end;
$$;

revoke all on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid)
  to service_role;

comment on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid) is
  'Marks organic LAUNCH_CHAIN plans SUCCEEDED when Meta campaign is already ACTIVE.';

-- Patch prepare: finalize already-active before due/preflight counts.
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

-- One-shot for already-stuck rows (all Meta accounts).
do $oneshot$
declare
  r record;
begin
  for r in
    select distinct mp.user_id, mp.platform_account_id
    from public.mutation_plans mp
    where mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING'
      )
  loop
    perform public.finalize_meta_organic_boost_already_active_plans(
      r.user_id, r.platform_account_id
    );
  end loop;
end;
$oneshot$;

commit;

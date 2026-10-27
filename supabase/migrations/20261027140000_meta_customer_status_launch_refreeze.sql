-- Customer Pause/Fortsetzen must not be stopped by the automatic account
-- refreeze that every accepted Adbot launch leaves behind.
--
-- After an atomic active launch the system appends ACCOUNT FREEZE_WRITES
-- (actor SYSTEM meta-launch-canary-refreeze / -reconciler). The account then
-- stays frozen until the next launch, so the customer button failed with
-- writes_frozen although no customer or operator had stopped anything.
--
-- A customer_status_change PAUSE/ACTIVATE plan (explicit customer click for
-- one Adbot campaign) passes exactly that automatic refreeze, both when
-- queuing and in the executor claim gate. Nothing is appended to
-- kill_switch_state: the account stays frozen for every other write.
-- Still blocking: a SYSTEM-scope freeze, a customer/operator Not-Aus, any
-- PAUSE_MANAGED, the short launch-preparation freeze and plan-level freezes.

begin;

create or replace function public.meta_customer_status_passes_launch_refreeze(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1
      from (
        select kss.mode
        from public.kill_switch_state kss
        where kss.scope_type = 'SYSTEM'
        order by kss.sequence desc
        limit 1
      ) latest_system
      where latest_system.mode <> 'ALLOW'
    )
    and exists (
      select 1
      from (
        select kss.mode, kss.actor_type, kss.actor_id
        from public.kill_switch_state kss
        where kss.scope_type = 'ACCOUNT'
          and kss.user_id = p_user_id
          and kss.platform_account_id = p_platform_account_id
        order by kss.sequence desc
        limit 1
      ) latest_account
      where latest_account.mode = 'FREEZE_WRITES'
        and latest_account.actor_type = 'SYSTEM'
        and latest_account.actor_id in (
          'meta-launch-canary-refreeze', 'meta-launch-canary-reconciler'
        )
    );
$$;

revoke all on function public.meta_customer_status_passes_launch_refreeze(uuid, uuid)
  from public, anon, authenticated;

comment on function public.meta_customer_status_passes_launch_refreeze(uuid, uuid) is
  'True when the only write block is the automatic account refreeze after an accepted launch; customer Pause/Fortsetzen may pass it.';

-- Queue: a customer click passes the automatic launch refreeze.
do $patch$
declare
  v_function regprocedure :=
    'public.queue_meta_campaign_status_plan_internal(uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if position('customer_status_launch_refreeze' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'if coalesce\\(v_kill_mode, ''ALLOW''\\) <> ''ALLOW'' then',
    E'if coalesce(v_kill_mode, ''ALLOW'') <> ''ALLOW''\n'
    || E'    -- customer_status_launch_refreeze: a customer click passes the\n'
    || E'    -- automatic account refreeze left behind by an accepted launch.\n'
    || E'    and not (\n'
    || E'      p_source_rule_key = ''customer_status_change''\n'
    || E'      and p_actor_type = ''CUSTOMER''\n'
    || E'      and public.meta_customer_status_passes_launch_refreeze(\n'
    || E'        p_user_id, p_platform_account_id\n'
    || E'      )\n'
    || E'    ) then'
  );

  if v_updated = v_definition then
    raise exception 'queue_meta_campaign_status_plan_internal kill gate not found';
  end if;

  execute v_updated;
end;
$patch$;

-- Executor claim gate: same exception, only for customer PAUSE/ACTIVATE plans.
do $patch$
declare
  v_function regprocedure :=
    'public.claim_meta_mutation_execution(text, integer, uuid)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if position('customer_status_launch_refreeze' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'(from public\\.get_effective_meta_kill_switch\\(\\s+v_plan\\.user_id, v_plan\\.platform_account_id, v_plan\\.id\\s+\\) ks\\s+loop exit; end loop;)',
    E'\\1\n\n'
    || E'    -- customer_status_launch_refreeze: a customer click passes the\n'
    || E'    -- automatic account refreeze left behind by an accepted launch.\n'
    || E'    if v_kill_mode = ''FREEZE_WRITES''\n'
    || E'      and v_kill_scope = ''ACCOUNT''\n'
    || E'      and v_plan.source_rule_key = ''customer_status_change''\n'
    || E'      and v_plan.action_type in (''PAUSE'', ''ACTIVATE'')\n'
    || E'      and public.meta_customer_status_passes_launch_refreeze(\n'
    || E'        v_plan.user_id, v_plan.platform_account_id\n'
    || E'      ) then\n'
    || E'      v_kill_mode := ''ALLOW'';\n'
    || E'    end if;'
  );

  if v_updated = v_definition then
    raise exception 'claim_meta_mutation_execution kill gate not found';
  end if;

  execute v_updated;
end;
$patch$;

commit;

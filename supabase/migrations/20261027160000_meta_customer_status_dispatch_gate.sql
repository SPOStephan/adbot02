-- Customer Pause/Fortsetzen: the per-step dispatch gate must accept what the
-- queue and claim gates already accept.
--
-- 20261027120000 and 20261027140000 let customer_status_change PAUSE/ACTIVATE
-- plans through a SUSPENDED campaign target and through the automatic account
-- refreeze after a launch, in the queue and in claim_meta_mutation_execution.
-- begin_meta_mutation_step_dispatch re-checks both right before the Meta
-- request and still demanded MANAGED + ALLOW, so the claimed plan raised
-- 'Meta writes are blocked by kill switch' / 'Meta target before-state
-- drifted' (executor: database_failed) and ended FAILED after 3 attempts.
-- Nothing was sent to Meta.
--
-- Same exception, same conditions, patched in place.

begin;

do $patch$
declare
  v_function regprocedure :=
    'public.begin_meta_mutation_step_dispatch(uuid, uuid, uuid)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if position('customer_status_dispatch_gate' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'if v_kill_mode <> ''ALLOW'' then\\s+raise exception ''Meta writes are blocked by kill switch'';',
    E'-- customer_status_dispatch_gate: a customer click passes the automatic\n'
    || E'  -- account refreeze left behind by an accepted launch.\n'
    || E'  if v_kill_mode = ''FREEZE_WRITES''\n'
    || E'    and v_plan.source_rule_key = ''customer_status_change''\n'
    || E'    and v_plan.action_type in (''PAUSE'', ''ACTIVATE'')\n'
    || E'    and public.meta_customer_status_passes_launch_refreeze(\n'
    || E'      v_plan.user_id, v_plan.platform_account_id\n'
    || E'    ) then\n'
    || E'    v_kill_mode := ''ALLOW'';\n'
    || E'  end if;\n'
    || E'  if v_kill_mode <> ''ALLOW'' then\n'
    || E'    raise exception ''Meta writes are blocked by kill switch'';'
  );

  if v_updated = v_definition then
    raise exception 'begin_meta_mutation_step_dispatch kill gate not found';
  end if;

  v_definition := v_updated;
  v_updated := regexp_replace(
    v_definition,
    E'where at\\.id = v_plan\\.automation_target_id and at\\.status = ''MANAGED''',
    E'where at.id = v_plan.automation_target_id\n'
    || E'      and (at.status = ''MANAGED''\n'
    || E'        or (at.status = ''SUSPENDED''\n'
    || E'            and at.target_type = ''CAMPAIGN''\n'
    || E'            and v_plan.source_rule_key = ''customer_status_change''\n'
    || E'            and v_plan.action_type in (''PAUSE'', ''ACTIVATE'')))'
  );

  if v_updated = v_definition then
    raise exception 'begin_meta_mutation_step_dispatch target gate not found';
  end if;

  execute v_updated;
end;
$patch$;

commit;

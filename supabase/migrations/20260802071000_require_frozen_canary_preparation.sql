begin;

-- Preparing an immutable, fingerprint-bound plan must not require a temporary
-- account-wide write window. The plan remains held at PLAN scope and can only
-- be released by the separate exact-approval function.
do $$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.materialize_meta_customer_budget_canary_plan(uuid,uuid,uuid,text,timestamptz)'
  );
  v_definition text;
  v_before text := 'if coalesce(v_kill_mode, ''FREEZE_WRITES'') <> ''ALLOW'' then
    raise exception ''Account writes must be explicitly allowed for the canary'';
  end if;';
  v_after text := 'if coalesce(v_kill_mode, ''FREEZE_WRITES'') <> ''FREEZE_WRITES'' then
    raise exception ''Account writes must remain frozen while preparing the canary'';
  end if;';
  v_occurrences integer;
begin
  if v_signature is null then
    raise exception 'Budget canary materialization function is missing';
  end if;

  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
  ) / pg_catalog.length(v_before);

  if v_occurrences <> 1 then
    raise exception 'Budget canary preparation kill-switch invariant changed';
  end if;

  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$$;

revoke all on function public.materialize_meta_customer_budget_canary_plan(
  uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.materialize_meta_customer_budget_canary_plan(
  uuid, uuid, uuid, text, timestamptz
) to service_role;

commit;

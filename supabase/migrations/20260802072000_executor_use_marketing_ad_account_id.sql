do $migration$
declare
  v_function regprocedure :=
    'public.claim_next_meta_mutation_execution(text,integer)'::regprocedure;
  v_definition text;
  v_old_select constant text :=
    'select pa.account_id into v_ad_account_id';
  v_new_select constant text :=
    'select pa.marketing_meta_ad_account_id into v_ad_account_id';
  v_old_allowed_match constant text :=
    'regexp_replace(pa.account_id, ''^act_'', '''')';
  v_new_allowed_match constant text :=
    'regexp_replace(pa.marketing_meta_ad_account_id, ''^act_'', '''')';
  v_occurrences integer;
begin
  select pg_get_functiondef(v_function) into v_definition;

  v_occurrences :=
    (char_length(v_definition) - char_length(replace(v_definition, v_old_select, '')))
    / char_length(v_old_select);
  if v_occurrences <> 1 then
    raise exception
      'Expected exactly one executor account selection, found %',
      v_occurrences;
  end if;

  v_occurrences :=
    (char_length(v_definition) - char_length(replace(v_definition, v_old_allowed_match, '')))
    / char_length(v_old_allowed_match);
  if v_occurrences <> 1 then
    raise exception
      'Expected exactly one executor allowed-account comparison, found %',
      v_occurrences;
  end if;

  v_definition := replace(v_definition, v_old_select, v_new_select);
  v_definition := replace(v_definition, v_old_allowed_match, v_new_allowed_match);

  if position(v_old_select in v_definition) > 0
    or position(v_old_allowed_match in v_definition) > 0
    or position(v_new_select in v_definition) = 0
    or position(v_new_allowed_match in v_definition) = 0 then
    raise exception 'Executor ad-account resolution patch invariant failed';
  end if;

  execute v_definition;
end;
$migration$;

comment on function public.claim_next_meta_mutation_execution(text, integer) is
  'Claims one Meta mutation only after policy, encrypted-token, ads_management, selected marketing ad-account, kill-switch, target and before-state preflight checks.';

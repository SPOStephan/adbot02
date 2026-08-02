begin;

-- The customer policy must remain compatible with operation modes that only use
-- existing customer assets and static copy. Patch the already-audited function
-- body at exactly one invariant-checked location instead of duplicating its
-- validation, versioning and audit logic in a second implementation.
do $$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.put_meta_customer_policy_version(uuid,uuid,bigint,bigint,boolean,boolean,boolean,boolean)'
  );
  v_definition text;
  v_before text := '''allow_generation'', true';
  v_after text := '''allow_generation'', false';
  v_occurrences integer;
begin
  if v_signature is null then
    raise exception 'Customer policy function is missing';
  end if;

  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
  ) / pg_catalog.length(v_before);

  if v_occurrences <> 1 then
    raise exception 'Customer policy generation invariant changed';
  end if;

  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$$;

revoke all on function public.put_meta_customer_policy_version(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.put_meta_customer_policy_version(
  uuid, uuid, bigint, bigint, boolean, boolean, boolean, boolean
) to service_role;

commit;

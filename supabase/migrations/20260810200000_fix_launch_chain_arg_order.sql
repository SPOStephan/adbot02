-- ROOT CAUSE (Traffic / daily customer launch):
-- materialize_meta_customer_launch_plan called materialize_meta_launch_chain_plan
-- with (p_user_id, p_platform_account_id, ...) but the callee signature is
-- (p_platform_account_id, p_user_id, ...). Postgres binds positionally, so the
-- inner account lookup never finds the row and always raised:
--   'Current successful EUR Meta snapshot is required'
-- Evidence:
--   - callee: supabase/migrations/20260802150000_meta_atomic_launch_canary.sql
--   - wrong call: materialize_meta_customer_launch_plan (onboarding/atomic/harden)
--   - correct call: materialize_meta_customer_lifetime_launch_plan_v3
--   - unit tests call chain with (platform_account_id, user_id)
-- Traffic Canary uses daily → hit this after the marketing Abruf (~1 min).

begin;

do $patch$
declare
  v_def text;
  v_updated text;
  v_swapped_pattern constant text :=
    'v_result := public\.materialize_meta_launch_chain_plan\(\s*p_user_id,\s*p_platform_account_id,';
  v_correct_snippet constant text :=
    'materialize_meta_launch_chain_plan(
    p_platform_account_id,
    p_user_id,';
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_meta_customer_launch_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,jsonb,timestamptz)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'materialize_meta_customer_launch_plan not found';
  end if;

  -- Already fixed (idempotent re-run).
  if v_def !~ v_swapped_pattern
    and position(v_correct_snippet in v_def) > 0 then
    return;
  end if;

  if v_def !~ v_swapped_pattern then
    raise exception
      'Failed to locate swapped materialize_meta_launch_chain_plan call (user_id before platform_account_id)';
  end if;

  v_updated := regexp_replace(
    v_def,
    v_swapped_pattern,
    $new$v_result := public.materialize_meta_launch_chain_plan(
    p_platform_account_id,
    p_user_id,$new$,
    1,
    'n'
  );

  if v_updated ~ v_swapped_pattern then
    raise exception 'Swapped launch-chain argument order still present after patch';
  end if;

  if position(v_correct_snippet in v_updated) = 0 then
    raise exception 'Corrected launch-chain argument order missing after patch';
  end if;

  execute v_updated;
end;
$patch$;

comment on function public.materialize_meta_customer_launch_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, jsonb, timestamptz
) is
  'Customer daily launch prepare; launch-chain args are (platform_account_id, user_id, …).';

commit;
